import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPOSITORY_AUDIT_ENTRYPOINT_PATH } from '../../../brownfield/source-program-model/contract.ts';
import { CI_VERIFICATION_WORKFLOW_PATH } from '../../contract/revision.ts';

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA = 'sec-trusted-bootstrap-registry-v3' as const;
export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH =
  'src/verification/trust/contract/ci-trust-root-registry.json' as const;
export const SEC_TCB_CLOSURE_RUNTIME_PATH =
  'src/verification/trust/runtime/closure-lock.ts' as const;

const REQUIRED_TRUSTED_BOOTSTRAP_STATIC_EXACT_PATHS = Object.freeze([
  '.bun-version',
  'src/control/branch-lifecycle/branch-lifecycle.ts',
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH,
  SEC_TCB_CLOSURE_RUNTIME_PATH
]);

export type SecTrustedBootstrapRegistry = Readonly<{
  schema: typeof SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA;
  staticExactPaths: readonly string[];
  staticDirectoryPaths: readonly string[];
  staticPrefixes: readonly string[];
  runtimeEntrypoints: readonly string[];
  reviewedSutEdges: readonly string[];
  reviewedBoundaryEdges: readonly string[];
  reviewedExternalImports: readonly string[];
}>;

export type SecTrustedBootstrapTrustRoot = Readonly<{
  schema: 'sec-trusted-bootstrap-trust-root-v3';
  registry: SecTrustedBootstrapRegistry;
  causalRuntimePaths: readonly string[];
  paths: readonly string[];
  prefixes: readonly string[];
}>;

export type SecTrustedBootstrapPathMatch = Readonly<{
  kind: 'static-exact' | 'static-directory' | 'static-prefix' | 'causal-runtime';
  rule: string;
}>;

/**
 * Structured projection of the trusted runtime's process and network
 * dispatch boundaries.
 *
 * This is deliberately a dataflow contract rather than a source-text
 * expectation.  The exact-tree TCB compiler supplies the immutable dispatcher
 * identities it observed; this owner supplies the machine vocabulary that
 * describes how those identities cross an Effect boundary.  Consumers must
 * reason over this projection and may not infer authority from a function
 * spelling, argument layout, or source snippet.
 */
export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA =
  'sec-trusted-bootstrap-dispatcher-projection-v1' as const;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE =
  'sec-trusted-bootstrap-dispatcher-dataflow-v1' as const;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER =
  'src/verification/trust/contract/root.ts' as const;

export type SecTrustedBootstrapDispatcherKind = 'process' | 'network';

export type SecTrustedBootstrapDispatcherLoader =
  | 'exec'
  | 'execFile'
  | 'execFileSync'
  | 'execSync'
  | 'fork'
  | 'spawn'
  | 'spawnSync'
  | 'Bun.spawn'
  | 'Bun.spawnSync'
  | 'Worker'
  | 'node:worker_threads.Worker'
  | 'globalThis.fetch';

export type SecTrustedBootstrapDispatcherBoundary =
  | 'general-process'
  | 'verification-action'
  | 'hosted-archive-inventory'
  | 'github-api'
  | 'local-actions-runner'
  | 'windows-repository-change-observer'
  | 'windows-stdin-writer'
  | 'docs-doctor-index';

export type SecTrustedBootstrapDispatcherDataflow = Readonly<{
  executable:
    | 'process-exec-path'
    | 'fixed-interpreter'
    | 'embedded-source'
    | 'command-input'
    | 'not-applicable';
  argv:
    | 'normalized-operation'
    | 'fixed-script-input'
    | 'command-and-args'
    | 'url-and-request-init'
    | 'not-applicable';
  cwd: 'repository-root' | 'caller-cwd' | 'none' | 'not-applicable';
  environment: 'explicit-allowlist' | 'provider-bound' | 'caller-bound' | 'not-applicable';
  stdio: 'inherit' | 'captured' | 'piped' | 'provider-bound' | 'not-applicable';
  shell: 'forbidden' | 'not-applicable';
  output: 'bounded' | 'provider-bound' | 'not-captured' | 'not-applicable';
  deadline: 'bounded' | 'provider-bound' | 'not-applicable';
}>;

export type SecTrustedBootstrapDispatcherAuthority = Readonly<{
  ownerId: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER;
  principleId: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE;
  machineTargets: readonly [
    'tcb-closure-lock.reviewedProcessDispatchers',
    'tcb-closure-lock.reviewedNetworkDispatchers'
  ];
  evidence: readonly [
    'exact-tree-dispatcher-census',
    'module-graph-closure',
    'effect-dataflow',
    'content-digest-readback'
  ];
}>;

