
import { GoogleGenAI } from "@google/genai";
import type { ThinkingConfig, Tool } from "@google/genai";

const project = process.env.GOOGLE_CLOUD_PROJECT;
const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!project) {
  throw new Error("Missing GOOGLE_CLOUD_PROJECT");
}

if (!clientEmail || !privateKey) {
  throw new Error(
    "Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY"
  );
}

const vertexAI = new GoogleGenAI({
  vertexai: true,
  project,
  location: "global",
  apiVersion: "v1",
  googleAuthOptions: {
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  },
});

type LegacyRequest = {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    thinkingConfig?: ThinkingConfig;
  };
  tools?: Tool[];
};

function createModel(model: string) {
  return {
    async generateContent(request: LegacyRequest | string) {
      const contents =
        typeof request === "string" ? request : request.contents;

      const generationConfig =
        typeof request === "string"
          ? undefined
          : request.generationConfig;

      const tools =
        typeof request === "string" ? undefined : request.tools;

      const response = await vertexAI.models.generateContent({
        model,
        contents: normalizeContents(contents),
        config: {
          maxOutputTokens: generationConfig?.maxOutputTokens,
          temperature: generationConfig?.temperature,
          responseMimeType: generationConfig?.responseMimeType,
          thinkingConfig: generationConfig?.thinkingConfig,
          tools,
        },
      });

      return {
        response: {
          text: () => response.text ?? "",
          candidates: response.candidates,
          promptFeedback: response.promptFeedback,
          responseId: response.responseId,
          usageMetadata: response.usageMetadata,
        },
        text: response.text,
        candidates: response.candidates,
        promptFeedback: response.promptFeedback,
        responseId: response.responseId,
        usageMetadata: response.usageMetadata,
      };
    },
  };
}

function normalizeContents(
  contents: string | LegacyRequest['contents']
): string | LegacyRequest['contents'] {
  if (typeof contents === 'string') return contents;

  if (
    contents.length === 1 &&
    contents[0].role === 'user' &&
    contents[0].parts.every((part) => typeof part.text === 'string')
  ) {
    return contents[0].parts.map((part) => part.text).join('\n');
  }

  return contents;
}

export const geminiFlash = createModel("gemini-3.8-flash");
export const geminiPro = createModel("gemini-3.1-pro-preview");