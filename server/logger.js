const winston = require("winston");
const LokiTransport = require("winston-loki");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log" }),
    new LokiTransport({
      host: process.env.LOKI_URL,
      basicAuth: `${process.env.LOKI_USERNAME}:${process.env.LOKI_PASSWORD}`,
      labels: { app: "my-chatbot" },
      json: true,
      batching: false,
      onConnectionError: (err) => console.error("Loki connection error:", err)
    })
  ]
});

module.exports = logger;