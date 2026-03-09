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
   REDIS CONNECTION
========================= */

const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

(async () => {
  await redis.connect();
  console.log("Redis connected");
})();

/* =========================
   PROMETHEUS METRICS
========================= */

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  activeSocketConnections.inc();
  logger.info("socket_connected", { socketId: socket.id });

  socket.on("user_message", async (message) => {
    const startTime = Date.now();
    llmRequestCounter.inc();

    logger.info("request_received", {
      socketId: socket.id,
      promptLength: message.length
    });

    const sessionKey = `chat:${socket.id}`;

    try {

      /* =========================
         LOAD CHAT HISTORY
      ========================= */

      let rawMessages = await redis.lRange(sessionKey, 0, -1);
      let conversation = rawMessages.map(m => JSON.parse(m));

      if (conversation.length === 0) {
        const systemMessage = {
          role: "system",
          content: "You are a helpful AI assistant. Be clear and concise."
        };

        await redis.rPush(sessionKey, JSON.stringify(systemMessage));
        conversation = [systemMessage];
      }

      /* =========================
         STORE USER MESSAGE
      ========================= */

      await redis.rPush(
        sessionKey,
        JSON.stringify({
          role: "user",
          content: message
        })
      );

      rawMessages = await redis.lRange(sessionKey, 0, -1);
      conversation = rawMessages.map(m => JSON.parse(m));

      let fullText = "";
      let firstTokenRecorded = false;

      /* =========================
         STREAM LLM RESPONSE
      ========================= */

      await generateStream(conversation, (chunk) => {

        if (!firstTokenRecorded) {
          const firstLatency = Date.now() - startTime;
          llmFirstTokenLatency.observe(firstLatency);

          firstTokenRecorded = true;

          logger.info("first_token", {
            socketId: socket.id,
            latencyMs: firstLatency
          });
        }

        fullText += chunk;
        socket.emit("ai_stream", chunk);

      });

      const totalLatency = Date.now() - startTime;
      llmTotalLatency.observe(totalLatency);

      logger.info("response_complete", {
        socketId: socket.id,
        totalLatencyMs: totalLatency
      });

      /* =========================
         STORE AI RESPONSE
      ========================= */

      await redis.rPush(
        sessionKey,
        JSON.stringify({
          role: "assistant",
          content: fullText
        })
      );

      /* =========================
         LIMIT CHAT HISTORY
      ========================= */

      const MAX_HISTORY = 20;

      await redis.lTrim(sessionKey, -MAX_HISTORY, -1);

      /* =========================
         AUTO DELETE OLD CHAT
      ========================= */

      await redis.expire(sessionKey, 3600);

      socket.emit("ai_stream_end");

    } catch (error) {

      llmErrorCounter.inc();

      logger.error("llm_error", {
        socketId: socket.id,
        message: error.message
      });

      socket.emit("ai_stream_end");
    }
  });

  socket.on("disconnect", async () => {
    activeSocketConnections.dec();

    logger.info("socket_disconnected", {
      socketId: socket.id
    });

    // optional cleanup
    await redis.del(`chat:${socket.id}`);
  });
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  logger.info("server_started", { port: PORT });
});