import path from 'node:path';

import {
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES,
  isSemanticMutationIsolatedProgressTransitionAllowed,
  semanticMutationIsolatedProgressFrameText,
  type SemanticMutationIsolatedProgressCheckpoint
} from '../../../assurance/verification/semantic-mutation/isolated-progress.ts';
import { compilerRuntimeLayout } from '../../toolchain/runtime.ts';

// Physical entrypoints belong to the isolation adapter, not the progress protocol.
export const SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH =
  '.isolated-compiler/src/bootstrap/engineering/semantic-mutation-isolated-verification-bootstrap.mjs' as const;
export const SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH =
  '.isolated-compiler/src/bootstrap/engineering/semantic-mutation-isolated-verification-loader.mjs' as const;
export const SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH =
  `.isolated-compiler/${compilerRuntimeLayout.artifactEntrypointRelativePath}`;

const CORE_PROGRESS_PREFIX = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started'
] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[]);
let coreProgressTrace: readonly SemanticMutationIsolatedProgressCheckpoint[] = CORE_PROGRESS_PREFIX;

function writeProgressFrame(frame: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, 'utf8', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class SemanticMutationIsolatedProgressPublicationError extends Error {
  constructor(cause?: unknown) {
    super('Semantic Mutation isolated progress publication failed', { cause });
    this.name = 'SemanticMutationIsolatedProgressPublicationError';
  }
}

export async function publishSemanticMutationIsolatedProgressCheckpoint(
  _stagingWorkspaceRoot: string,
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Promise<void> {
  try {
    if (!isSemanticMutationIsolatedProgressTransitionAllowed(coreProgressTrace, checkpoint)) {
      throw new Error('Semantic Mutation isolated progress transition is invalid');
    }
    await writeProgressFrame(semanticMutationIsolatedProgressFrameText('pending', checkpoint));
    await writeProgressFrame(semanticMutationIsolatedProgressFrameText('committed', checkpoint));
    coreProgressTrace = Object.freeze([...coreProgressTrace, checkpoint]);
  } catch (error) {
    if (error instanceof SemanticMutationIsolatedProgressPublicationError) throw error;
    throw new SemanticMutationIsolatedProgressPublicationError(error);
  }
}

function generatedCheckpointBinding(
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Readonly<{ readonly pendingFrame: string; readonly committedFrame: string }> {
  return Object.freeze({
    pendingFrame: semanticMutationIsolatedProgressFrameText('pending', checkpoint),
    committedFrame: semanticMutationIsolatedProgressFrameText('committed', checkpoint)
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

function generatedProgressWriterSource(indent = ''): readonly string[] {
  return Object.freeze([
    `${indent}async function writeProgressFrame(frame) {`,
    `${indent}  await new Promise((resolve, reject) => {`,
    `${indent}    process.stdout.write(frame, 'utf8', (error) => error ? reject(error) : resolve());`,
    `${indent}  });`,
    `${indent}}`,
    `${indent}async function publishProgress(binding) {`,
    `${indent}  await writeProgressFrame(binding.pendingFrame);`,
    `${indent}  await writeProgressFrame(binding.committedFrame);`,
    `${indent}}`
  ]);
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
    `const bindings = ${JSON.stringify(bindings)};`,
    ...generatedProgressWriterSource(),
    'try {',
    "  await publishProgress(bindings['loader-entered']);",
    "  await publishProgress(bindings['core-import-started']);",
    '} catch {',
    `  process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure};`,
    '}',
    `if (process.exitCode !== ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure}) {`,
    '  try {',
    `    await import(new URL(${JSON.stringify(coreModuleSpecifier)}, import.meta.url).href);`,
    '  } catch {',
    `    process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure};`,
    '  }',
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}

export function semanticMutationIsolatedBootstrapBytes(): Uint8Array {
  const checkpoint = 'bootstrap-entered' satisfies SemanticMutationIsolatedProgressCheckpoint;
  const checkpointBinding = generatedCheckpointBinding(checkpoint);
  const bootstrapDirectory = path.posix.dirname(SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH);
  const stagingRootRelativePath = path.posix.relative(bootstrapDirectory, '.');
  const loaderRelativePath = path.posix.relative(
    bootstrapDirectory,
    SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH
  );
  const loaderModuleSpecifier = loaderRelativePath.startsWith('.')
    ? loaderRelativePath
    : `./${loaderRelativePath}`;
  const source = [
    "const path = await import('node:path');",
    "const { fileURLToPath } = await import('node:url');",
    `const expectedBootstrapRelativePath = ${JSON.stringify(
      SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH
    )};`,
    `const bootstrapProgress = ${JSON.stringify(checkpointBinding)};`,
    'const bootstrapPath = fileURLToPath(import.meta.url);',
    `const stagingRoot = path.resolve(path.dirname(bootstrapPath), ${JSON.stringify(stagingRootRelativePath)});`,
    'try {',
    "  const actualRelativePath = path.relative(stagingRoot, bootstrapPath).split(path.sep).join('/');",
    '  if (actualRelativePath !== expectedBootstrapRelativePath) throw new Error();',
    "  process.chdir(process.platform === 'win32' ? path.toNamespacedPath(path.resolve(stagingRoot)) : path.resolve(stagingRoot));",
    '} catch {',
    `  process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure};`,
    '}',
    `if (process.exitCode !== ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure}) {`,
    ...generatedProgressWriterSource('  '),
    '  try {',
    '    await publishProgress(bootstrapProgress);',
    '  } catch {',
    `    process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure};`,
    '  }',
    `  if (process.exitCode !== ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure}) {`,
    '    try {',
    `      await import(new URL(${JSON.stringify(loaderModuleSpecifier)}, import.meta.url).href);`,
    '    } catch {',
    `      process.exitCode = ${SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure};`,
    '    }',
    '  }',
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}
