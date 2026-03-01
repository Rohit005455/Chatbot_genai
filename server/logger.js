const winston = require("winston");
const LokiTransport = require("winston-loki");

const logger = winston.createLogger({
  level: "info",
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new LokiTransport({
      host: process.env.LOKI_URL,
      basicAuth: `${process.env.LOKI_USERNAME}:${process.env.LOKI_PASSWORD}`,
      labels: { app: "my-chatbot" },
      json: true,
      batching: false,
      replaceTimestamp: true,
      onConnectionError: (err) => console.error("Loki connection error:", err)
    })
  ]
});

module.exports = logger;