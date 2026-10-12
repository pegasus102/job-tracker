import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lintBullets } from '../lib/cv-v2/bullet-quality';

type JsonObject = Record<string, unknown>;

function entries(profile: JsonObject, key: 'master_projects' | 'master_experience'): Array<{ id: string; bullets: string[] }> {
  const values = Array.isArray(profile[key]) ? profile[key] : [];
  return values.filter((value): value is JsonObject => Boolean(value) && typeof value === 'object')
    .map((value, index) => ({
      id: typeof value.id === 'string' ? value.id : `${key}.${index}`,
      bullets: Array.isArray(value.bullets) ? value.bullets.filter((bullet): bullet is string => typeof bullet === 'string') : [],
    }));
}

async function main(): Promise<void> {
  const profile = JSON.parse(await readFile(resolve(process.cwd(), 'dev-data/profile.json'), 'utf8')) as JsonObject;
  const data = profile.data && typeof profile.data === 'object' && !Array.isArray(profile.data) ? profile.data as JsonObject : profile;
  const bullets = [
    ...entries(data, 'master_projects').flatMap((entry) => entry.bullets.map((text, index) => ({ path: `projects.${entry.id}.${index}`, text }))),
    ...entries(data, 'master_experience').flatMap((entry) => entry.bullets.map((text, index) => ({ path: `experience.${entry.id}.${index}`, text }))),
  ];
  const report = lintBullets(bullets);
  console.log(JSON.stringify({
    source: 'dev-data/profile.json',
    bulletCount: bullets.length,
    warningCount: report.warnings.length,
    counts: report.counts,
    warnings: report.warnings,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
