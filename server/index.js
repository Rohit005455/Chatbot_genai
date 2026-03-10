require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { generateStream } = require("./openai");
const logger = require("./logger");
const { createClient } = require("redis");

const {
  register,
  llmRequestCounter,
  llmErrorCounter,
  llmFirstTokenLatency,
  llmTotalLatency,
  activeSocketConnections,
} = require("./metrics");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* =========================
   HTTP REQUEST LOGGING
========================= */

app.use((req, res, next) => {
  const startTime = Date.now();
  res.on("finish", () => {
    logger.logHttp(req.method, req.url, res.statusCode, Date.now() - startTime, req.ip);
  });
  next();
});

/* =========================
   REDIS CONNECTION
========================= */

const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => {
  logger.logError("Redis client error", err.stack, { type: "redis_error" });
});

redis.on("connect", () => {
  logger.info("Redis connecting...", { type: "redis" });
});

redis.on("ready", () => {
  logger.info("Redis ready", { type: "redis" });
});

redis.on("reconnecting", () => {
  logger.warn("Redis reconnecting...", { type: "redis" });
});

(async () => {
  try {
    await redis.connect();
    logger.info("Redis connected successfully", {
      type: "redis",
      url: process.env.REDIS_URL?.replace(/:\/\/.*@/, "://***@") // hide credentials in logs
    });
  } catch (err) {
    logger.logError("Redis connection failed", err.stack, { type: "redis_fatal" });
    process.exit(1);
  }
})();

/* =========================
   PROMETHEUS METRICS
========================= */

app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.logError("Metrics endpoint failed", err.stack);
    res.status(500).end();
  }
});

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  activeSocketConnections.inc();

  logger.info("Socket connected", {
    socketId: socket.id,
    transport: socket.conn.transport.name,
    ip: socket.handshake.address,
    type: "socket_connect"
  });

  socket.on("user_message", async (message) => {

    // ── Validate message ──────────────────────────────
    if (!message || typeof message !== "string" || message.trim() === "") {
      logger.warn("Empty or invalid message received", {
        socketId: socket.id,
        type: "validation_error"
      });
      socket.emit("ai_stream_end");
      return;
    }

    const startTime = Date.now();
    llmRequestCounter.inc();
    const sessionKey = `chat:${socket.id}`;

    logger.logUserMessage(socket.id, message, sessionKey);

    try {

      /* =========================
         LOAD CHAT HISTORY
      ========================= */

      const redisStart = Date.now();
      let rawMessages = await redis.lRange(sessionKey, 0, -1);
      logger.logRedis("lRange", sessionKey, true, Date.now() - redisStart);

      let conversation = rawMessages.map((m) => JSON.parse(m));

      if (conversation.length === 0) {
        const systemMessage = {
          role: "system",
          content: "You are a helpful AI assistant. Be clear and concise.",
        };
        await redis.rPush(sessionKey, JSON.stringify(systemMessage));
        conversation = [systemMessage];

        logger.info("New session initialized", {
          socketId: socket.id,
          sessionKey,
          type: "session_init"
        });
      }

      /* =========================
         STORE USER MESSAGE
      ========================= */

      await redis.rPush(sessionKey, JSON.stringify({ role: "user", content: message }));
      rawMessages = await redis.lRange(sessionKey, 0, -1);
      conversation = rawMessages.map((m) => JSON.parse(m));

      logger.info("Chat history loaded", {
        socketId: socket.id,
        historyLength: conversation.length,
        type: "history"
      });

      let fullText = "";
      let firstTokenRecorded = false;
      let chunkCount = 0;

      /* =========================
         STREAM LLM RESPONSE
      ========================= */

      await generateStream(conversation, (chunk) => {

        if (!firstTokenRecorded) {
          const firstLatency = Date.now() - startTime;
          llmFirstTokenLatency.observe(firstLatency);
          firstTokenRecorded = true;

          logger.info("First token received", {
            socketId: socket.id,
            latencyMs: firstLatency,
            type: "llm_first_token"
          });
        }

        fullText += chunk;
        chunkCount++;
        socket.emit("ai_stream", chunk);
      });

      const totalLatency = Date.now() - startTime;
      llmTotalLatency.observe(totalLatency);

      /* =========================
         STORE AI RESPONSE
      ========================= */

      await redis.rPush(sessionKey, JSON.stringify({ role: "assistant", content: fullText }));
      await redis.lTrim(sessionKey, -20, -1);
      await redis.expire(sessionKey, 3600);

      logger.logBotResponse(socket.id, fullText, sessionKey, totalLatency);

      logger.info("Stream completed", {
        socketId: socket.id,
        totalLatencyMs: totalLatency,
        chunkCount,
        responseLength: fullText.length,
        type: "llm_complete"
      });

      socket.emit("ai_stream_end");

    } catch (error) {
      llmErrorCounter.inc();

      logger.logError("LLM stream error", error.stack, {
        socketId: socket.id,
        sessionKey,
        type: "llm_error"
      });

      socket.emit("ai_error", { message: "Something went wrong. Please try again." });
      socket.emit("ai_stream_end");
    }
  });

  socket.on("disconnect", async (reason) => {
    activeSocketConnections.dec();

    logger.info("Socket disconnected", {
      socketId: socket.id,
      reason,
      type: "socket_disconnect"
    });

    try {
      await redis.del(`chat:${socket.id}`);
      logger.logRedis("del", `chat:${socket.id}`, true, 0);
    } catch (err) {
      logger.logError("Failed to delete session on disconnect", err.stack, {
        socketId: socket.id
      });
    }
  });

  socket.on("error", (err) => {
    logger.logError("Socket error", err.stack, {
      socketId: socket.id,
      type: "socket_error"
    });
  });
});

/* =========================
   GRACEFUL SHUTDOWN
========================= */

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down gracefully", { type: "shutdown" });
  await redis.quit();
  server.close(() => {
    logger.info("Server closed", { type: "shutdown" });
    process.exit(0);
  });
});

process.on("uncaughtException", (err) => {
  logger.logError("Uncaught exception", err.stack, { type: "fatal" });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.logError("Unhandled rejection", reason?.stack || String(reason), { type: "fatal" });
  process.exit(1);
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  logger.info("Server started", {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    type: "server_start"
  });
});