import { open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { compilerRuntimeLayout } from '../../../toolchain/runtime.ts';

import { getErrorCode } from '../../../compiler/errors.ts';
import { sortedKeys } from '../../../compiler/semantic-mutation/canonical.ts';

export const SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT =
  'semantic-mutation-isolated-progress-v1' as const;
export const SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH =
  '.isolated-compiler/src/application/engineering/semantic-mutation-isolated-verification-bootstrap.mjs' as const;
export const SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH =
  '.isolated-compiler/src/application/engineering/semantic-mutation-isolated-verification-loader.mjs' as const;
export const SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH =
  `.isolated-compiler/${compilerRuntimeLayout.artifactEntrypointRelativePath}`;

export const SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered',
  'catch-armed',
  'verify-all',
  'postcondition',
  'failure-caught',
  'catch-tree-validated',
  'outcome-publish-started'
] as const);

export type SemanticMutationIsolatedProgressCheckpoint =
  (typeof SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS)[number];

export const SEMANTIC_MUTATION_ISOLATED_EXIT_CODES = Object.freeze({
  runnerControlledFailure: 70,
  runnerEntryFailure: 71,
  runnerCatchTreeFailure: 72,
  outcomePublicationFailure: 73,
  progressPublicationFailure: 74,
  loaderImportFailure: 75,
  runnerStagingTreeFailure: 76,
  runnerEnvironmentBoundaryFailure: 77,
  runnerStagingLayoutBoundaryFailure: 78,
  bootstrapEnvironmentBoundaryFailure: 79
} as const);

export type SemanticMutationIsolatedTerminationClass =
  | 'zero'
  | 'runner-controlled-failure'
  | 'runner-entry-failure'
  | 'bootstrap-environment-boundary-failure'
  | 'runner-environment-boundary-failure'
  | 'runner-staging-layout-boundary-failure'
  | 'runner-staging-tree-failure'
  | 'runner-catch-tree-failure'
  | 'outcome-publication-failure'
  | 'progress-publication-failure'
  | 'loader-import-failure'
  | 'unclassified-nonzero';

export interface SemanticMutationIsolatedProgressTrace {
  readonly checkpoints: readonly SemanticMutationIsolatedProgressCheckpoint[];
  readonly lastCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
  readonly pendingCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
}

export type SemanticMutationIsolatedProgressReadResult =
  | Readonly<{ readonly status: 'valid'; readonly trace: SemanticMutationIsolatedProgressTrace }>
  | Readonly<{ readonly status: 'parse-error' | 'read-error' | 'protocol-error' }>;

const MAX_CHECKPOINT_BYTES = 256;
const CHECKPOINT_INDEX = new Map<SemanticMutationIsolatedProgressCheckpoint, number>(
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS.map((checkpoint, index) => [checkpoint, index])
);
const RUNNER_ENTERED_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[]);
const ALLOWED_FINAL_TRACES: readonly (readonly SemanticMutationIsolatedProgressCheckpoint[])[] =
  Object.freeze([
    [],
    ['bootstrap-entered'],
    ['bootstrap-entered', 'loader-entered'],
    ['bootstrap-entered', 'loader-entered', 'core-import-started'],
    RUNNER_ENTERED_TRACE,
    [...RUNNER_ENTERED_TRACE, 'catch-armed'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught', 'catch-tree-validated'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught', 'catch-tree-validated',
      'outcome-publish-started'
    ],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught',
      'catch-tree-validated'
    ],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught',
      'catch-tree-validated', 'outcome-publish-started'
    ],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught',
      'catch-tree-validated'
    ],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught',
      'catch-tree-validated', 'outcome-publish-started'
    ]
  ]);

function checkpointStem(checkpoint: SemanticMutationIsolatedProgressCheckpoint): string {
  const index = CHECKPOINT_INDEX.get(checkpoint);
  if (index === undefined) throw new Error('Semantic Mutation isolated checkpoint is unknown');
  return `semantic-mutation-isolated-progress-v1-${String(index).padStart(2, '0')}-${checkpoint}`;
}

