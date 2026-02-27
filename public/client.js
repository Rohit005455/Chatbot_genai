const socket = io();

const chatDiv = document.getElementById("chat");
const input = document.getElementById("input");

let currentAIMessageDiv = null;

// Streaming chunk received
socket.on("ai_stream", (chunk) => {
  if (!currentAIMessageDiv) {
    currentAIMessageDiv = createMessageDiv("", "ai");
  }

  currentAIMessageDiv.innerText += chunk;
  chatDiv.scrollTop = chatDiv.scrollHeight;
});

// Stream ended
socket.on("ai_stream_end", () => {
  currentAIMessageDiv = null;
});

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  socket.emit("user_message", text);
  addMessage(text, "user");

  input.value = "";
}

function addMessage(text, sender) {
  const msg = createMessageDiv(text, sender);
  msg.innerText = text;
  chatDiv.appendChild(msg);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function createMessageDiv(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);
  chatDiv.appendChild(msg);
  return msg;
}

input.addEventListener("keypress", function (e) {
  if (e.key === "Enter") sendMessage();
});