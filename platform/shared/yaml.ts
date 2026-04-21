import path from 'node:path';
import fs from 'node:fs/promises';
import YAML from 'yaml';
import { ensureDir } from './fs.ts';

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw) as T;
}

export async function writeYaml(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const raw = YAML.stringify(value, { indent: 2 });
  await fs.writeFile(filePath, raw, 'utf8');
}
