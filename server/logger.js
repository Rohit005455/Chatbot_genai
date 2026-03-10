console.log("🔍 LOKI_URL:", process.env.LOKI_URL);
const winston = require("winston");
const LokiTransport = require("winston-loki");

// ─── Custom Log Levels ────────────────────────────────────────────────────────
const logLevels = {
  levels: { error: 0, warn: 1, info: 2, http: 3, debug: 4 },
  colors: { error: "red", warn: "yellow", info: "green", http: "magenta", debug: "blue" }
};
winston.addColors(logLevels.colors);

// ─── Console Format (pretty for local dev) ────────────────────────────────────
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: consoleFormat
  })
];

// ─── Loki Transport ───────────────────────────────────────────────────────────
if (process.env.LOKI_URL) {
  transports.push(new LokiTransport({
    host: process.env.LOKI_URL,
    labels: {
      app: "chatbot",
      env: process.env.NODE_ENV || "development",
      service: "chatbot-genai"
    },
    json: false,
    batching: false,
    replaceTimestamp: true,
    useWinstonMetaAsLabels: false,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ level, message, ...meta }) => {
        // strip internal winston fields
        delete meta.timestamp;
        delete meta[Symbol.for('level')];
        delete meta[Symbol.for('splat')];
        const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
        return `${level}: ${message}${metaStr}`;
      })
    ),
    onConnectionError: (err) =>
      console.error("[Loki] Connection error:", err.message)
  }));
  console.log("✅ Loki transport added");
} else {
  console.warn("[Logger] LOKI_URL not set — skipping Loki transport");
}

// ─── Create Logger ────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  levels: logLevels.levels,
  level: process.env.LOG_LEVEL || "info",
  transports,
  exitOnError: false
});

// ─── Helper Methods ───────────────────────────────────────────────────────────

logger.logUserMessage = (userId, message, sessionId) => {
  logger.info("User message received", {
    userId,
    sessionId,
    message: message?.substring(0, 200),
    type: "user_message"
  });
};

logger.logBotResponse = (userId, response, sessionId, durationMs) => {
  logger.info("Bot response sent", {
    userId,
    sessionId,
    response: response?.substring(0, 200),
    durationMs,
    type: "bot_response"
  });
};

logger.logRedis = (operation, key, success, durationMs) => {
  logger.debug("Redis operation", {
    operation,
    key,
    success,
    durationMs,
    type: "redis"
  });
};

logger.logError = (errorMessage, stack, context = {}) => {
  logger.error(errorMessage, {
    stack,
    ...context,
    type: "error"
  });
};

logger.logHttp = (method, url, statusCode, durationMs, ip) => {
  logger.http("HTTP request", {
    method,
    url,
    statusCode,
    durationMs,
    ip,
    type: "http"
  });
};

module.exports = logger;