import path from 'node:path';

export function projectRelativeImport(fromFile: string, toFile: string): string {
  const relativePath = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

export function rebaseRelativeImports(source: string, fromFile: string, toFile: string): string {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => {
    const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return `${prefix}${projectRelativeImport(toFile, resolvedTarget)}${suffix}`;
  });
}
