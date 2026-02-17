const socket = io();

const chatDiv = document.getElementById("chat");
const input = document.getElementById("input");

socket.on("ai_message", (data) => {
  addMessage(data, "ai");
});
              
function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  socket.emit("user_message", text);
  addMessage(text, "user");

  input.value = "";
}

function addMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);
  msg.innerText = text;
  chatDiv.appendChild(msg);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

input.addEventListener("keypress", function (e) {
  if (e.key === "Enter") sendMessage();
});
