require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { generateResponse } = require("./gemini");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("user_message", async (message) => {
    try {
      console.log("User:", message);

      const response = await generateResponse(message);

      socket.emit("ai_message", response);

    } catch (error) {
      console.error("SERVER ERROR:", error.message);
      socket.emit("ai_message", "Error1 generating response.");
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
