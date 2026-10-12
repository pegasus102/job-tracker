import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createCvClient } from '../../../lib/cv-v2/client';

export const JD_MAX = 12_000;
export const JSON_MAX = 180_000;
export const PROJECT_MAX = 30;
export const REQUIREMENT_MAX = 80;
export const RUN_MAX = 12;
export const DAILY_RUN_MAX = Number.parseInt(process.env.CV_V2_MAX_RUNS_PER_DAY ?? '30', 10);

export class CvRouteError extends Error {
  constructor(
    readonly code: 'FEATURE_DISABLED' | 'INVALID_INPUT' | 'INVALID_JSON' | 'NOT_FOUND' | 'RUN_CAP_REACHED' | 'UPSTREAM_FAILED' | 'CONFIGURATION' | 'JD_NEEDS_REVIEW' | 'VALIDATION_HARD' | 'FIT_FAILED',
    message: string,
    readonly status = code === 'FEATURE_DISABLED' ? 404 : code === 'INVALID_INPUT' || code === 'INVALID_JSON' ? 400 : code === 'NOT_FOUND' ? 404 : 500,
  ) {
    super(message);
    this.name = 'CvRouteError';
  }
}

export function ensureEnabled(): void {
  if (process.env.ENABLE_CV_V2 !== 'true') throw new CvRouteError('FEATURE_DISABLED', 'CV v2 is disabled');
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new CvRouteError('INVALID_JSON', 'Request body must be a JSON object');
  }
}

export function requiredText(body: Record<string, unknown>, name: string, max: number): string {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim()) throw new CvRouteError('INVALID_INPUT', `${name} is required`);
  if (value.length > max) throw new CvRouteError('INVALID_INPUT', `${name} exceeds the ${max} character limit`);
  return value.trim();
}

export function optionalText(body: Record<string, unknown>, name: string, max: number): string | undefined {
  const value = body[name];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new CvRouteError('INVALID_INPUT', `${name} exceeds the ${max} character limit`);
  return value.trim();
}

export function boundedArray<T>(value: unknown, name: string, max: number): T[] {
  if (!Array.isArray(value)) throw new CvRouteError('INVALID_INPUT', `${name} must be an array`);
  if (value.length > max) throw new CvRouteError('INVALID_INPUT', `${name} exceeds the ${max} item limit`);
  return value as T[];
}

export function getCvClient() {
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GEMINI_API_KEY) {
    throw new CvRouteError('CONFIGURATION', 'CV model configuration is missing');
  }
  return createCvClient();
}

let supabase: SupabaseClient | undefined;
export function getCvSupabase(): SupabaseClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new CvRouteError('CONFIGURATION', 'CV storage configuration is missing');
  }
  // This client is deliberately used only with cv_* tables in these routes.
  return supabase ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function inputHash(stage: string, body: Record<string, unknown>): string {
  return createHash('sha256').update(stage).update(JSON.stringify(body)).digest('hex');
}

export async function cachedRun(stage: string, hash: string): Promise<unknown | undefined> {
  const { data, error } = await getCvSupabase().from('cv_runs').select('output_json').eq('stage', stage).eq('input_hash', hash).maybeSingle();
  if (error) throw new CvRouteError('UPSTREAM_FAILED', error.message);
  return data?.output_json;
}

export async function saveRun(stage: string, hash: string, output: unknown, jobId?: string): Promise<void> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error: countError } = await getCvSupabase().from('cv_runs').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString());
  if (countError) throw new CvRouteError('UPSTREAM_FAILED', countError.message);
  if ((count ?? 0) >= DAILY_RUN_MAX) throw new CvRouteError('RUN_CAP_REACHED', 'CV run cap reached');
  const { error } = await getCvSupabase().from('cv_runs').insert({
    stage, input_hash: hash, output_json: output, ...(jobId ? { job_id: jobId } : {}),
  });
  if (error) throw new CvRouteError('UPSTREAM_FAILED', error.message);
}

export function responseError(error: unknown): NextResponse {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'JD_NEEDS_REVIEW') {
    return NextResponse.json({ success: false, error: { code: 'JD_NEEDS_REVIEW', message: error instanceof Error ? error.message : 'Job description needs review' } }, { status: 422 });
  }
  if (error instanceof Error && error.message.startsWith('FIT_FAILED')) {
    return NextResponse.json({ success: false, error: { code: 'FIT_FAILED', message: error.message } }, { status: 422 });
  }
  const typed = error instanceof CvRouteError ? error : new CvRouteError('UPSTREAM_FAILED', error instanceof Error ? error.message : 'CV request failed');
  return NextResponse.json({ success: false, error: { code: typed.code, message: typed.message } }, { status: typed.status });
}

export async function route<T>(request: Request, fn: (body: Record<string, unknown>) => Promise<T>): Promise<NextResponse> {
  try {
    ensureEnabled();
    return NextResponse.json({ success: true, data: await fn(await jsonBody(request)) });
  } catch (error) {
    return responseError(error);
  }
}
