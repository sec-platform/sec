import path from 'node:path';
import fs from 'node:fs/promises';
import YAML from 'yaml';
import { ensureDir } from './fs.js';

export async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw);
}

export async function writeYaml(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const raw = YAML.stringify(value, { indent: 2 });
  await fs.writeFile(filePath, raw, 'utf8');
}
