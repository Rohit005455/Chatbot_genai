const client = require("prom-client");

// Collect default Node.js metrics (memory, CPU, etc.)
client.collectDefaultMetrics();

// Custom metrics for your chatbot
const activeSocketConnections = new client.Gauge({
  name: "active_socket_connections",
  help: "Number of currently connected WebSocket users",
});
// 1️⃣ Total requests counter
const llmRequestCounter = new client.Counter({
  name: "llm_total_requests",
  help: "Total number of LLM requests received",
  labelNames: ["model"],
});

// 2️⃣ Error counter
const llmErrorCounter = new client.Counter({
  name: "llm_total_errors",
  help: "Total number of LLM errors",
});

// 3️⃣ First token latency histogram
const llmFirstTokenLatency = new client.Histogram({
  name: "llm_first_token_latency_ms",
  help: "Time taken to receive first token",
  buckets: [100, 500, 1000, 2000, 5000, 10000],
});

// 4️⃣ Total response latency histogram
const llmTotalLatency = new client.Histogram({
  name: "llm_total_latency_ms",
  help: "Total time taken for full LLM response",
  buckets: [500, 1000, 2000, 5000, 10000, 20000],
});

module.exports = {
  register: client.register,
  llmRequestCounter,
  llmErrorCounter,
  llmFirstTokenLatency,
  llmTotalLatency,
  activeSocketConnections,
};
