import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { compilerRoot } from "../../src/adapters/workspace-context.ts";

const compilerFileCache = new Map<string, string>();

async function readCompilerText(relativePath: string): Promise<string> {
  const cached = compilerFileCache.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = path.join(compilerRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  compilerFileCache.set(relativePath, content);
  return content;
}

type TypeScriptFixturePath = `${string}.${'ts' | 'tsx' | 'mts' | 'cts'}`;
type OrdinaryFixturePath<Path extends string> =
  Extract<Lowercase<Path>, TypeScriptFixturePath> extends never ? Path : never;

/** Literal/union source paths fail typechecking; dynamic paths remain guarded
 * at runtime. The explicit source-analysis reader owns TypeScript access.
 */
export async function readCompilerFile<const Path extends string>(
  relativePath: Path & OrdinaryFixturePath<Path>
): Promise<string> {
  if (/\.(?:[cm]?ts|tsx)$/iu.test(relativePath)) {
    throw new Error(
      `Production TypeScript is not a text fixture; use an explicit hostile-mutation, TCB-analysis, or transpile-input capability: ${relativePath}`
    );
  }
  return readCompilerText(relativePath);
}

export async function readCompilerTypeScriptMutationFixture(
  relativePath: TypeScriptFixturePath,
  purpose: 'hostile-mutation' | 'tcb-analysis' | 'transpile-input'
): Promise<string> {
  if (purpose !== 'hostile-mutation' && purpose !== 'tcb-analysis' && purpose !== 'transpile-input') {
    throw new Error('TypeScript mutation fixture purpose is invalid.');
  }
  return readCompilerText(relativePath);
}

interface CompilerPackage {
  packageManager?: string;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  trustedDependencies?: string[];
}

let cachedRootPackage: CompilerPackage | null = null;

export async function readCompilerPackageJson(): Promise<CompilerPackage> {
  if (cachedRootPackage) return cachedRootPackage;
  cachedRootPackage = await readJson<CompilerPackage>(path.join(compilerRoot, 'package.json'));
  return cachedRootPackage;
}
