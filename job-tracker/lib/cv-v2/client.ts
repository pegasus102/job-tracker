import { GoogleGenAI } from '@google/genai';
import type {
  Content,
  Schema,
  ThinkingConfig,
  Tool,
} from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export type CvModel = 'gemini-3.8-flash' | 'gemini-3.1-pro-preview' | (string & {});

export type CvRequest = {
  model: CvModel;
  contents: string | Content | Content[];
  systemInstruction?: string | Content;
  responseSchema?: Schema;
  responseJsonSchema?: unknown;
  responseMimeType?: string;
  thinkingConfig?: ThinkingConfig;
  tools?: Tool[];
  timeoutMs?: number;
  stage?: string;
  inputHash?: string;
};

export type GroundingResult = {
  metadata: unknown;
  sourceUrls: string[];
};

export type CvResponse = {
  text: string;
  finishReason?: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  groundingMetadata?: GroundingResult;
};

type RunMetadata = {
  stage?: string;
  model?: CvModel;
  inputHash?: string;
  finishReason?: string;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  latencyMs?: number;
  attempt?: number;
  thinking?: ThinkingConfig;
};

export type CvTransport = {
  generateContent: (request: {
    model: CvModel;
    contents: string | Content | Content[];
    config: Record<string, unknown>;
  }) => Promise<CvRawResponse>;
};

export type CvRawResponse = {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    groundingMetadata?: unknown;
  }>;
  usageMetadata?: CvResponse['usage'];
};

export type CvClientOptions = {
  maxCalls?: number;
  defaultTimeoutMs?: number;
  transport?: CvTransport;
  runs?: SupabaseClient;
  logger?: (metadata: RunMetadata & Record<string, unknown>) => void;
  retryDelayMs?: number;
};

export class CvRequestError extends Error {
  constructor(
    message: string,
    public readonly code: 'timeout' | 'http' | 'unknown',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CvRequestError';
  }
}

class CvValidationError extends Error {
  constructor(message: string, public readonly pathSummary: string) {
    super(message);
    this.name = 'CvValidationError';
  }
}

type VertexJsonSchema = {
  type?: string;
  properties?: Record<string, VertexJsonSchema>;
  items?: VertexJsonSchema;
  required?: string[];
  enum?: string[];
  [key: string]: unknown;
};

function sanitizeVertexSchema(value: VertexJsonSchema): VertexJsonSchema {
  const schema: VertexJsonSchema = { ...value };
  delete schema.$schema;
  delete schema.$ref;
  delete schema.$defs;
  delete schema.definitions;
  delete schema.additionalProperties;
  delete schema.anyOf;
  delete schema.oneOf;
  delete schema.allOf;
  if (schema.type === 'array' && !schema.items) {
    throw new Error('Vertex schema error: every array schema must define items');
  }
  if (schema.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, sanitizeVertexSchema(child)])
    );
  }
  if (schema.items) schema.items = sanitizeVertexSchema(schema.items);
  return schema;
}

export function zodToVertexSchema<T extends z.ZodTypeAny>(schema: T): VertexJsonSchema {
  const converted = zodToJsonSchema(schema, { $refStrategy: 'none' }) as VertexJsonSchema;
  return sanitizeVertexSchema(converted);
}

const DEFAULT_MAX_CALLS = 8;
const DEFAULT_FLASH_TIMEOUT_MS = 60_000;
const DEFAULT_PRO_TIMEOUT_MS = 150_000;
const DEFAULT_GROUNDED_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function createVertexTransport(): CvTransport {
  const privateKey = requiredEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const ai = new GoogleGenAI({
    vertexai: true,
    project: requiredEnv('GOOGLE_CLOUD_PROJECT'),
    location: 'global',
    apiVersion: 'v1',
    googleAuthOptions: {
      credentials: {
        client_email: requiredEnv('GOOGLE_CLIENT_EMAIL'),
        private_key: privateKey,
      },
    },
  });

  return {
    generateContent: (request) => ai.models.generateContent(request),
  };
}

function sourceUrls(metadata: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'uri' || key === 'url') && typeof child === 'string' && /^https?:\/\//.test(child)) {
        urls.add(child);
      } else {
        visit(child);
      }
    }
  };
  visit(metadata);
  return [...urls];
}

function mapResponse(response: CvRawResponse): CvResponse {
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  return {
    text: response.text ?? '',
    finishReason: response.candidates?.[0]?.finishReason,
    usage: response.usageMetadata,
    groundingMetadata: groundingMetadata
      ? { metadata: groundingMetadata, sourceUrls: sourceUrls(groundingMetadata) }
      : undefined,
  };
}

function hasResponseSchema(request: CvRequest): boolean {
  return request.responseSchema !== undefined || request.responseJsonSchema !== undefined;
}

function hasGoogleSearchTool(tools: Tool[] | undefined): boolean {
  return tools?.some((tool) => {
    const value = tool as Record<string, unknown>;
    return 'googleSearch' in value || value.type === 'google_search' || 'google_search' in value;
  }) ?? false;
}

