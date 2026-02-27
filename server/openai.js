const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateStream(messages, onChunk) {

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages,
    stream: true,
    temperature: 0.7,
  });

  let fullText = "";

  for await (const chunk of stream) {

    const content = chunk.choices[0]?.delta?.content;

    if (content) {
      fullText += content;
      onChunk(content);
    }
  }

  return fullText;
}

module.exports = { generateStream };