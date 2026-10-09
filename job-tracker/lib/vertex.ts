import { VertexAI } from '@google-cloud/vertexai';

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION;

if (!project || !location) {
  throw new Error('GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be configured');
}

const vertexAI = new VertexAI({
  project,
  location,
  googleAuthOptions: {
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  },
});

export const geminiFlash = vertexAI.getGenerativeModel({
  model: 'gemini-3.8-flash',
});

export const geminiPro = vertexAI.getGenerativeModel({
  model: 'gemini-3.1-pro',
});