function parseJsonText(raw: string): unknown {
  const withoutFence = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch (error) {
    throw new Error(`AI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseValidatedJson<T>(raw: string, schema: ZodType<T>): T {
  const result = schema.safeParse(parseJsonText(raw));
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join('.') || 'root');
    throw new CvValidationError(result.error.message, [...new Set(paths)].join(', '));
  }
  return result.data;
}

function metadataForLog(request: CvRequest, response?: CvResponse, error?: unknown): RunMetadata {
  return {
    stage: request.stage ?? 'unspecified',
    model: request.model,
    inputHash: request.inputHash,
    finishReason: response?.finishReason,
    tokensIn: response?.usage?.promptTokenCount,
    tokensOut: response?.usage?.candidatesTokenCount,
    error: error instanceof Error ? error.message : undefined,
    thinking: request.thinkingConfig,
  };
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const candidate of [value.status, value.statusCode, value.response?.status]) {
    if (typeof candidate === 'number') return candidate;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(429|500|503|504)\b/);
  return match ? Number(match[1]) : undefined;
}

function retryableError(error: unknown): boolean {
  return error instanceof CvRequestError && error.code === 'timeout'
    || [429, 500, 503, 504].includes(errorStatus(error) ?? -1);
}

function defaultTimeout(request: CvRequest): number {
  return hasGoogleSearchTool(request.tools)
    ? DEFAULT_GROUNDED_TIMEOUT_MS
    : request.model.includes('pro')
      ? DEFAULT_PRO_TIMEOUT_MS
    : DEFAULT_FLASH_TIMEOUT_MS;
}

async function recordRun(
  runs: SupabaseClient | undefined,
  request: CvRequest,
  response: CvResponse | undefined,
  error: unknown,
  latencyMs: number,
  logger: (metadata: RunMetadata & Record<string, unknown>) => void,
  attempt: number,
): Promise<void> {
  const metadata = { ...metadataForLog(request, response, error), latencyMs, attempt };
  if (!runs) {
    logger(metadata);
    return;
  }

  const { error: insertError } = await runs.from('cv_runs').insert({
    stage: metadata.stage,
    model: metadata.model,
    input_hash: metadata.inputHash,
    tokens_in: metadata.tokensIn,
    tokens_out: metadata.tokensOut,
    latency_ms: metadata.latencyMs,
    error: metadata.error,
    output_json: { attempt: metadata.attempt },
  });
  if (insertError) logger({ ...metadata, loggingError: insertError.message });
}

export function createCvClient(options: CvClientOptions = {}) {
  const transport = options.transport ?? createVertexTransport();
  const maxCalls = options.maxCalls ?? DEFAULT_MAX_CALLS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const defaultTimeoutMs = options.defaultTimeoutMs;
  const logger = options.logger ?? ((metadata) => console.warn('CV run metadata', metadata));
  let callCount = 0;
  const validationRetryStages = new Set<string>();

  async function generate(request: CvRequest): Promise<CvResponse> {
    if (hasResponseSchema(request) && hasGoogleSearchTool(request.tools)) {
      throw new Error('Google Search grounding cannot be combined with a response schema; use separate calls.');
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (callCount >= maxCalls) throw new CvRequestError(`CV call cap exceeded (${maxCalls})`, 'unknown');
      callCount += 1;
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs ?? defaultTimeout(request);
      let rejectTimeout: ((error: Error) => void) | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        rejectTimeout = reject;
      });
      const timeout = setTimeout(() => {
        controller.abort();
        rejectTimeout?.(new CvRequestError(`CV request timed out after ${timeoutMs}ms`, 'timeout'));
      }, timeoutMs);
      const config: Record<string, unknown> = {
        abortSignal: controller.signal,
        systemInstruction: request.systemInstruction,
        responseSchema: request.responseSchema,
        responseJsonSchema: request.responseJsonSchema,
        responseMimeType: hasResponseSchema(request) ? request.responseMimeType ?? 'application/json' : request.responseMimeType,
        thinkingConfig: request.thinkingConfig,
        tools: request.tools,
      };
      const startedAt = Date.now();
      try {
        const response = await Promise.race([
          transport.generateContent({ model: request.model, contents: request.contents, config }),
          timeoutPromise,
        ]);
        const mapped = mapResponse(response);
        await recordRun(options.runs, request, mapped, undefined, Date.now() - startedAt, logger, attempt);
        return mapped;
      } catch (rawError) {
        const error = rawError instanceof CvRequestError
          ? rawError
          : new CvRequestError(rawError instanceof Error ? rawError.message : String(rawError), errorStatus(rawError) ? 'http' : 'unknown', errorStatus(rawError));
        await recordRun(options.runs, request, undefined, error, Date.now() - startedAt, logger, attempt);
        if (attempt === 1 && retryableError(error)) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new CvRequestError('CV request failed after retry', 'unknown');
  }

  async function generateValidatedJson<T>(
    request: CvRequest,
    schema: ZodType<T>,
    validationRetry?: (error: string) => CvRequest
  ): Promise<{ value: T; response: CvResponse }> {
    const firstResponse = await generate(request);
    try {
      return { value: parseValidatedJson(firstResponse.text, schema), response: firstResponse };
    } catch (firstError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const pathSummary = firstError instanceof CvValidationError ? firstError.pathSummary : 'root';
      const validationError = new Error(`validation failed at ${pathSummary}`);
      await recordRun(options.runs, request, undefined, validationError, 0, logger, 1);
      const stage = request.stage ?? 'unspecified';
      if (!validationRetry || validationRetryStages.has(stage)) {
        throw new Error(`AI JSON validation failed: ${firstMessage}`);
      }
      validationRetryStages.add(stage);
      const retryRequest = validationRetry(`Validation failed at ${pathSummary}. Return corrected JSON only.`);
      const retryResponse = await generate(retryRequest);
      try {
        return { value: parseValidatedJson(retryResponse.text, schema), response: retryResponse };
      } catch (secondError) {
        throw new Error(`AI JSON validation failed after retry: ${secondError instanceof Error ? secondError.message : String(secondError)}`);
      }
    }
  }

  return {
    generate,
    generateValidatedJson,
    getCallCount: () => callCount,
  };
}


export const jsonObjectSchema = z.record(z.unknown());
