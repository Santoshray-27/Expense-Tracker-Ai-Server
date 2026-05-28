const { GoogleGenerativeAI } = require('@google/generative-ai');

const initGemini = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not defined in the server's .env file. Running AI features in Simulation (Demo) Mode.");
    return null;
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const requestOptions = { apiVersion: 'v1' };
    const modelName = process.env.GEMINI_MODEL || 'models/gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName }, requestOptions);
    console.info(`Initialized Gemini model: ${modelName} with API version v1`);
    return model;
  } catch (error) {
    console.error("Failed to initialize Google Generative AI SDK:", error);
    return null;
  }
};

module.exports = initGemini;
