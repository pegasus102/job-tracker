
import { GoogleGenAI } from "@google/genai";

// ─── Environment configuration ──────────────────────────────

const project = process.env.GOOGLE_CLOUD_PROJECT;

if (!project) {
  throw new Error(
    "Missing GOOGLE_CLOUD_PROJECT environment variable."
  );
}

// Use Google's global Vertex AI endpoint.
// Do not set this to "us".
const location = "global";

// ─── Vertex AI client ───────────────────────────────────────

const vertexAI = new GoogleGenAI({
  vertexai: true,
  project,
  location,
  apiVersion: "v1",
});

// ─── Model configuration ────────────────────────────────────

export const geminiFlash = {
  model: "gemini-3.8-flash",

  async generateContent(prompt: string) {
    return vertexAI.models.generateContent({
      model: this.model,
      contents: prompt,
    });
  },
};

export const geminiPro = {
  model: "gemini-3.1-pro-preview",

  async generateContent(prompt: string) {
    return vertexAI.models.generateContent({
      model: this.model,
      contents: prompt,
    });
  },
};

// ─── Connection test ────────────────────────────────────────

export async function testVertexAI() {
  const response = await geminiPro.generateContent(
    "Reply with exactly: VERTEX_OK"
  );

  console.log("Vertex AI response:", response.text);

  return response.text;
}