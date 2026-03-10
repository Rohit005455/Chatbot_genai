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

// ─── Loki Format (structured JSON for querying) ───────────────────────────────
const lokiFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: consoleFormat
  })
];

// Only add Loki transport if LOKI_URL is set
if (process.env.LOKI_URL) {
  const lokiOptions = {
    host: process.env.LOKI_URL,
    labels: {
      app: "chatbot",
      env: process.env.NODE_ENV || "development",
      service: "chatbot-genai"
    },
    json: true,
    batching: true,
    interval: 5,                // batch every 5 seconds
    replaceTimestamp: true,
    format: lokiFormat,
    onConnectionError: (err) =>
      console.error("[Loki] Connection error:", err.message)
  };

  // Add basicAuth only if credentials are provided
  if (process.env.LOKI_USERNAME && process.env.LOKI_PASSWORD) {
    lokiOptions.basicAuth = `${process.env.LOKI_USERNAME}:${process.env.LOKI_PASSWORD}`;
  }

  transports.push(new LokiTransport(lokiOptions));
} else {
  console.warn("[Logger] LOKI_URL not set — skipping Loki transport");
}

// ─── Create Logger ────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  levels: logLevels.levels,
  level: process.env.LOG_LEVEL || "info",
  transports,
  // Don't crash on unhandled logger errors
  exitOnError: false
});

// ─── Helper Methods (structured logging) ─────────────────────────────────────

// Log incoming user messages
logger.logUserMessage = (userId, message, sessionId) => {
  logger.info("User message received", {
    userId,
    sessionId,
    message: message?.substring(0, 200), // truncate long messages
    type: "user_message"
  });
};

// Log bot responses
logger.logBotResponse = (userId, response, sessionId, durationMs) => {
  logger.info("Bot response sent", {
    userId,
    sessionId,
    response: response?.substring(0, 200),
    durationMs,
    type: "bot_response"
  });
};

// Log Redis operations
logger.logRedis = (operation, key, success, durationMs) => {
  logger.debug("Redis operation", {
    operation,
    key,
    success,
    durationMs,
    type: "redis"
  });
};

// Log API errors
logger.logError = (errorMessage, stack, context = {}) => {
  logger.error(errorMessage, {
    stack,
    ...context,
    type: "error"
  });
};

// Log HTTP requests
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