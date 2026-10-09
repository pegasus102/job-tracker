import { VertexAI } from '@google-cloud/vertexai';

const project = process.env.GOOGLE_CLOUD_PROJECT || '';
// Keep location strictly as 'us' or let it fallback cleanly for global multi-region model endpoints
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us';

const googleAuthOptions = {
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
};

const vertexAI = new VertexAI({
  project,
  location,
  googleAuthOptions,
});

// Explicitly mapped to Gemini 3.8 Flash and Gemini 3.1 Pro Preview
export const geminiFlash = vertexAI.getGenerativeModel({
  model: 'gemini-3.8-flash',
});

export const geminiPro = vertexAI.getGenerativeModel({
  model: 'gemini-3.1-pro-preview',
});