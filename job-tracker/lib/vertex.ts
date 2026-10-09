import { VertexAI } from '@google-cloud/vertexai';

const project = process.env.GOOGLE_CLOUD_PROJECT || '';
const location = process.env.GOOGLE_CLOUD_LOCATION || 'us';

// Configure explicit credentials for Vercel / local compatibility
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

// Correct native Vertex AI endpoints for Gemini 3 models
export const geminiFlash = vertexAI.getGenerativeModel({
  model: 'gemini-3.8-flash',
});

export const geminiPro = vertexAI.getGenerativeModel({
  model: 'gemini-3.1-pro-preview',
});