export type SecTrustedBootstrapDispatcherEntry = Readonly<{
  kind: SecTrustedBootstrapDispatcherKind;
  identity: string;
  repositoryPath: string;
  ownerChain: string;
  owner: string;
  loader: SecTrustedBootstrapDispatcherLoader;
  ordinal: number;
  boundary: SecTrustedBootstrapDispatcherBoundary;
  dataflow: SecTrustedBootstrapDispatcherDataflow;
  authority: SecTrustedBootstrapDispatcherAuthority;
}>;

export type SecTrustedBootstrapDispatcherProjection = Readonly<{
  schema: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA;
  authority: SecTrustedBootstrapDispatcherAuthority;
  process: readonly SecTrustedBootstrapDispatcherEntry[];
  network: readonly SecTrustedBootstrapDispatcherEntry[];
}>;

export type SecTrustedBootstrapDispatcherCounterexampleDelta =
  | 'dispatcher-identity'
  | 'module-graph-closure'
  | 'effect-dataflow'
  | 'content-digest-readback';

export type SecTrustedBootstrapDispatcherCounterexample = Readonly<{
  status: 'counterexample';
  dispatcherIdentity: string;
  owner: SecTrustedBootstrapDispatcherAuthority;
  designDelta: Readonly<{
    kind: SecTrustedBootstrapDispatcherCounterexampleDelta;
    machineTarget: SecTrustedBootstrapDispatcherAuthority['machineTargets'][number];
  }>;
  migrationClosure: Readonly<{
    ownerId: SecTrustedBootstrapDispatcherAuthority['ownerId'];
    machineTargets: SecTrustedBootstrapDispatcherAuthority['machineTargets'];
    evidence: SecTrustedBootstrapDispatcherAuthority['evidence'];
  }>;
}>;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY: SecTrustedBootstrapDispatcherAuthority =
  Object.freeze({
    ownerId: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER,
    principleId: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE,
    machineTargets: Object.freeze([
      'tcb-closure-lock.reviewedProcessDispatchers',
      'tcb-closure-lock.reviewedNetworkDispatchers'
    ]) as SecTrustedBootstrapDispatcherAuthority['machineTargets'],
    evidence: Object.freeze([
      'exact-tree-dispatcher-census',
      'module-graph-closure',
      'effect-dataflow',
      'content-digest-readback'
    ]) as SecTrustedBootstrapDispatcherAuthority['evidence']
  });

const TRUSTED_BOOTSTRAP_DISPATCHER_LOADERS = new Set<SecTrustedBootstrapDispatcherLoader>([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
  'Bun.spawn',
  'Bun.spawnSync',
  'Worker',
  'node:worker_threads.Worker',
  'globalThis.fetch'
]);

const TRUSTED_BOOTSTRAP_PROCESS_LOADERS = new Set<SecTrustedBootstrapDispatcherLoader>([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
  'Bun.spawn',
  'Bun.spawnSync',
  'Worker',
  'node:worker_threads.Worker'
]);

const TRUSTED_BOOTSTRAP_COUNTEREXAMPLE_DELTAS = new Set<SecTrustedBootstrapDispatcherCounterexampleDelta>([
  'dispatcher-identity',
  'module-graph-closure',
  'effect-dataflow',
  'content-digest-readback'
]);

const REGISTRY_KEYS = [
  'schema',
  'staticExactPaths',
  'staticDirectoryPaths',
  'staticPrefixes',
  'runtimeEntrypoints',
  'reviewedSutEdges',
  'reviewedBoundaryEdges',
  'reviewedExternalImports'
] as const;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  const expected = [...REGISTRY_KEYS].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error('Trusted bootstrap registry has unknown or missing fields.');
  }
}

function assertBoundedNfc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0') || value.normalize('NFC') !== value) {
    throw new Error(`${label} must be bounded NFC text without NUL characters.`);
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new Error(`${label} must be strictly code-unit sorted and unique.`);
    }
  }
}

