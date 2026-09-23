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


export function isPathInside(root: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  // This is lexical containment, not symlink/reparse-point admission. Only
  // a complete parent segment escapes; a child named '..cache' does not.
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolvePathInside(root: string, relativePath: string, options: { allowEmpty?: boolean } = {}): string | null {
  if (!isSafeRelativePath(relativePath, options)) {
    return null;
  }
  const resolvedPath = path.resolve(root, relativePath);
  return isPathInside(root, resolvedPath) ? resolvedPath : null;
}
