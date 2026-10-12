import { readFile } from 'node:fs/promises';

async function main(): Promise<void> {
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const all = { ...packageJson.dependencies, ...packageJson.devDependencies };
console.log(JSON.stringify({
  openaiDeclared: Boolean(all.openai),
  openaiVersion: all.openai ?? null,
  vertexPackages: Object.entries(all).filter(([name]) => name.includes('vertex') || name.includes('genai')),
  note: 'Inspection only; dependencies were not installed or modified by this script.',
}, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