function assertRepositoryPath(value: string, label: string, directory: boolean): void {
  assertBoundedNfc(value, label);
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || value.includes('//')
    || value.includes('*')
    || value.includes('?')
    || value.includes('#')
  )
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  if (directory !== value.endsWith('/')) {
    throw new Error(`${label} ${directory ? 'must' : 'must not'} end with '/'.`);
  }
  const comparable = directory ? value.slice(0, -1) : value;
  if (
    comparable.length === 0 ||
    comparable === '.' ||
    comparable === '..' ||
    comparable.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    path.posix.normalize(comparable) !== comparable
  )
    throw new Error(`${label} is not canonical after POSIX normalization.`);
}

function assertPrefix(value: string, label: string): void {
  assertBoundedNfc(value, label);
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes('..')
  )
    throw new Error(`${label} is not a canonical repository prefix.`);
}

function assertExternalModuleSpecifier(value: string, label: string): void {
  assertBoundedNfc(value, label);
  if (
    value.startsWith('.') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.includes('*') ||
    value.includes('?') ||
    value.includes('#') ||
    /\s/u.test(value)
  ) {
    throw new Error(`${label} must be one exact external module specifier.`);
  }
  const protocolSpecifier = /^(?:bun|node):[a-z0-9][a-z0-9._/-]*$/u;
  const packageSpecifier = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
  if (!protocolSpecifier.test(value) && !packageSpecifier.test(value)) {
    throw new Error(`${label} must be one canonical external module specifier.`);
  }
}

const TRUSTED_BOOTSTRAP_DISPATCHER_IDENTITY_PATTERN =
  /^(.+?)::(.+?)::(exec|execFile|execFileSync|execSync|fork|spawn|spawnSync|Bun\.spawn|Bun\.spawnSync|Worker|node:worker_threads\.Worker|globalThis\.fetch)#([1-9][0-9]*)$/u;

function dispatcherBoundary(
  repositoryPath: string,
  owner: string,
  kind: SecTrustedBootstrapDispatcherKind
): SecTrustedBootstrapDispatcherBoundary {
  if (kind === 'network' || repositoryPath === 'src/control/integration/integration-authorization-status-github.ts') {
    return 'github-api';
  }
  if (
    repositoryPath === 'src/runtime-state/physical/runtime/observed-process-stdin.ts'
    && owner === 'startWindowsObservedStdinWriter'
  ) return 'windows-stdin-writer';
  if (
    repositoryPath === 'src/runtime-state/physical/runtime/windows-repository-change-observer.ts'
    && owner === 'startWatcher'
  ) return 'windows-repository-change-observer';
  if (
    repositoryPath === 'src/development/runner/verification-action-executor.ts' ||
    repositoryPath === 'src/verification/ci/runtime/verification-action-github-provider.ts' ||
    (repositoryPath === CI_VERIFICATION_WORKFLOW_PATH && owner !== 'inspectHostedActionArchiveMetadata')
  ) {
    return 'verification-action';
  }
  if (repositoryPath === CI_VERIFICATION_WORKFLOW_PATH && owner === 'inspectHostedActionArchiveMetadata') {
    return 'hosted-archive-inventory';
  }
  if (repositoryPath === 'src/verification/ci/runtime/local-github-actions-runner.ts' && owner === 'runCommand') {
    return 'local-actions-runner';
  }
  if (repositoryPath === 'src/control/documentation/doctor/cli.ts') {
    return 'docs-doctor-index';
  }
  return 'general-process';
}

