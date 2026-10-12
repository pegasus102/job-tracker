import { describe, expect, it, vi } from 'vitest';
import { createCvClient, parseValidatedJson, type CvRawResponse, type CvTransport } from '../lib/cv-v2/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const response = (text: string) => ({
  text,
  candidates: [{ finishReason: 'STOP', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source' } }] } }],
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
});

describe('cv client', () => {
  it('strips JSON fences and validates with zod', () => {
    expect(parseValidatedJson('```json\n{"answer":"ok"}\n```', z.object({ answer: z.string() }))).toEqual({ answer: 'ok' });
  });

  it('retries once with the validation error included', async () => {
    const calls: Array<Parameters<CvTransport['generateContent']>[0]> = [];
    const transport = {
      generateContent: vi.fn(async (request: Parameters<CvTransport['generateContent']>[0]) => {
        calls.push(request);
        return response(calls.length === 1 ? '{"answer":1}' : '{"answer":"ok"}');
      }),
    };
    const client = createCvClient({ transport, maxCalls: 2 });
    const result = await client.generateValidatedJson(
      { model: 'test-model', contents: 'input', stage: 'test' },
      z.object({ answer: z.string() }),
      (error) => ({ model: 'test-model', contents: `Fix validation error: ${error}`, stage: 'retry' })
    );
    expect(result.value).toEqual({ answer: 'ok' });
    expect(calls[1].contents).toContain('Fix validation error:');
  });

  it('enforces the per-client call cap', async () => {
    const transport = { generateContent: vi.fn(async () => response('{"ok":true}')) };
    const client = createCvClient({ transport, maxCalls: 1 });
    await client.generate({ model: 'test-model', contents: 'one' });
    await expect(client.generate({ model: 'test-model', contents: 'two' })).rejects.toThrow('call cap exceeded');
    expect(transport.generateContent).toHaveBeenCalledTimes(1);
  });

  it('aborts a timed-out request', async () => {
    const transport = {
      generateContent: vi.fn((request: Parameters<CvTransport['generateContent']>[0]): Promise<CvRawResponse> => {
        void request;
        return new Promise(() => {});
      }),
    };
    const client = createCvClient({ transport, defaultTimeoutMs: 5, retryDelayMs: 0 });
    await expect(client.generate({ model: 'test-model', contents: 'slow' })).rejects.toThrow('timed out');
  });

  it('retries a timeout once and succeeds, counting both attempts toward the cap', async () => {
    let calls = 0;
    const transport = {
      generateContent: vi.fn((request: Parameters<CvTransport['generateContent']>[0]): Promise<CvRawResponse> => {
        void request;
        calls += 1;
        return calls === 1 ? new Promise(() => {}) : Promise.resolve(response('recovered'));
      }),
    };
    const client = createCvClient({ transport, defaultTimeoutMs: 5, retryDelayMs: 0, maxCalls: 2 });
    await expect(client.generate({ model: 'test-model', contents: 'retry' })).resolves.toMatchObject({ text: 'recovered' });
    expect(client.getCallCount()).toBe(2);
  });

  it('does not retry a non-retryable 400 error', async () => {
    const transport = {
      generateContent: vi.fn(async () => {
        const error = new Error('HTTP 400 invalid request') as Error & { status: number };
        error.status = 400;
        throw error;
      }),
    };
    const client = createCvClient({ transport, retryDelayMs: 0 });
    await expect(client.generate({ model: 'test-model', contents: 'bad' })).rejects.toThrow('HTTP 400');
    expect(transport.generateContent).toHaveBeenCalledTimes(1);
  });

  it('counts a retry toward the call cap', async () => {
    const transport = {
      generateContent: vi.fn(async () => {
        throw Object.assign(new Error('HTTP 503 unavailable'), { status: 503 });
      }),
    };
    const client = createCvClient({ transport, maxCalls: 2, retryDelayMs: 0 });
    await expect(client.generate({ model: 'test-model', contents: 'retry' })).rejects.toThrow('HTTP 503');
    expect(client.getCallCount()).toBe(2);
    await expect(client.generate({ model: 'test-model', contents: 'capped' })).rejects.toThrow('call cap exceeded');
  });

  it('respects a per-call timeout override', async () => {
    const transport = {
      generateContent: vi.fn((): Promise<CvRawResponse> => new Promise(() => {})),
    };
    const client = createCvClient({ transport, defaultTimeoutMs: 1000, retryDelayMs: 0, maxCalls: 2 });
    const started = Date.now();
    await expect(client.generate({ model: 'test-model', contents: 'fast timeout', timeoutMs: 5 })).rejects.toThrow('5ms');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('maps usage, finish reason, and grounding source URLs', async () => {
    const client = createCvClient({
      transport: { generateContent: vi.fn(async () => response('ok')) },
    });

    await expect(client.generate({ model: 'test-model', contents: 'input' })).resolves.toMatchObject({
      text: 'ok',
      finishReason: 'STOP',
      usage: { promptTokenCount: 3, candidatesTokenCount: 4 },
      groundingMetadata: { sourceUrls: ['https://example.com/source'] },
    });
  });

  it('uses the 180 second timeout default for grounded research', async () => {
    const transport = {
      generateContent: vi.fn((request: { config: Record<string, unknown> }): Promise<CvRawResponse> => {
        expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
        return Promise.resolve(response('ok'));
      }),
    };
    const client = createCvClient({ transport });
    await client.generate({ model: 'gemini-3.8-flash', contents: 'research', tools: [{ googleSearch: {} }], stage: 'grounded_research' });
    expect(client.getCallCount()).toBe(1);
  });

  it('forwards schema, system instruction, tools, thinking config, and abort signal', async () => {
    const transport = {
      generateContent: vi.fn(async (request: { config: Record<string, unknown> }) => response(JSON.stringify(request.config.responseJsonSchema))),
    };
    const client = createCvClient({ transport });
    await client.generate({
      model: 'test-model',
      contents: 'input',
      systemInstruction: 'Use JSON.',
      responseJsonSchema: { type: 'object' },
      thinkingConfig: { thinkingBudget: 10 },
      tools: [{ codeExecution: {} }],
    });
    const config = transport.generateContent.mock.calls[0][0].config;
    expect(config.responseJsonSchema).toEqual({ type: 'object' });
    expect(config.responseMimeType).toBe('application/json');
    expect(config.systemInstruction).toBe('Use JSON.');
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 10 });
    expect(config.tools).toEqual([{ codeExecution: {} }]);
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('preserves an explicitly supplied response MIME type', async () => {
    const transport = {
      generateContent: vi.fn(async (request: { config: Record<string, unknown> }) => response(JSON.stringify(request.config.responseSchema))),
    };
    const client = createCvClient({ transport });
    await client.generate({
      model: 'test-model',
      contents: 'input',
      responseJsonSchema: { type: 'object' },
      responseMimeType: 'text/plain',
    });
    expect(transport.generateContent.mock.calls[0][0].config.responseMimeType).toBe('text/plain');
  });

  it('rejects a response schema combined with Google Search', async () => {
    const transport = { generateContent: vi.fn(async () => response('{}')) };
    const client = createCvClient({ transport });
    await expect(client.generate({
      model: 'test-model',
      contents: 'input',
      responseJsonSchema: { type: 'object' },
      tools: [{ googleSearch: {} }],
    })).rejects.toThrow('cannot be combined with a response schema');
    expect(transport.generateContent).not.toHaveBeenCalled();
  });

  it('falls back to metadata-only logging when cv_runs is unavailable', async () => {
    const logger = vi.fn();
    const runs = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ error: { message: 'cv_runs does not exist' } })),
      })),
    } as unknown as SupabaseClient;
    const client = createCvClient({
      runs,
      logger,
      transport: { generateContent: vi.fn(async () => response('safe output')) },
    });

    await client.generate({
      model: 'test-model',
      contents: 'private candidate text',
      stage: 'writing',
    });

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'writing',
      model: 'test-model',
    }));
    expect(JSON.stringify(logger.mock.calls[0][0])).not.toContain('private candidate text');
  });
});
