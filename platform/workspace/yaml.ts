import fs from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';
import { isFileNotFoundError, writeText, type CommitFence } from './fs.ts';

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw) as T;
}

export async function readOptionalYaml<T>(filePath: string): Promise<T | null> {
  try {
    return await readYaml<T>(filePath);
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

export async function readYamlWithSchema<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse YAML at "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Schema validation failed for "${filePath}":\n${errorMessages}`);
  }
  return result.data;
}

export async function writeYaml(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  const raw = YAML.stringify(value, { indent: 2 });
  await writeText(filePath, raw, commitFence);
}