export function semanticMutationIsolatedProgressCheckpointPath(
  stagingWorkspaceRoot: string,
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    '.isolated-process',
    'child',
    `${checkpointStem(checkpoint)}.json`
  );
}

export function semanticMutationIsolatedProgressCheckpointPendingPath(
  stagingWorkspaceRoot: string,
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): string {
  return path.join(
    path.resolve(stagingWorkspaceRoot),
    '.isolated-process',
    'child',
    `.${checkpointStem(checkpoint)}.pending`
  );
}

export function semanticMutationIsolatedProgressOwnedPaths(
  stagingWorkspaceRoot: string
): readonly string[] {
  return Object.freeze(SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS.flatMap((checkpoint) => [
    semanticMutationIsolatedProgressCheckpointPath(stagingWorkspaceRoot, checkpoint),
    semanticMutationIsolatedProgressCheckpointPendingPath(stagingWorkspaceRoot, checkpoint)
  ]));
}

export function semanticMutationIsolatedProgressCheckpointBytes(
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Uint8Array {
  if (!CHECKPOINT_INDEX.has(checkpoint)) {
    throw new Error('Semantic Mutation isolated checkpoint is unknown');
  }
  return new TextEncoder().encode(`${JSON.stringify({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT,
    checkpoint
  })}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function parseCheckpointBytes(
  bytes: Uint8Array,
  expected: SemanticMutationIsolatedProgressCheckpoint
): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_CHECKPOINT_BYTES) {
    return false;
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const keys = sortedKeys(record);
  if (keys.length !== 2 || keys[0] !== 'checkpoint' || keys[1] !== 'formatVersion' ||
    record.formatVersion !== SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT ||
    record.checkpoint !== expected) {
    return false;
  }
  return sameBytes(bytes, semanticMutationIsolatedProgressCheckpointBytes(expected));
}

function sameTrace(
  left: readonly SemanticMutationIsolatedProgressCheckpoint[],
  right: readonly SemanticMutationIsolatedProgressCheckpoint[]
): boolean {
  return left.length === right.length && left.every((checkpoint, index) => checkpoint === right[index]);
}

function isAllowedFinalTrace(trace: readonly SemanticMutationIsolatedProgressCheckpoint[]): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) => sameTrace(trace, allowed));
}

function isAllowedTransition(
  trace: readonly SemanticMutationIsolatedProgressCheckpoint[],
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) =>
    allowed.length === trace.length + 1 &&
    allowed[allowed.length - 1] === checkpoint &&
    allowed.slice(0, -1).every((value, index) => value === trace[index]));
}

async function readOptionalBytes(filePath: string): Promise<
  | Readonly<{ readonly status: 'absent' }>
  | Readonly<{ readonly status: 'ok'; readonly bytes: Uint8Array }>
  | Readonly<{ readonly status: 'oversized' | 'read-error' }>
> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch (error) {
    return { status: getErrorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
  let result:
    | Readonly<{ readonly status: 'ok'; readonly bytes: Uint8Array }>
    | Readonly<{ readonly status: 'oversized' | 'read-error' }>;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      result = { status: 'read-error' };
    } else if (metadata.size > MAX_CHECKPOINT_BYTES) {
      result = { status: 'oversized' };
    } else {
      const buffer = Buffer.alloc(MAX_CHECKPOINT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      result = bytesRead > MAX_CHECKPOINT_BYTES
        ? { status: 'oversized' }
        : { status: 'ok', bytes: new Uint8Array(buffer.subarray(0, bytesRead)) };
    }
  } catch {
    result = { status: 'read-error' };
  }
  try {
    await handle.close();
  } catch {
    return { status: 'read-error' };
  }
  return result;
}

export async function readSemanticMutationIsolatedProgressTrace(
  stagingWorkspaceRoot: string,
  beforeRead: () => Promise<void> = async () => undefined
): Promise<SemanticMutationIsolatedProgressReadResult> {
  const ownedNames = new Set(
    semanticMutationIsolatedProgressOwnedPaths(stagingWorkspaceRoot).map((filePath) => path.basename(filePath))
  );
  await beforeRead();
  try {
    const childRoot = path.join(path.resolve(stagingWorkspaceRoot), '.isolated-process', 'child');
    const names = await readdir(childRoot);
    if (names.some((name) =>
      (name.startsWith('semantic-mutation-isolated-progress-v1-') ||
        name.startsWith('.semantic-mutation-isolated-progress-v1-')) &&
      !ownedNames.has(name))) {
      return { status: 'protocol-error' };
    }
  } catch (error) {
    if (getErrorCode(error) !== 'ENOENT') return { status: 'read-error' };
  }
  const checkpoints: SemanticMutationIsolatedProgressCheckpoint[] = [];
  const pending: SemanticMutationIsolatedProgressCheckpoint[] = [];
  for (const checkpoint of SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS) {
    await beforeRead();
    const final = await readOptionalBytes(
      semanticMutationIsolatedProgressCheckpointPath(stagingWorkspaceRoot, checkpoint)
    );
    if (final.status === 'read-error') return { status: 'read-error' };
    if (final.status === 'oversized') return { status: 'parse-error' };
    if (final.status === 'ok') {
      if (!parseCheckpointBytes(final.bytes, checkpoint)) return { status: 'parse-error' };
      checkpoints.push(checkpoint);
    }
    await beforeRead();
    const pendingResult = await readOptionalBytes(
      semanticMutationIsolatedProgressCheckpointPendingPath(stagingWorkspaceRoot, checkpoint)
    );
    if (pendingResult.status === 'read-error') return { status: 'read-error' };
    if (pendingResult.status === 'oversized') return { status: 'protocol-error' };
    if (pendingResult.status === 'ok') pending.push(checkpoint);
  }
  if (!isAllowedFinalTrace(checkpoints) || pending.length > 1 ||
    (pending[0] !== undefined && !isAllowedTransition(checkpoints, pending[0]))) {
    return { status: 'protocol-error' };
  }
  return {
    status: 'valid',
    trace: Object.freeze({
      checkpoints: Object.freeze([...checkpoints]),
      ...(checkpoints.at(-1) === undefined ? {} : { lastCheckpoint: checkpoints.at(-1)! }),
      ...(pending[0] === undefined ? {} : { pendingCheckpoint: pending[0] })
    })
  };
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = getErrorCode(error);
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function failWithProgressPendingCleanup(
  pendingPath: string,
  primaryError: unknown
): Promise<never> {
  try {
    await rm(pendingPath, { force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Semantic Mutation isolated progress publication failed and pending cleanup also failed'
    );
  }
  throw primaryError;
}

export class SemanticMutationIsolatedProgressPublicationError extends Error {
  constructor(cause?: unknown) {
    super('Semantic Mutation isolated progress publication failed', { cause });
    this.name = 'SemanticMutationIsolatedProgressPublicationError';
  }
}

export async function publishSemanticMutationIsolatedProgressCheckpoint(
  stagingWorkspaceRoot: string,
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Promise<void> {
  try {
    const existing = await readSemanticMutationIsolatedProgressTrace(stagingWorkspaceRoot);
    if (existing.status !== 'valid' || existing.trace.pendingCheckpoint !== undefined ||
      !isAllowedTransition(existing.trace.checkpoints, checkpoint)) {
      throw new Error('Semantic Mutation isolated progress transition is invalid');
    }
    const bytes = semanticMutationIsolatedProgressCheckpointBytes(checkpoint);
    const finalPath = semanticMutationIsolatedProgressCheckpointPath(stagingWorkspaceRoot, checkpoint);
    const pendingPath = semanticMutationIsolatedProgressCheckpointPendingPath(
      stagingWorkspaceRoot,
      checkpoint
    );
    let pendingOwned = false;
    try {
      const handle = await open(pendingPath, 'wx', 0o600);
      pendingOwned = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(pendingPath, finalPath);
      pendingOwned = false;
      await fsyncDirectory(path.dirname(finalPath));
    } catch (error) {
      if (pendingOwned) await failWithProgressPendingCleanup(pendingPath, error);
      throw error;
    }
  } catch (error) {
    if (error instanceof SemanticMutationIsolatedProgressPublicationError) throw error;
    throw new SemanticMutationIsolatedProgressPublicationError(error);
  }
}

export function classifySemanticMutationIsolatedTermination(
  exitCode: number
): SemanticMutationIsolatedTerminationClass {
  if (!Number.isSafeInteger(exitCode) || exitCode < 0) {
    throw new Error('Semantic Mutation isolated exit code is invalid');
  }
  if (exitCode === 0) return 'zero';
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure) {
    return 'runner-controlled-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEntryFailure) {
    return 'runner-entry-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerCatchTreeFailure) {
    return 'runner-catch-tree-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.outcomePublicationFailure) {
    return 'outcome-publication-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure) {
    return 'progress-publication-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure) {
    return 'loader-import-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure) {
    return 'runner-staging-tree-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure) {
    return 'runner-environment-boundary-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure) {
    return 'runner-staging-layout-boundary-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure) {
    return 'bootstrap-environment-boundary-failure';
  }
  return 'unclassified-nonzero';
}

function generatedCheckpointBinding(
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Readonly<{
  readonly bytes: string;
  readonly finalRelativePath: string;
  readonly pendingRelativePath: string;
}> {
  return Object.freeze({
    bytes: new TextDecoder().decode(semanticMutationIsolatedProgressCheckpointBytes(checkpoint)),
    finalRelativePath: path.relative(
      path.resolve('.'),
      semanticMutationIsolatedProgressCheckpointPath('.', checkpoint)
    ).split(path.sep).join('/'),
    pendingRelativePath: path.relative(
      path.resolve('.'),
      semanticMutationIsolatedProgressCheckpointPendingPath('.', checkpoint)
    ).split(path.sep).join('/')
  });
}

export interface SemanticMutationIsolatedBundledLoaderBinding {
  readonly formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1';
  readonly executionRevision: 'semantic-mutation-bundled-core-relocation-v1';
}

function assertBundledLoaderBinding(
  binding: SemanticMutationIsolatedBundledLoaderBinding
): void {
  if (binding.formatRevision !== 'semantic-mutation-isolated-bundled-loader-binding-v1' ||
    binding.executionRevision !== 'semantic-mutation-bundled-core-relocation-v1') {
    throw new Error('Semantic Mutation bundled loader binding is invalid');
  }
}

export function semanticMutationIsolatedStagedLoaderBytes(
  binding: SemanticMutationIsolatedBundledLoaderBinding
): Uint8Array {
  assertBundledLoaderBinding(binding);
  const loaderCheckpoints = [
    'loader-entered',
    'core-import-started'
  ] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[];
  const bindings = Object.fromEntries(loaderCheckpoints.map((checkpoint) => [
    checkpoint,
    generatedCheckpointBinding(checkpoint)
  ]));
  const coreRelativePath = path.posix.relative(
    path.posix.dirname(SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH),
    SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH
  );
  if (!coreRelativePath || path.posix.isAbsolute(coreRelativePath)) {
    throw new Error('Semantic Mutation bundled core import path is invalid');
  }
  const coreModuleSpecifier = coreRelativePath.startsWith('.')
    ? coreRelativePath
    : `./${coreRelativePath}`;
  const source = [
    "const { open, rename, rm } = await import('node:fs/promises');",
    "const path = await import('node:path');",
    `const bindings = ${JSON.stringify(bindings)};`,
    "const progressPublicationFailure = Symbol('progress-publication-failure');",
    'async function publish(checkpoint) {',
    '  const binding = bindings[checkpoint];',
    '  const finalPath = path.resolve(binding.finalRelativePath);',
    '  const pendingPath = path.resolve(binding.pendingRelativePath);',
    '  const bytes = new TextEncoder().encode(binding.bytes);',
    '  let pendingOwned = false;',
    '  try {',
    "    const handle = await open(pendingPath, 'wx', 0o600);",
    '    pendingOwned = true;',
    '    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }',
    '    await rename(pendingPath, finalPath);',
    '    pendingOwned = false;',
    '    let directoryHandle;',
    '    try {',
    "      directoryHandle = await open(path.dirname(finalPath), 'r');",
    '      await directoryHandle.sync();',
    '    } catch (error) {',
    "      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;",
    "      if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code)) throw error;",
    '    } finally { await directoryHandle?.close(); }',
    '  } catch {',
    '    if (pendingOwned) {',
    '      try { await rm(pendingPath, { force: true }); } catch { throw progressPublicationFailure; }',
    '    }',
    '    throw progressPublicationFailure;',
    '  }',
    '}',
    'try {',
    "  await publish('loader-entered');",
    "  await publish('core-import-started');",
    `  await import(new URL(${JSON.stringify(coreModuleSpecifier)}, import.meta.url).href);`,
    '} catch (error) {',
    `  process.exitCode = error === progressPublicationFailure ? ${
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure
    } : ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure};`,
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}

export function semanticMutationIsolatedBootstrapBytes(): Uint8Array {
  const checkpoint = 'bootstrap-entered' satisfies SemanticMutationIsolatedProgressCheckpoint;
  const finalRelativePath = path.relative(
    path.resolve('.'),
    semanticMutationIsolatedProgressCheckpointPath('.', checkpoint)
  ).split(path.sep).join('/');
  const pendingRelativePath = path.relative(
    path.resolve('.'),
    semanticMutationIsolatedProgressCheckpointPendingPath('.', checkpoint)
  ).split(path.sep).join('/');
  const loaderFileName = path.posix.basename(SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH);
  const bytes = new TextDecoder().decode(semanticMutationIsolatedProgressCheckpointBytes(checkpoint));
  const source = [
    "const { open, rename, rm } = await import('node:fs/promises');",
    "const path = await import('node:path');",
    "const { fileURLToPath } = await import('node:url');",
    `const expectedBootstrapRelativePath = ${JSON.stringify(
      SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH
    )};`,
    'const bootstrapPath = fileURLToPath(import.meta.url);',
    "const stagingRoot = path.resolve(path.dirname(bootstrapPath), '../../..');",
    'try {',
    "  const actualRelativePath = path.relative(stagingRoot, bootstrapPath).split(path.sep).join('/');",
    '  if (actualRelativePath !== expectedBootstrapRelativePath) throw new Error();',
    "  process.chdir(process.platform === 'win32' ? path.toNamespacedPath(path.resolve(stagingRoot)) : path.resolve(stagingRoot));",
    '} catch {',
    `  process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure};`,
    '}',
    `if (process.exitCode !== ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure}) {`,
    `const finalPath = path.resolve(${JSON.stringify(finalRelativePath)});`,
    `const pendingPath = path.resolve(${JSON.stringify(pendingRelativePath)});`,
    `const bytes = new TextEncoder().encode(${JSON.stringify(bytes)});`,
    'let pendingOwned = false;',
    'try {',
    "  const handle = await open(pendingPath, 'wx', 0o600);",
    '  pendingOwned = true;',
    '  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }',
    '  await rename(pendingPath, finalPath);',
    '  pendingOwned = false;',
    '  let directoryHandle;',
    '  try {',
    "    directoryHandle = await open(path.dirname(finalPath), 'r');",
    '    await directoryHandle.sync();',
    '  } catch (error) {',
    '    const code = error && typeof error === \'object\' && \'code\' in error ? error.code : undefined;',
    "    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code)) throw error;",
    '  } finally { await directoryHandle?.close(); }',
    '} catch {',
    '  if (pendingOwned) {',
    `    try { await rm(pendingPath, { force: true }); } catch { process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure}; }`,
    '  }',
    `  process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure};`,
    '}',
    `if (process.exitCode !== ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure}) {`,
    `  await import(new URL(${JSON.stringify(`./${loaderFileName}`)}, import.meta.url).href);`,
    '}',
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}
