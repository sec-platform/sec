import {
  mkdirSync, readFileSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import { encodeVerificationActionData } from '../action/contract/action.ts';

export function writeHostedActionJson(filePath: string, value: unknown): void {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const bytes = `${encodeVerificationActionData(value)}\n`;
  writeFileSync(absolute, bytes, 'utf8');
  if (readFileSync(absolute, 'utf8') !== bytes) throw new Error('Hosted Action JSON readback mismatch.');
}

export function positiveEnvironmentInteger(name: string): number {
  const value = process.env[name];
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer range.`);
  return parsed;
}
