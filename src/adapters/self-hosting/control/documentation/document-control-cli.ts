import path from 'node:path';

import { rawSha256 } from '../../../../contracts/canonical.ts';

/** Request decoding and bounded output projection only; no provider or effect access. */

/** Scope is a request, never an authorization or a replacement Work Package. */
export interface SourceCheckpointStatusRequest {
  readonly base: string;
  readonly expectedHead: string;
  readonly ownedPaths: readonly string[];
}

export function validateSourceCheckpointStatusRequest(input: SourceCheckpointStatusRequest): SourceCheckpointStatusRequest {
  if (![input.base, input.expectedHead].every((value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value))) {
    throw new Error('Source checkpoint status requires exact base and expected-head object IDs.');
  }
  if (input.ownedPaths.length === 0 || input.ownedPaths.length > 1024
      || new Set(input.ownedPaths).size !== input.ownedPaths.length
      || input.ownedPaths.some((value) => value.length === 0 || value.length > 4096
        || /[\\\0\r\n*?\[\]]/u.test(value) || value.split('/').some((part) => ['', '.', '..', '.git'].includes(part)))) {
    throw new Error('Source checkpoint status requires unique exact repository-relative owned paths.');
  }
  return Object.freeze({ ...input, ownedPaths: Object.freeze([...input.ownedPaths].sort()) });
}

export interface DocumentControlPlaneStatusCliProjection {
  readonly schema: 'sec-document-control-plane-status-cli-projection-v1';
  readonly resultDigest: `sha256:${string}`;
  readonly repository: unknown;
  readonly workspace: unknown;
  readonly github: Readonly<{
    status: unknown;
    reason?: unknown;
    httpStatus?: number | null;
    detailDigest?: `sha256:${string}`;
    openPullRequestNumbers?: readonly number[];
    openIssueCount?: number;
    reviewThreadPullRequestCount?: number;
  }>;
  readonly activeWorkPackage: unknown;
  readonly activation: unknown;
  readonly continuation: unknown;
}

export function projectDocumentControlPlaneStatusCli(
  resolved: Readonly<Record<string, unknown>>
): DocumentControlPlaneStatusCliProjection {
  const github = resolved.github !== null
    && typeof resolved.github === 'object'
    && !Array.isArray(resolved.github)
    ? resolved.github as Record<string, unknown>
    : {};
  const openPullRequests = Array.isArray(github.openPullRequests)
    ? github.openPullRequests
    : undefined;
  const openIssues = Array.isArray(github.openIssues) ? github.openIssues : undefined;
  const reviewThreadPullRequestCount = Array.isArray(github.reviewThreads)
    ? github.reviewThreads.length
    : github.reviewThreads !== null
        && typeof github.reviewThreads === 'object'
      ? Object.keys(github.reviewThreads).length
      : undefined;
  const httpStatus = github.httpStatus === null || (typeof github.httpStatus === 'number'
    && Number.isInteger(github.httpStatus) && github.httpStatus >= 100 && github.httpStatus <= 599)
    ? github.httpStatus : undefined;
  const detailDigest = typeof github.detailDigest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(github.detailDigest)
    ? github.detailDigest as `sha256:${string}` : undefined;
  return Object.freeze({
    schema: 'sec-document-control-plane-status-cli-projection-v1',
    resultDigest: rawSha256(JSON.stringify(resolved)),
    repository: resolved.repository,
    workspace: resolved.workspace,
    github: Object.freeze({
      status: github.status,
      ...(github.reason === undefined ? {} : { reason: github.reason }),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(detailDigest === undefined ? {} : { detailDigest }),
      ...(openPullRequests === undefined ? {} : {
        openPullRequestNumbers: Object.freeze(openPullRequests.flatMap((item) => (
          item !== null && typeof item === 'object' && !Array.isArray(item)
            && typeof (item as { number?: unknown }).number === 'number'
            ? [(item as { number: number }).number]
            : []
        )))
      }),
      ...(openIssues === undefined ? {} : { openIssueCount: openIssues.length }),
      ...(reviewThreadPullRequestCount === undefined ? {} : { reviewThreadPullRequestCount })
    }),
    activeWorkPackage: resolved.activeWorkPackage,
    activation: resolved.activation,
    continuation: resolved.continuation
  });
}

