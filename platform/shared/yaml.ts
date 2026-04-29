import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ensureDir } from './fs.ts';

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw) as T;
}

export type YamlSchemaError = {
  path: string[];
  message: string;
};

export type YamlValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: YamlSchemaError[] };

export interface YamlSchemaValidator<T> {
  validate(value: unknown): YamlValidationResult<T>;
}

export async function readYamlWithSchema<T>(filePath: string, validator: YamlSchemaValidator<T>): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse YAML at "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = validator.validate(parsed);
  if (!result.ok) {
    const errorMessages = result.errors
      .map((error_) => `${error_.path.join('.')}: ${error_.message}`)
      .join('\n');
    throw new Error(`Schema validation failed for "${filePath}":\n${errorMessages}`);
  }
  return result.value;
}

export async function writeYaml(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const raw = YAML.stringify(value, { indent: 2 });
  await fs.writeFile(filePath, raw, 'utf8');
}