function dispatcherDataflow(
  kind: SecTrustedBootstrapDispatcherKind,
  boundary: SecTrustedBootstrapDispatcherBoundary,
  loader: SecTrustedBootstrapDispatcherLoader
): SecTrustedBootstrapDispatcherDataflow {
  if (kind === 'network') {
    return Object.freeze({
      executable: 'not-applicable',
      argv: 'url-and-request-init',
      cwd: 'not-applicable',
      environment: 'provider-bound',
      stdio: 'not-applicable',
      shell: 'not-applicable',
      output: 'provider-bound',
      deadline: 'provider-bound'
    });
  }
  if (boundary === 'verification-action' && loader === 'Bun.spawn') {
    return Object.freeze({
      executable: 'process-exec-path',
      argv: 'normalized-operation',
      cwd: 'repository-root',
      environment: 'caller-bound',
      stdio: 'inherit',
      shell: 'forbidden',
      output: 'not-captured',
      deadline: 'provider-bound'
    });
  }
  if (boundary === 'hosted-archive-inventory') {
    return Object.freeze({
      executable: 'fixed-interpreter',
      argv: 'fixed-script-input',
      cwd: 'none',
      environment: 'explicit-allowlist',
      stdio: 'captured',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  if (boundary === 'local-actions-runner') {
    return Object.freeze({
      executable: 'command-input',
      argv: 'command-and-args',
      cwd: 'caller-cwd',
      environment: 'provider-bound',
      stdio: 'piped',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  if (boundary === 'docs-doctor-index') {
    return Object.freeze({
      executable: 'command-input',
      argv: 'command-and-args',
      cwd: 'repository-root',
      environment: 'provider-bound',
      stdio: 'captured',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  if (boundary === 'windows-stdin-writer') {
    return Object.freeze({
      executable: 'embedded-source',
      argv: 'fixed-script-input',
      cwd: 'none',
      environment: 'provider-bound',
      stdio: 'not-applicable',
      shell: 'forbidden',
      output: 'not-captured',
      deadline: 'provider-bound'
    });
  }
  if (boundary === 'windows-repository-change-observer') {
    return Object.freeze({
      executable: 'embedded-source',
      argv: 'fixed-script-input',
      cwd: 'none',
      environment: 'provider-bound',
      stdio: 'not-applicable',
      shell: 'forbidden',
      output: 'provider-bound',
      deadline: 'bounded'
    });
  }
  return Object.freeze({
    executable: loader === 'Bun.spawn' || loader === 'Bun.spawnSync'
      ? 'process-exec-path'
      : 'command-input',
    argv: 'command-and-args',
    cwd: 'caller-cwd',
    environment: 'provider-bound',
    stdio: 'provider-bound',
    shell: 'forbidden',
    output: 'provider-bound',
    deadline: 'provider-bound'
  });
}

function projectTrustedBootstrapDispatcher(
  kind: SecTrustedBootstrapDispatcherKind,
  identity: string
): SecTrustedBootstrapDispatcherEntry {
  assertBoundedNfc(identity, `${kind} dispatcher identity`);
  const match = TRUSTED_BOOTSTRAP_DISPATCHER_IDENTITY_PATTERN.exec(identity);
  if (match === null) {
    throw new Error(`Trusted bootstrap ${kind} dispatcher identity is not canonical: ${identity}.`);
  }
  const repositoryPath = match[1]!;
  const ownerChain = match[2]!;
  const loader = match[3]! as SecTrustedBootstrapDispatcherLoader;
  const ordinal = Number(match[4]!);
  assertRepositoryPath(repositoryPath, `${kind} dispatcher repositoryPath`, false);
  assertBoundedNfc(ownerChain, `${kind} dispatcher ownerChain`);
  if (!TRUSTED_BOOTSTRAP_DISPATCHER_LOADERS.has(loader)) {
    throw new Error(`Trusted bootstrap dispatcher loader is not recognized: ${loader}.`);
  }
  if (kind === 'process' && !TRUSTED_BOOTSTRAP_PROCESS_LOADERS.has(loader)) {
    throw new Error(`Network loader cannot be projected as a process dispatcher: ${loader}.`);
  }
  if (kind === 'network' && loader !== 'globalThis.fetch') {
    throw new Error(`Process loader cannot be projected as a network dispatcher: ${loader}.`);
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 4_096) {
    throw new Error(`Trusted bootstrap dispatcher ordinal is outside the bounded range: ${identity}.`);
  }
  const ownerSegment = ownerChain.slice(ownerChain.lastIndexOf('>') + 1);
  const owner = ownerSegment.replace(/^[^:]+:/u, '');
  assertBoundedNfc(owner, `${kind} dispatcher owner`);
  const boundary = dispatcherBoundary(repositoryPath, owner, kind);
  return Object.freeze({
    kind,
    identity,
    repositoryPath,
    ownerChain,
    owner,
    loader,
    ordinal,
    boundary,
    dataflow: dispatcherDataflow(kind, boundary, loader),
    authority: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY
  });
}

function normalizeDispatcherIdentities(
  values: Iterable<string>,
  kind: SecTrustedBootstrapDispatcherKind
): string[] {
  const identities: string[] = [];
  for (const identity of values) {
    if (identities.length >= 4_096) {
      throw new Error(`Trusted bootstrap ${kind} dispatcher projection is too large.`);
    }
    identities.push(identity);
  }
  identities.forEach((identity, index) => assertBoundedNfc(identity, `${kind} dispatchers[${index}]`));
  const sorted = [...identities].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new Error(`Trusted bootstrap ${kind} dispatcher projection contains a duplicate identity.`);
    }
  }
  return sorted;
}

/**
 * Project an exact-tree dispatcher census into the machine structure consumed
 * by contract tests and higher-level trust-root views.  The input is an
 * immutable identity census; this function owns the semantic dataflow
 * vocabulary and rejects malformed, cross-kind, or unbounded identities.
 */
export function projectSecTrustedBootstrapDispatcherDataflowV1(input: Readonly<{
  processDispatchers: Iterable<string>;
  networkDispatchers?: Iterable<string>;
}>): SecTrustedBootstrapDispatcherProjection {
  const processIdentities = normalizeDispatcherIdentities(input.processDispatchers, 'process');
  const networkIdentities = normalizeDispatcherIdentities(input.networkDispatchers ?? [], 'network');
  const processEntries = processIdentities.map((identity) =>
    projectTrustedBootstrapDispatcher('process', identity)
  );
  const networkEntries = networkIdentities.map((identity) =>
    projectTrustedBootstrapDispatcher('network', identity)
  );
  const allIdentities = new Set<string>();
  for (const entry of [...processEntries, ...networkEntries]) {
    if (allIdentities.has(entry.identity)) {
      throw new Error(`Trusted bootstrap dispatcher appears in both process and network projections: ${entry.identity}.`);
    }
    allIdentities.add(entry.identity);
  }
  return Object.freeze({
    schema: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA,
    authority: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY,
    process: Object.freeze(processEntries),
    network: Object.freeze(networkEntries)
  });
}

/**
 * Return the canonical owner and migration closure for a dispatcher
 * counterexample.  This is diagnostic reverse projection only: it does not
 * admit an effect, change the TCB allowlist, or create a work-plan decision.
 * Unknown identities remain attached to the same owner but are never inferred
 * from source text or document headings.
 */
export function reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1(input: Readonly<{
  projection: SecTrustedBootstrapDispatcherProjection;
  dispatcherIdentity: string;
  designDelta: SecTrustedBootstrapDispatcherCounterexampleDelta;
}>): SecTrustedBootstrapDispatcherCounterexample {
  if (input.projection.schema !== SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA) {
    throw new Error('Dispatcher counterexample projection schema is not recognized.');
  }
  assertBoundedNfc(input.dispatcherIdentity, 'dispatcher counterexample identity');
  if (!TRUSTED_BOOTSTRAP_COUNTEREXAMPLE_DELTAS.has(input.designDelta)) {
    throw new Error(`Dispatcher counterexample design delta is not recognized: ${input.designDelta}.`);
  }
  const entry = [...input.projection.process, ...input.projection.network]
    .find((candidate) => candidate.identity === input.dispatcherIdentity);
  const authority = SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY;
  const machineTarget = entry?.kind === 'network'
    ? authority.machineTargets[1]
    : authority.machineTargets[0];
  return Object.freeze({
    status: 'counterexample',
    dispatcherIdentity: input.dispatcherIdentity,
    owner: authority,
    designDelta: Object.freeze({
      kind: input.designDelta,
      machineTarget
    }),
    migrationClosure: Object.freeze({
      ownerId: authority.ownerId,
      machineTargets: authority.machineTargets,
      evidence: authority.evidence
    })
  });
}

function stringArray(
  value: unknown,
  label: string,
  maximum = 4_096,
  allowEmpty = false
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}bounded array.`);
  }
  const result = value.map((entry, index) => {
    assertBoundedNfc(entry, `${label}[${index}]`);
    return entry;
  });
  assertSortedUnique(result, label);
  return result;
}

function assertNoStaticOverlap(registry: SecTrustedBootstrapRegistry): void {
  for (let index = 0; index < registry.staticPrefixes.length; index += 1) {
    const prefix = registry.staticPrefixes[index]!;
    for (const other of registry.staticPrefixes.slice(index + 1)) {
      if (prefix.startsWith(other) || other.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap prefixes overlap: ${prefix} / ${other}.`);
      }
    }
  }
  for (const exact of registry.staticExactPaths) {
    for (const directory of registry.staticDirectoryPaths) {
      if (exact.startsWith(directory)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by ${directory}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (exact.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by prefix ${prefix}.`);
      }
    }
  }
  for (let index = 0; index < registry.staticDirectoryPaths.length; index += 1) {
    const directory = registry.staticDirectoryPaths[index]!;
    for (const other of registry.staticDirectoryPaths.slice(index + 1)) {
      if (directory.startsWith(other) || other.startsWith(directory)) {
        throw new Error(`Trusted bootstrap directory paths overlap: ${directory} / ${other}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (directory.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${directory} is covered by prefix ${prefix}.`);
      }
    }
  }
}

function assertRegistrySourceEnvelope(source: string): void {
  if (
    source.length === 0 ||
    source.length > 131_072 ||
    source[0] !== '{' ||
    !source.endsWith('\n') ||
    source.endsWith('\n\n') ||
    source.includes('\r') ||
    source.includes('\0')
  ) {
    throw new Error('Trusted bootstrap registry must be bounded LF JSON with exactly one trailing newline.');
  }
}

function topLevelJsonObjectKeys(source: string): string[] {
  const keys: string[] = [];
  let objectDepth = 0;
  let arrayDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      for (; index < source.length; index += 1) {
        const current = source[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === '"') break;
      }
      if (index >= source.length) {
        throw new Error('Trusted bootstrap registry contains an unterminated JSON string.');
      }
      if (objectDepth === 1 && arrayDepth === 0) {
        let cursor = index + 1;
        while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
        if (source[cursor] === ':') {
          keys.push(JSON.parse(source.slice(start, index + 1)) as string);
        }
      }
      continue;
    }
    if (character === '{') objectDepth += 1;
    else if (character === '}') objectDepth -= 1;
    else if (character === '[') arrayDepth += 1;
    else if (character === ']') arrayDepth -= 1;
  }
  return keys;
}

function validateSecTrustedBootstrapRegistryValue(value: unknown): SecTrustedBootstrapRegistry {
  assertPlainObject(value, 'trusted bootstrap registry');
  assertExactKeys(value);
  if (value.schema !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA) {
    throw new Error('Trusted bootstrap registry schema mismatch.');
  }

  const staticExactPaths = stringArray(value.staticExactPaths, 'staticExactPaths');
  const staticDirectoryPaths = stringArray(value.staticDirectoryPaths, 'staticDirectoryPaths');
  const staticPrefixes = stringArray(value.staticPrefixes, 'staticPrefixes', 128);
  const runtimeEntrypoints = stringArray(value.runtimeEntrypoints, 'runtimeEntrypoints');
  const reviewedSutEdges = stringArray(value.reviewedSutEdges, 'reviewedSutEdges', 4_096, true);
  const reviewedBoundaryEdges = stringArray(
    value.reviewedBoundaryEdges,
    'reviewedBoundaryEdges',
    4_096,
    true
  );
  const reviewedExternalImports = stringArray(value.reviewedExternalImports, 'reviewedExternalImports');

  staticExactPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticExactPaths[${index}]`, false));
  staticDirectoryPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticDirectoryPaths[${index}]`, true));
  staticPrefixes.forEach((entry, index) => assertPrefix(entry, `staticPrefixes[${index}]`));
  runtimeEntrypoints.forEach((entry, index) => assertRepositoryPath(entry, `runtimeEntrypoints[${index}]`, false));

  const registry: SecTrustedBootstrapRegistry = Object.freeze({
    schema: SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA,
    staticExactPaths: Object.freeze(staticExactPaths),
    staticDirectoryPaths: Object.freeze(staticDirectoryPaths),
    staticPrefixes: Object.freeze(staticPrefixes),
    runtimeEntrypoints: Object.freeze(runtimeEntrypoints),
    reviewedSutEdges: Object.freeze(reviewedSutEdges),
    reviewedBoundaryEdges: Object.freeze(reviewedBoundaryEdges),
    reviewedExternalImports: Object.freeze(reviewedExternalImports)
  });

  assertNoStaticOverlap(registry);
  for (const requiredPath of REQUIRED_TRUSTED_BOOTSTRAP_STATIC_EXACT_PATHS) {
    if (!registry.staticExactPaths.includes(requiredPath)) {
      throw new Error(`Trusted bootstrap registry cannot demote required static path: ${requiredPath}.`);
    }
  }
  if (registry.staticDirectoryPaths.includes('scripts/codex/')) {
    throw new Error('scripts/codex/ cannot be a directory-level verifier trust root.');
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedSutEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedSutEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedSutEdges[${index}].to`, false);
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedBoundaryEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedBoundaryEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedBoundaryEdges[${index}].to`, false);
    if (!registry.staticExactPaths.includes(match[2]!)) {
      throw new Error(`Reviewed boundary target is not a staticExactPath: ${match[2]}.`);
    }
  }
  for (const [index, edge] of registry.reviewedExternalImports.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedExternalImports[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedExternalImports[${index}].from`, false);
    assertExternalModuleSpecifier(match[2]!, `reviewedExternalImports[${index}].specifier`);
  }
  return registry;
}

export function parseSecTrustedBootstrapRegistry(source: string): SecTrustedBootstrapRegistry {
  assertRegistrySourceEnvelope(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Trusted bootstrap registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rawKeys = topLevelJsonObjectKeys(source);
  if (rawKeys.length !== REGISTRY_KEYS.length || new Set(rawKeys).size !== rawKeys.length) {
    throw new Error('Trusted bootstrap registry top-level keys must appear exactly once.');
  }
  return validateSecTrustedBootstrapRegistryValue(value);
}

export function loadSecTrustedBootstrapRegistry(): SecTrustedBootstrapRegistry {
  const absolutePath = path.join(import.meta.dir, 'ci-trust-root-registry.json');
  return parseSecTrustedBootstrapRegistry(readFileSync(absolutePath, 'utf8'));
}

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY = loadSecTrustedBootstrapRegistry();

export function createSecTrustedBootstrapTrustRoot(
  input: Readonly<{
    registry: SecTrustedBootstrapRegistry;
    causalRuntimePaths: readonly string[];
  }>
): SecTrustedBootstrapTrustRoot {
  const registry = validateSecTrustedBootstrapRegistryValue(input.registry);
  const causalRuntimePaths = stringArray(input.causalRuntimePaths, 'causalRuntimePaths');
  causalRuntimePaths.forEach((entry, index) => assertRepositoryPath(entry, `causalRuntimePaths[${index}]`, false));
  const causal = new Set(causalRuntimePaths);
  for (const staticExactPath of registry.staticExactPaths) {
    if (causal.has(staticExactPath)) {
      throw new Error(`Trusted bootstrap path cannot be both staticExact and causalRuntime: ${staticExactPath}.`);
    }
  }
  if (causal.has(REPOSITORY_AUDIT_ENTRYPOINT_PATH)) {
    throw new Error('repository-audit.ts cannot enter the causal verifier closure without new physical closure evidence.');
  }
  for (const entrypoint of registry.runtimeEntrypoints) {
    if (!causal.has(entrypoint)) {
      throw new Error(`Runtime entrypoint is absent from causalRuntimePaths: ${entrypoint}.`);
    }
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const source = /^([^ ]+) -> ([^ ]+)$/u.exec(edge)?.[1];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed SUT edge source is outside causalRuntimePaths: ${source ?? index}.`);
    }
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    const source = match?.[1];
    const target = match?.[2];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed boundary source is outside causalRuntimePaths: ${source ?? index}.`);
    }
    if (target !== undefined && causal.has(target)) {
      throw new Error(`Reviewed boundary target cannot also be a causalRuntimePath: ${target}.`);
    }
  }
  return Object.freeze({
    schema: 'sec-trusted-bootstrap-trust-root-v3' as const,
    registry,
    causalRuntimePaths: Object.freeze(causalRuntimePaths),
    paths: Object.freeze([...new Set([...registry.staticExactPaths, ...registry.staticDirectoryPaths, ...causalRuntimePaths])].sort()),
    prefixes: registry.staticPrefixes
  });
}

export function matchSecTrustedBootstrapPath(
  repositoryPath: string,
  trustRoot: SecTrustedBootstrapTrustRoot
): SecTrustedBootstrapPathMatch | null {
  assertRepositoryPath(repositoryPath, 'repositoryPath', false);
  const registry = trustRoot.registry;
  if (registry.staticExactPaths.includes(repositoryPath)) {
    return { kind: 'static-exact', rule: repositoryPath };
  }
  const staticDirectory = registry.staticDirectoryPaths.find((entry) => repositoryPath.startsWith(entry));
  if (staticDirectory) return { kind: 'static-directory', rule: staticDirectory };
  const staticPrefix = registry.staticPrefixes.find((entry) => repositoryPath.startsWith(entry));
  if (staticPrefix) return { kind: 'static-prefix', rule: staticPrefix };
  if (trustRoot.causalRuntimePaths.includes(repositoryPath)) {
    return { kind: 'causal-runtime', rule: repositoryPath };
  }
  return null;
}