export type DocumentControlCommand =
  | Readonly<{ command: 'status'; workspace: string; full: boolean }>
  | Readonly<{ command: 'source-checkpoint-status'; workspace: string; request: SourceCheckpointStatusRequest }>
  | Readonly<{ command: 'freeze'; workspace: string; manifestPath: string; reviewedOn: string; proposalOnly: boolean }>;

/** Decode request syntax only. The operation owner must bind exact authority. */
export function decodeDocumentControlCommand(argv: readonly string[], cwd: string): DocumentControlCommand {
  const [command, ...args] = argv;
  const usage = 'Usage:\n'
    + '  bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status [--workspace <path>] [--json] [--full]\n'
    + '  bun run dev:status -- --source-checkpoint --base <exact-sha> --expected-head <exact-sha> --owned-path <exact-path> [--owned-path <exact-path> ...] [--workspace <path>] [--json]\n'
    + '  bun src/adapters/self-hosting/control/documentation/document-control-plane.ts freeze --workspace <candidate-path> '
    + '--manifest <path> --reviewed-on <YYYY-MM-DD> [--proposal-only] [--json]\n'
    + '  Optional: --github-credential-store <absolute-private-directory> (Linux only; outside the operation checkout)';
  if (command === 'status' && args.includes('--source-checkpoint')) {
    const values = new Map<string, string>();
    const ownedPaths: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === '--source-checkpoint' || argument === '--json') continue;
      if (!['--workspace', '--base', '--expected-head', '--owned-path'].includes(argument)) throw new Error(usage);
      const value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(usage);
      if (argument === '--owned-path') ownedPaths.push(value);
      else {
        if (values.has(argument)) throw new Error(`Duplicate source checkpoint option: ${argument}.`);
        values.set(argument, value);
      }
    }
    if (args.filter((value) => value === '--source-checkpoint').length !== 1
        || args.filter((value) => value === '--json').length > 1) throw new Error(usage);
    const request = validateSourceCheckpointStatusRequest({
      base: values.get('--base') ?? '', expectedHead: values.get('--expected-head') ?? '', ownedPaths
    });
    return Object.freeze({ command: 'source-checkpoint-status', workspace: path.resolve(cwd, values.get('--workspace') ?? '.'), request });
  }
  if (command === 'status') {
    let workspace = cwd;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === '--json' || argument === '--full') continue;
      if (argument !== '--workspace' || args[index + 1] === undefined
          || args[index + 1]!.startsWith('--')) throw new Error(usage);
      workspace = path.resolve(cwd, args[index + 1]!);
      index += 1;
    }
    if (args.filter((argument) => argument === '--json').length > 1
        || args.filter((argument) => argument === '--full').length > 1
        || args.filter((argument) => argument === '--workspace').length > 1) throw new Error(usage);
    return Object.freeze({ command, workspace, full: args.includes('--full') });
  }
  if (command === 'freeze') {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === '--json' || argument === '--proposal-only') continue;
      if (argument !== '--manifest' && argument !== '--reviewed-on' && argument !== '--workspace') {
        throw new Error(usage);
      }
      if (values.has(argument)) throw new Error(`Duplicate freeze option: ${argument}.`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.\n${usage}`);
      values.set(argument, value);
      index += 1;
    }
    const manifestPath = values.get('--manifest');
    const reviewedOn = values.get('--reviewed-on');
    const workspace = values.get('--workspace');
    if (manifestPath === undefined || reviewedOn === undefined || workspace === undefined) {
      throw new Error(usage);
    }
    if (args.filter((argument) => argument === '--proposal-only').length > 1) {
      throw new Error('Duplicate freeze option: --proposal-only.');
    }
    return Object.freeze({ command, workspace, manifestPath, reviewedOn, proposalOnly: args.includes('--proposal-only') });
  }
  throw new Error(usage);
}
