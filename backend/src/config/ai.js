const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateResponse(prompt, systemPrompt) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (err) {
    logger.error(`ai.generateResponse: ${err.message}`);
    throw err;
  }
}

module.exports = { generateResponse };
