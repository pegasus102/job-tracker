import { createCvClient } from '../lib/cv-v2/client';

const location = 'global';
const models = ['gemini-3.8-flash', 'gemini-3.1-pro-preview'] as const;
const client = createCvClient({ maxCalls: models.length, defaultTimeoutMs: 15_000 });

for (const model of models) {
  try {
    await client.generate({
      model,
      contents: 'Reply with OK.',
      timeoutMs: 15_000,
      stage: 'model_check',
    });
    console.log(`OK ${model} ${location}`);
  } catch {
    console.log(`ERROR ${model} ${location}`);
  }
}
