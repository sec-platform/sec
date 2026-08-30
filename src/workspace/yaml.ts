import fs from 'node:fs/promises';
import YAML from 'yaml';
import { writeText, type CommitFence } from './files.ts';

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw) as T;
}

export async function writeYaml(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  const raw = YAML.stringify(value, { indent: 2 });
  await writeText(filePath, raw, commitFence);
}
