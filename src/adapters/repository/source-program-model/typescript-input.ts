import type {
  SourceProgramCompilation,
  SourceProgramFileInput
} from './contract.ts';
import {
  sourceProgramSurfaceForPath
} from './contract.ts';
import type {
  RepositoryModuleMembership
} from '../architecture/contract.ts';
import {
  normalizeRepositoryModulePath
} from '../architecture/contract.ts';
import type {
  SourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import path from 'node:path';
import {
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import {
  recordTypeScriptPerformance
} from './typescript-performance.ts';

/** Exact source input snapshots and their private issuance registry. */
export interface TypeScriptModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: RepositoryModuleMembership;
  readonly operation?: SourceProgramCompilationOperation;
}

export type TypeScriptModelInternalInput = TypeScriptModelInput & Readonly<{
  repositoryCompilation?: SourceProgramCompilation;
  sourceFileIdentities?: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
}>;

const preparedTypeScriptSourceProgramInputBrand: unique symbol = Symbol(
  'prepared-typescript-source-program-input'
);

const issuedPreparedTypeScriptSourceProgramInputs = new WeakSet<object>();

export type PreparedTypeScriptModelInput = TypeScriptModelInternalInput & Readonly<{
  readonly [preparedTypeScriptSourceProgramInputBrand]: true;
  readonly operation: SourceProgramCompilationOperation;
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>;
}>;

export type TypeScriptSourceProgramFileIdentity = Readonly<{
  file: SourceProgramFileInput;
  moduleDigest: `sha256:${string}`;
  rawFileDigest: `sha256:${string}`;
}>;

export const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/iu;

function canonicalPath(value: string): string {
  const normalized = normalizeRepositoryModulePath(value);
  if (normalized !== value || value.length === 0 || value.startsWith('../') || path.posix.isAbsolute(value)) {
    throw new Error(`Source Program Model path is not canonical: ${value}`);
  }
  return normalized;
}

export function canonicalTypeScriptFile(raw: SourceProgramFileInput): SourceProgramFileInput {
  const repositoryPathValue = canonicalPath(raw.path);
  if (!/^sha256:[0-9a-f]{64}$/u.test(raw.contentDigest)) {
    throw new Error(`Source Program Model file has invalid content digest: ${repositoryPathValue}`);
  }
  return Object.freeze({ ...raw, path: repositoryPathValue });
}

export function sourceProgramFileSnapshotDigest(
  file: SourceProgramFileInput,
  sourceDigest?: string
): `sha256:${string}` {
  let exactSourceDigest = sourceDigest;
  if (exactSourceDigest === undefined) {
    recordTypeScriptPerformance('rawSourceHashOperations', 1);
    recordTypeScriptPerformance('rawSourceHashBytes', Buffer.byteLength(file.source, 'utf8'));
    exactSourceDigest = rawSha256(file.source);
  }
  return sha256({
    declaredContentDigest: file.contentDigest,
    sourceDigest: exactSourceDigest
  }) as `sha256:${string}`;
}

export function prepareTypeScriptSourceProgramInput(
  input: TypeScriptModelInternalInput
): PreparedTypeScriptModelInput {
  if (issuedPreparedTypeScriptSourceProgramInputs.has(input)) {
    return input as PreparedTypeScriptModelInput;
  }
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'admission');
  input.repositoryCompilation?.assertMatches(input);
  const trustedSnapshot = input.repositoryCompilation;
  const identities = new Map<string, TypeScriptSourceProgramFileIdentity>();
  for (const raw of input.files) {
    const surface = sourceProgramSurfaceForPath(raw.path);
    if (!SOURCE_EXTENSION.test(raw.path)
        || (surface !== 'production' && surface !== 'test')) continue;
    const file = canonicalTypeScriptFile(raw);
    if (identities.has(file.path)) {
      throw new Error(`Source Program Model snapshot contains duplicate path: ${file.path}`);
    }
    const trustedFile = trustedSnapshot?.file(file.path) ?? null;
    if (trustedSnapshot !== undefined && (
      trustedFile === null || trustedFile.contentDigest !== file.contentDigest
    )) {
      throw new Error(`Workspace Source Program file identity is unavailable: ${file.path}`);
    }
    identities.set(file.path, Object.freeze({
      file,
      moduleDigest: sha256(input.moduleMembership.moduleForPath(file.path)) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(
        file,
        trustedSnapshot === undefined ? undefined : file.contentDigest
      )
    }));
  }
  return issuePreparedTypeScriptSourceProgramInput({ ...input, operation }, identities);
}

export function issuePreparedTypeScriptSourceProgramInput(
  input: TypeScriptModelInternalInput & Readonly<{
    operation: SourceProgramCompilationOperation;
  }>,
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>
): PreparedTypeScriptModelInput {
  const prepared = Object.freeze({
    ...input,
    [preparedTypeScriptSourceProgramInputBrand]: true as const,
    sourceFileIdentities
  });
  issuedPreparedTypeScriptSourceProgramInputs.add(prepared);
  return prepared;
}
