import path from 'node:path';

import {
  ISOLATED_EXIT_CODES,
  isIsolatedProgressTransitionAllowed,
  isolatedProgressFrameText,
  type IsolatedProgressCheckpoint
} from '../../../../assurance/verification/semantic-mutation/isolated/progress.ts';
import { compilerRuntimeLayout } from '../../../toolchain/runtime.ts';

// Physical entrypoints belong to the isolation adapter, not the progress protocol.
export const ISOLATED_BOOTSTRAP_RELATIVE_PATH =
  '.isolated-compiler/src/bootstrap/engineering/semantic-mutation/isolated-verification.mjs' as const;
export const ISOLATED_STAGED_LOADER_RELATIVE_PATH =
  '.isolated-compiler/src/bootstrap/engineering/semantic-mutation/isolated-loader.mjs' as const;
export const ISOLATED_RUNNER_CORE_RELATIVE_PATH =
  `.isolated-compiler/${compilerRuntimeLayout.artifactEntrypointRelativePath}`;

const CORE_PROGRESS_PREFIX = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started'
] as const satisfies readonly IsolatedProgressCheckpoint[]);
let coreProgressTrace: readonly IsolatedProgressCheckpoint[] = CORE_PROGRESS_PREFIX;

function writeProgressFrame(frame: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, 'utf8', (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class IsolatedProgressPublicationError extends Error {
  constructor(cause?: unknown) {
    super('Semantic Mutation isolated progress publication failed', { cause });
    this.name = 'SemanticMutationIsolatedProgressPublicationError';
  }
}

export async function publishSemanticMutationIsolatedProgressCheckpoint(
  _stagingWorkspaceRoot: string,
  checkpoint: IsolatedProgressCheckpoint
): Promise<void> {
  try {
    if (!isIsolatedProgressTransitionAllowed(coreProgressTrace, checkpoint)) {
      throw new Error('Semantic Mutation isolated progress transition is invalid');
    }
    await writeProgressFrame(isolatedProgressFrameText('pending', checkpoint));
    await writeProgressFrame(isolatedProgressFrameText('committed', checkpoint));
    coreProgressTrace = Object.freeze([...coreProgressTrace, checkpoint]);
  } catch (error) {
    if (error instanceof IsolatedProgressPublicationError) throw error;
    throw new IsolatedProgressPublicationError(error);
  }
}

function generatedCheckpointBinding(
  checkpoint: IsolatedProgressCheckpoint
): Readonly<{ readonly pendingFrame: string; readonly committedFrame: string }> {
  return Object.freeze({
    pendingFrame: isolatedProgressFrameText('pending', checkpoint),
    committedFrame: isolatedProgressFrameText('committed', checkpoint)
  });
}

export interface BundledLoaderBinding {
  readonly formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1';
  readonly executionRevision: 'semantic-mutation-bundled-core-relocation-v1';
}

function assertBundledLoaderBinding(
  binding: BundledLoaderBinding
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

export function stagedLoaderBytes(
  binding: BundledLoaderBinding
): Uint8Array {
  assertBundledLoaderBinding(binding);
  const loaderCheckpoints = [
    'loader-entered',
    'core-import-started'
  ] as const satisfies readonly IsolatedProgressCheckpoint[];
  const bindings = Object.fromEntries(loaderCheckpoints.map((checkpoint) => [
    checkpoint,
    generatedCheckpointBinding(checkpoint)
  ]));
  const coreRelativePath = path.posix.relative(
    path.posix.dirname(ISOLATED_STAGED_LOADER_RELATIVE_PATH),
    ISOLATED_RUNNER_CORE_RELATIVE_PATH
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
    `  process.exitCode = ${ISOLATED_EXIT_CODES.progressPublicationFailure};`,
    '}',
    `if (process.exitCode !== ${ISOLATED_EXIT_CODES.progressPublicationFailure}) {`,
    '  try {',
    `    await import(new URL(${JSON.stringify(coreModuleSpecifier)}, import.meta.url).href);`,
    '  } catch {',
    `    process.exitCode = ${ISOLATED_EXIT_CODES.loaderImportFailure};`,
    '  }',
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}

export function bootstrapBytes(): Uint8Array {
  const checkpoint = 'bootstrap-entered' satisfies IsolatedProgressCheckpoint;
  const checkpointBinding = generatedCheckpointBinding(checkpoint);
  const bootstrapDirectory = path.posix.dirname(ISOLATED_BOOTSTRAP_RELATIVE_PATH);
  const stagingRootRelativePath = path.posix.relative(bootstrapDirectory, '.');
  const loaderRelativePath = path.posix.relative(
    bootstrapDirectory,
    ISOLATED_STAGED_LOADER_RELATIVE_PATH
  );
  const loaderModuleSpecifier = loaderRelativePath.startsWith('.')
    ? loaderRelativePath
    : `./${loaderRelativePath}`;
  const source = [
    "const path = await import('node:path');",
    "const { fileURLToPath } = await import('node:url');",
    `const expectedBootstrapRelativePath = ${JSON.stringify(
      ISOLATED_BOOTSTRAP_RELATIVE_PATH
    )};`,
    `const bootstrapProgress = ${JSON.stringify(checkpointBinding)};`,
    'const bootstrapPath = fileURLToPath(import.meta.url);',
    `const stagingRoot = path.resolve(path.dirname(bootstrapPath), ${JSON.stringify(stagingRootRelativePath)});`,
    'try {',
    "  const actualRelativePath = path.relative(stagingRoot, bootstrapPath).split(path.sep).join('/');",
    '  if (actualRelativePath !== expectedBootstrapRelativePath) throw new Error();',
    "  process.chdir(process.platform === 'win32' ? path.toNamespacedPath(path.resolve(stagingRoot)) : path.resolve(stagingRoot));",
    '} catch {',
    `  process.exitCode = ${ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure};`,
    '}',
    `if (process.exitCode !== ${ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure}) {`,
    ...generatedProgressWriterSource('  '),
    '  try {',
    '    await publishProgress(bootstrapProgress);',
    '  } catch {',
    `    process.exitCode = ${ISOLATED_EXIT_CODES.progressPublicationFailure};`,
    '  }',
    `  if (process.exitCode !== ${ISOLATED_EXIT_CODES.progressPublicationFailure}) {`,
    '    try {',
    `      await import(new URL(${JSON.stringify(loaderModuleSpecifier)}, import.meta.url).href);`,
    '    } catch {',
    `      process.exitCode = ${ISOLATED_EXIT_CODES.loaderImportFailure};`,
    '    }',
    '  }',
    '}',
    ''
  ].join('\n');
  return new TextEncoder().encode(source);
}
