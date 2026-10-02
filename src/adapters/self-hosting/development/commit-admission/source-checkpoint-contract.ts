import path from 'node:path';

import { validateSourceCheckpointStatusRequest } from '../../control/documentation/document-control-cli.ts';

/** Native layout and origin readback, charged to the original commit session. */
export const SOURCE_CHECKPOINT_COMMIT_IDENTITY_PROCESS_COUNT = 2;

export function assertDevelopmentSourceCheckpointNonDefaultRef(expectedRef: string, trustedDefaultBranch: string): void {
  if (expectedRef === `refs/heads/${trustedDefaultBranch}`) {
    throw new Error('Source checkpoint commit cannot target the trusted repository default branch.');
  }
}

export function assertDevelopmentSourceCheckpointIndexDigest(requested: string, observed: string): void {
  if (requested !== observed) throw new Error('Source checkpoint scope observation requires the exact requested index.');
}

/** Requested bounds only. Neither this value nor a command-line SHA grants trust. */
export interface DevelopmentSourceCheckpointRequest {
  readonly trustedMain: string;
  readonly base: string;
  readonly expectedHead: string;
  readonly expectedRef: string;
  readonly expectedTree: string;
  readonly expectedIndex: `sha256:${string}`;
  readonly ownedPaths: readonly string[];
}

export function validateDevelopmentSourceCheckpointRequest(
  input: DevelopmentSourceCheckpointRequest
): DevelopmentSourceCheckpointRequest {
  const scope = validateSourceCheckpointStatusRequest(input);
  if (![input.trustedMain, input.expectedTree].every((value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value))
      || !/^sha256:[0-9a-f]{64}$/u.test(input.expectedIndex)
      || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(input.expectedRef)
      || input.expectedRef.includes('..') || input.expectedRef.endsWith('/')
      || input.expectedRef.endsWith('.lock')) {
    throw new Error('Source checkpoint commit requires exact trusted main, ref, tree and index identities.');
  }
  return Object.freeze({
    trustedMain: input.trustedMain,
    base: scope.base,
    expectedHead: scope.expectedHead,
    expectedRef: input.expectedRef,
    expectedTree: input.expectedTree,
    expectedIndex: input.expectedIndex,
    ownedPaths: scope.ownedPaths
  });
}

/** Comparison only; the staged-candidate owner supplies the observations. */
export function assertDevelopmentSourceCheckpointCandidateIdentity(
  request: DevelopmentSourceCheckpointRequest,
  observed: Readonly<{ ref: string; head: string; tree: string; index: string }>
): void {
  if (observed.ref !== request.expectedRef || observed.head !== request.expectedHead
      || observed.tree !== request.expectedTree || observed.index !== request.expectedIndex) {
    throw new Error('Source checkpoint candidate ref, HEAD, tree or index differs from the exact request.');
  }
}

export function decodeDevelopmentCommitCommand(args: readonly string[], cwd: string): Readonly<{
  repositoryRoot: string;
  message: string;
  sourceCheckpoint?: DevelopmentSourceCheckpointRequest;
}> {
  const message = args[0];
  if (message === undefined || message.length === 0) {
    throw new Error('development commit requires one non-empty message argument.');
  }
  if (args.length === 1) return Object.freeze({ repositoryRoot: path.resolve(cwd), message });
  const values = new Map<string, string>();
  const ownedPaths: string[] = [];
  let sourceCheckpoint = false;
  const options = new Set([
    '--workspace', '--trusted-main', '--base', '--expected-head', '--expected-ref',
    '--expected-tree', '--expected-index', '--owned-path'
  ]);
  for (let index = 1; index < args.length; index++) {
    const option = args[index]!;
    if (option === '--source-checkpoint' && !sourceCheckpoint) {
      sourceCheckpoint = true;
      continue;
    }
    const value = args[++index];
    if (!options.has(option) || value === undefined || value.startsWith('--')) {
      throw new Error('Invalid source checkpoint commit option.');
    }
    if (option === '--owned-path') ownedPaths.push(value);
    else {
      if (values.has(option)) throw new Error(`Duplicate source checkpoint commit option: ${option}.`);
      values.set(option, value);
    }
  }
  if (!sourceCheckpoint || !values.has('--workspace')) {
    throw new Error('Cross-workspace commit requires --source-checkpoint and --workspace.');
  }
  const request = validateDevelopmentSourceCheckpointRequest({
    trustedMain: values.get('--trusted-main') ?? '',
    base: values.get('--base') ?? '',
    expectedHead: values.get('--expected-head') ?? '',
    expectedRef: values.get('--expected-ref') ?? '',
    expectedTree: values.get('--expected-tree') ?? '',
    expectedIndex: (values.get('--expected-index') ?? '') as `sha256:${string}`,
    ownedPaths
  });
  return Object.freeze({
    repositoryRoot: path.resolve(cwd, values.get('--workspace')!), message, sourceCheckpoint: request
  });
}
