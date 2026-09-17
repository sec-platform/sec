import path from 'node:path';

/** Lexical spelling only; never filesystem containment or write authority. */
export function posixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function relativePosixPath(from: string, to: string): string {
  return posixPath(path.relative(from, to));
}

export function isSafeRelativePath(value: string, options: { allowEmpty?: boolean } = {}): boolean {
  if (value.length === 0) {
    return options.allowEmpty === true;
  }
  const normalized = posixPath(value);
  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || normalized.startsWith('//')) {
    return false;
  }
  return !normalized.split('/').includes('..');
}

