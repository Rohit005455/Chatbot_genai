require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { generateStream } = require("./openai");
const logger = require("./logger");

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

// In-memory conversation store
const sessions = {};

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

io.on("connection", (socket) => {

  activeSocketConnections.inc();

  logger.info({
    event: "socket_connected",
    socketId: socket.id
  });

  socket.on("user_message", async (message) => {

    const startTime = Date.now();
    llmRequestCounter.inc();

    logger.info({
      event: "request_received",
      socketId: socket.id,
      promptLength: message.length
    });

    try {

      // Initialize session if not exists
      if (!sessions[socket.id]) {
        sessions[socket.id] = [
          {
            role: "system",
            content: "You are a helpful AI assistant. Be clear and concise."
          }
        ];
      }

      const conversation = sessions[socket.id];

      // Add user message
      conversation.push({
        role: "user",
        content: message
      });

      // 🔥 Limit conversation history (cost protection)
      const MAX_HISTORY = 10;

      if (conversation.length > MAX_HISTORY + 1) {
        sessions[socket.id] = [
          conversation[0], // keep system
          ...conversation.slice(-MAX_HISTORY)
        ];
      }

      let fullText = "";
      let firstTokenRecorded = false;

      await generateStream(sessions[socket.id], (chunk) => {

        if (!firstTokenRecorded) {
          const firstLatency = Date.now() - startTime;
          llmFirstTokenLatency.observe(firstLatency);
          firstTokenRecorded = true;

          logger.info({
            event: "first_token",
            socketId: socket.id,
            latencyMs: firstLatency
          });
        }

        fullText += chunk;
        socket.emit("ai_stream", chunk);
      });

      const totalLatency = Date.now() - startTime;
      llmTotalLatency.observe(totalLatency);

      logger.info({
        event: "response_complete",
        socketId: socket.id,
        totalLatencyMs: totalLatency
      });

      // Add assistant response to memory
      sessions[socket.id].push({
        role: "assistant",
        content: fullText
      });

      socket.emit("ai_stream_end");

    } catch (error) {

      llmErrorCounter.inc();

      logger.error({
        event: "llm_error",
        socketId: socket.id,
        message: error.message
      });

      socket.emit("ai_stream_end");
    }
  });

  socket.on("disconnect", () => {
    activeSocketConnections.dec();
    delete sessions[socket.id]; // clean memory

    logger.info({
      event: "socket_disconnected",
      socketId: socket.id
    });
  });

});

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  logger.info({
    event: "server_started",
    port: PORT
  });
});