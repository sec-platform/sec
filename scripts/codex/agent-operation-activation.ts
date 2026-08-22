#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSecAgentOperationActivationPreparationV1,
  createSecAgentOperationActivationProviderV1,
  createSecAgentOperationActivationPublicationV1,
  createSecAgentOperationActivationReceiptV1,
  createSecAgentOperationActivationRequestV1,
  parseSecAgentOperationActivationPreparationV1,
  parseSecAgentOperationActivationPublicationCommentV1,
  parseSecAgentOperationActivationReceiptV1,
  parseSecAgentOperationActivationRequestV1,
  renderSecAgentOperationActivationPublicationCommentV1,
  SEC_AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE,
  SEC_AGENT_OPERATION_ACTIVATION_COMMENT_MARKER,
  SEC_AGENT_OPERATION_ACTIVATION_EVENT,
  SEC_AGENT_OPERATION_ACTIVATION_JOB_NAME,
  SEC_AGENT_OPERATION_ACTIVATION_STEP_NAME,
  SEC_AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME,
  SEC_AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH,
  secAgentOperationActivationArtifactNameV1,
  secAgentOperationActivationOperationIdV1,
  type SecAgentOperationActivationPreparationV1,
  type SecAgentOperationActivationProviderV1,
  type SecAgentOperationActivationPublicationV1,
  type SecAgentOperationActivationReceiptV1,
  type SecAgentOperationActivationRequestV1
} from '../../platform/shared/agent-operation-activation-contract.ts';
import {
  canonicalJson,
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../platform/shared/canonical-primitives.ts';
import {
  parseGitChangedRecordsOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../../platform/shared/ci-git-changed-files.ts';
import {
  documentationRecordById,
  parseDocumentationAuthorityRegistry,
  resolveDocumentationOperationOwnersV1
} from '../../platform/shared/documentation-authority-contract.ts';
import {
  compileSecWorkRollingTopologyV1,
  type SecRoadmapWorkCatalogItemV1,
  type SecWorkDecisionReceiptV1
} from '../../platform/shared/work-selection-live-contract.ts';
import {
  assertAgentOperationActivationWorkPackageCensusV1,
  isCanonicalAgentOperationActivationWorkPackagePathV1
} from './agent-operation-activation-census.ts';
import {
  hostedPublisherMatches,
  issueCommentRecord,
  type IssueCommentRecord
} from './branch-closeout-receipt.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from './document-control-plane-contract.ts';
import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentParseCurrentWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest,
  type CodexDevelopmentWorkPackageManifest
} from './work-package-contract.ts';
import { observeSecWorkSelectionLiveV1 } from './work-selection.ts';

const CONTROL_PATHS = Object.freeze({
  currentState: 'docs/work/current-state.yaml',
  pointer: 'docs/work/active-work-package.md',
  rollingPlan: 'docs/work/rolling-plan.md'
});
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export const SEC_AGENT_OPERATION_ACTIVATION_REASON_CODES = Object.freeze([
  'activation-receipt-absent',
  'activation-stale',
  'activation-scope-conflict',
  'activation-issuer-unavailable',
  'activation-provider-unavailable',
  'activation-provider-readback-conflict'
] as const);
export type SecAgentOperationActivationReasonCodeV1 =
  typeof SEC_AGENT_OPERATION_ACTIVATION_REASON_CODES[number];

type CommandResult = Readonly<{
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}>;

export class SecAgentOperationActivationUnavailableError extends Error {
  readonly reasonCode: SecAgentOperationActivationReasonCodeV1;
  readonly blockerDigest: `sha256:${string}`;

  constructor(reasonCode: SecAgentOperationActivationReasonCodeV1, detail: string | Uint8Array = reasonCode) {
    super(`Agent operation activation is unavailable (${reasonCode}).`);
    this.name = 'SecAgentOperationActivationUnavailableError';
    this.reasonCode = reasonCode;
    this.blockerDigest = rawSha256(detail);
  }
}

function unavailable(
  reasonCode: SecAgentOperationActivationReasonCodeV1,
  detail?: string | Uint8Array
): never {
  throw new SecAgentOperationActivationUnavailableError(reasonCode, detail);
}

function guarded<T>(
  reasonCode: SecAgentOperationActivationReasonCodeV1,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) throw error;
    unavailable(reasonCode, error instanceof Error ? error.message : String(error));
  }
}

function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  input?: Uint8Array
): CommandResult {
  const result = spawnSync(executable, [...args], {
    cwd,
    input,
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? '');
  const processError = result.error === undefined ? Buffer.alloc(0) : Buffer.from(result.error.message, 'utf8');
  return Object.freeze({
    status: result.status ?? -1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''),
    stderr: Buffer.concat([stderr, processError])
  });
}

function requireCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  reasonCode: SecAgentOperationActivationReasonCodeV1,
  input?: Uint8Array
): Buffer {
  const result = command(executable, args, cwd, input);
  if (result.status !== 0) unavailable(reasonCode, Buffer.concat([result.stdout, result.stderr]));
  return result.stdout;
}

function decodeUtf8(value: Uint8Array, reasonCode: SecAgentOperationActivationReasonCodeV1): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    unavailable(reasonCode, value);
  }
}

function textCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  reasonCode: SecAgentOperationActivationReasonCodeV1,
  input?: Uint8Array
): string {
  return decodeUtf8(requireCommand(executable, args, cwd, reasonCode, input), reasonCode).trim();
}

function parseJson(source: string, reasonCode: SecAgentOperationActivationReasonCodeV1): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    unavailable(reasonCode, source);
  }
}

function record(value: unknown, reasonCode: SecAgentOperationActivationReasonCodeV1): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    unavailable(reasonCode, JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function gitSha(value: string, reasonCode: SecAgentOperationActivationReasonCodeV1): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) unavailable(reasonCode, value);
  return value;
}

function positiveId(value: unknown, reasonCode: SecAgentOperationActivationReasonCodeV1): string {
  const normalized = String(value ?? '');
  if (!/^[1-9][0-9]*$/u.test(normalized)) unavailable(reasonCode, normalized);
  return normalized;
}

function physicalPath(value: string): string {
  try {
    return realpathSync.native(path.resolve(value));
  } catch (error) {
    unavailable('activation-stale', error instanceof Error ? error.message : String(error));
  }
}

function samePhysicalPath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function repositoryRoot(value: string): string {
  const root = physicalPath(value);
  const observed = physicalPath(textCommand(
    'git', ['rev-parse', '--show-toplevel'], root, 'activation-stale'
  ));
  if (!samePhysicalPath(root, observed)) unavailable('activation-stale', observed);
  return root;
}

function commonGitDirectory(root: string): string {
  const observed = textCommand('git', ['rev-parse', '--git-common-dir'], root, 'activation-stale');
  return physicalPath(path.isAbsolute(observed) ? observed : path.resolve(root, observed));
}

function assertSameRepository(runtimeRoot: string, candidateRoot: string): void {
  if (!samePhysicalPath(commonGitDirectory(runtimeRoot), commonGitDirectory(candidateRoot))) {
    unavailable('activation-stale', 'candidate-repository-mismatch');
  }
}

function gitHead(root: string): string {
  return gitSha(textCommand('git', ['rev-parse', 'HEAD'], root, 'activation-stale'), 'activation-stale');
}

function gitTree(root: string, revision: string): string {
  return gitSha(
    textCommand('git', ['rev-parse', `${revision}^{tree}`], root, 'activation-stale'),
    'activation-stale'
  );
}

function gitBranch(root: string): string {
  const branch = textCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'activation-stale');
  if (!branch.startsWith('codex/')) unavailable('activation-stale', branch);
  return branch;
}

function readGitBlob(root: string, expression: string): Readonly<{ oid: string; bytes: Buffer }> {
  const oid = gitSha(
    textCommand('git', ['rev-parse', '--verify', expression], root, 'activation-stale'),
    'activation-stale'
  );
  if (textCommand('git', ['cat-file', '-t', oid], root, 'activation-stale') !== 'blob') {
    unavailable('activation-stale', expression);
  }
  return Object.freeze({
    oid,
    bytes: requireCommand('git', ['cat-file', 'blob', oid], root, 'activation-stale')
  });
}

function gitObjectExists(root: string, expression: string): boolean {
  const result = command('git', ['rev-parse', '--verify', '--quiet', expression], root);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  unavailable('activation-stale', result.stderr);
}

function isGitAncestor(root: string, ancestor: string, descendant: string): boolean {
  const result = command('git', ['merge-base', '--is-ancestor', ancestor, descendant], root);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  unavailable('activation-stale', result.stderr);
}

function assertCleanExactRoot(root: string, head: string): void {
  if (gitHead(root) !== head) unavailable('activation-stale', 'head-drift');
  const status = requireCommand(
    'git', ['status', '--porcelain=v2', '-z', '--untracked-files=all'], root, 'activation-stale'
  );
  if (status.length !== 0) unavailable('activation-stale', status);
}

function changedRecordsBetween(
  root: string,
  baseRevision: string,
  targetRevision: string
): CodexDevelopmentGitChangedRecordV1[] {
  return parseGitChangedRecordsOutput(requireCommand('git', [
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames',
    '--find-copies', '--diff-filter=ACDMRTUXB', baseRevision, targetRevision, '--'
  ], root, 'activation-scope-conflict'));
}

function changedPaths(records: readonly CodexDevelopmentGitChangedRecordV1[]): readonly string[] {
  return Object.freeze([...new Set(records.flatMap((entry) => (
    entry.previousPath === undefined ? [entry.path] : [entry.previousPath, entry.path]
  )))].sort(compareCodeUnits));
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalJson(value), null, 2)}\n`, 'utf8');
}

function listWorkPackagePaths(root: string, revision: string): readonly string[] {
  const bytes = requireCommand('git', [
    '-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', '-z', revision,
    '--', 'docs/work-packages'
  ], root, 'activation-scope-conflict');
  if (bytes.length === 0 || bytes.at(-1) !== 0) {
    unavailable('activation-scope-conflict', 'candidate-work-package-census-is-empty-or-unterminated');
  }
  const paths = decodeUtf8(bytes.subarray(0, -1), 'activation-scope-conflict')
    .split('\0')
    .sort(compareCodeUnits);
  if (paths.some((entry) => !isCanonicalAgentOperationActivationWorkPackagePathV1(entry))
      || new Set(paths).size !== paths.length) {
    unavailable('activation-scope-conflict', JSON.stringify(paths));
  }
  return Object.freeze(paths);
}

function preparationWorkPackageDeletions(
  candidateRoot: string,
  trustedBase: string,
  proposalRevision: string,
  manifestPath: string,
  manifestBytes: Uint8Array,
  tracking: string
): readonly string[] {
  const defaultPackagePaths = listWorkPackagePaths(candidateRoot, trustedBase);
  const candidatePackagePaths = listWorkPackagePaths(candidateRoot, proposalRevision);
  const candidateEntries = candidatePackagePaths.map((packagePath) => ({
    path: packagePath,
    candidateBytes: packagePath === manifestPath
      ? manifestBytes
      : readGitBlob(candidateRoot, `${proposalRevision}:${packagePath}`).bytes,
    defaultBytes: gitObjectExists(candidateRoot, `${trustedBase}:${packagePath}`)
      ? readGitBlob(candidateRoot, `${trustedBase}:${packagePath}`).bytes
      : null
  }));
  return guarded('activation-scope-conflict', () =>
    assertAgentOperationActivationWorkPackageCensusV1({
      selectedManifestPath: manifestPath,
      candidateEntries,
      defaultPackagePaths,
      ...(tracking === 'none' && candidatePackagePaths.length > 1
        ? {
            roadmapSource: decodeUtf8(
              readGitBlob(candidateRoot, `${proposalRevision}:docs/roadmap.md`).bytes,
              'activation-scope-conflict'
            )
          }
        : {})
    }));
}

export interface SecOperationAuthorityOwnerObservationV1 {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
  readonly contentDigest: `sha256:${string}`;
}

function observeOperationAuthorityOwners(
  candidateRoot: string,
  trustedRevision: string,
  targetCandidate: string,
  manifest: CodexDevelopmentWorkPackageManifest,
  paths: readonly string[]
): readonly SecOperationAuthorityOwnerObservationV1[] {
  if (manifest.schema !== 'codex-development-work-package-v1'
      || manifest.authorityRefs === undefined) {
    unavailable('activation-scope-conflict', 'work-package-authority-refs-missing');
  }
  let records: ReturnType<typeof resolveDocumentationOperationOwnersV1>;
  try {
    const registryBlob = readGitBlob(candidateRoot, `${trustedRevision}:docs/authority.json`);
    const registryBytes = registryBlob.bytes;
    const registry = parseDocumentationAuthorityRegistry(decodeUtf8(registryBytes, 'activation-scope-conflict'));
    const owners = resolveDocumentationOperationOwnersV1({
      registry,
      authorityRefs: manifest.authorityRefs,
      changedPaths: paths
    });
    const agents = documentationRecordById(registry, 'agents-entry');
    const registryOwner = documentationRecordById(registry, 'documentation-registry');
    if (agents === undefined || registryOwner === undefined
        || agents.path !== 'AGENTS.md' || registryOwner.path !== 'docs/authority.json') {
      unavailable('activation-scope-conflict', 'startup-document-owner-missing');
    }
    records = Object.freeze([agents, registryOwner, ...owners]
      .filter((entry, index, values) => values.findIndex(({ id }) => id === entry.id) === index)
      .sort((left, right) => compareCodeUnits(left.id, right.id)));
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) throw error;
    unavailable('activation-scope-conflict', error instanceof Error ? error.message : String(error));
  }
  return Object.freeze(records.map((entry) => {
    const revision = entry.id !== 'documentation-registry' && paths.includes(entry.path)
      ? targetCandidate
      : trustedRevision;
    const blob = readGitBlob(candidateRoot, `${revision}:${entry.path}`);
    return Object.freeze({
      id: entry.id,
      ref: entry.path,
      owner: entry.domain,
      revision: blob.oid,
      contentDigest: rawSha256(blob.bytes)
    });
  }));
}

function requireResolvedWorkDecision(root: string): SecWorkDecisionReceiptV1 {
  const result = observeSecWorkSelectionLiveV1({ cwd: root });
  if (result.status !== 'resolved') {
    unavailable('activation-stale', JSON.stringify({
      reasonCodes: result.reasonCodes,
      blockerRefsDigest: sha256(result.blockerRefs)
    }));
  }
  return result.receipt;
}

function workBinding(
  receipt: SecWorkDecisionReceiptV1,
  manifest: CodexDevelopmentWorkPackageManifest,
  phase: 'prepare' | 'finalize'
): Readonly<{ item: SecRoadmapWorkCatalogItemV1; currentSpecRevision: `sha256:${string}` }> {
  const item = receipt.catalog.items.find(({ packageId }) => packageId === manifest.id);
  if (item === undefined || item.tracking !== manifest.tracking) {
    unavailable('activation-stale', 'work-package-catalog-binding-invalid');
  }
  const binding = receipt.decision.currentSpecBindings.find(({ workId }) => workId === item.workId);
  if (binding === undefined || binding.currentSpecRef !== item.currentSpecRef) {
    unavailable('activation-stale', 'current-spec-binding-missing');
  }
  const selected = receipt.decision.status === 'select-next'
    && receipt.decision.selectedWorkId === item.workId
    && receipt.decision.selectedCurrentSpecRef === binding.currentSpecRef
    && receipt.decision.selectedCurrentSpecRevision === binding.currentSpecRevision;
  const continued = receipt.decision.status === 'continue-active'
    && receipt.decision.selectedWorkId === item.workId
    && receipt.input.current.activeWorkId === item.workId
    && receipt.input.current.activeState === 'incomplete'
    && receipt.input.current.activeLegality === 'legal';
  if ((phase === 'finalize' && !continued) || (phase === 'prepare' && !selected && !continued)) {
    unavailable('activation-stale', receipt.decision.decisionDigest);
  }
  return Object.freeze({ item, currentSpecRevision: binding.currentSpecRevision });
}

interface CandidateControlSnapshot {
  readonly manifestPath: string;
  readonly manifestRevision: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly manifestBytes: Uint8Array;
  readonly manifest: CodexDevelopmentWorkPackageManifest;
  readonly rollingTopology: Readonly<{
    activePackageId: string;
    candidatePackageIds: readonly string[];
  }>;
  readonly controlDigests: Readonly<{
    currentState: `sha256:${string}`;
    pointer: `sha256:${string}`;
    rollingPlan: `sha256:${string}`;
  }>;
}

function workPackageAuthorizedPaths(
  manifest: CodexDevelopmentWorkPackageManifest
): readonly string[] {
  return Object.freeze(
    manifest.tasks.flatMap(({ ownedPaths }) => ownedPaths).sort(compareCodeUnits)
  );
}

function workPackageForbiddenPaths(
  manifest: CodexDevelopmentWorkPackageManifest
): readonly string[] {
  return Object.freeze([...manifest.forbiddenPaths].sort(compareCodeUnits));
}

function assertManifestTestBlobsExist(
  candidateRoot: string,
  revision: string,
  manifest: CodexDevelopmentWorkPackageManifest
): void {
  const bytes = requireCommand('git', [
    '-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', revision, '--', 'tests'
  ], candidateRoot, 'activation-stale');
  if (bytes.length === 0 || bytes.at(-1) !== 0) {
    unavailable('activation-stale', 'candidate-test-census-is-empty-or-unterminated');
  }
  const blobs = new Set(
    decodeUtf8(bytes.subarray(0, -1), 'activation-stale')
      .split('\0')
      .map((entry) => /^(?:100644|100755) blob [0-9a-f]{40,64}\t(.+)$/u.exec(entry))
      .filter((entry): entry is RegExpExecArray => entry !== null)
      .map((entry) => entry[1]!)
  );
  const missing = manifest.tests.filter((testPath) => !blobs.has(testPath));
  if (missing.length !== 0) {
    unavailable('activation-stale', `work-package-test-blobs-missing:${JSON.stringify(missing)}`);
  }
}

function readCandidateControl(
  candidateRoot: string,
  revision: string,
  receipt: SecWorkDecisionReceiptV1
): CandidateControlSnapshot {
  const stateBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.currentState}`).bytes;
  const pointerBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.pointer}`).bytes;
  const rollingBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.rollingPlan}`).bytes;
  const state = CodexDevelopmentParseCurrentStateSpecV1(decodeUtf8(stateBytes, 'activation-stale'));
  const pointer = CodexDevelopmentParseActivePointerV2(decodeUtf8(pointerBytes, 'activation-stale'));
  const rolling = CodexDevelopmentParseRollingPlanV1(decodeUtf8(rollingBytes, 'activation-stale'));
  CodexDevelopmentAssertControlPlaneBindingV1({ spec: state, pointer });
  if (state.resolver.repository !== receipt.repository
      || state.resolver.defaultRef !== `refs/remotes/${state.resolver.remote}/${state.resolver.defaultBranch}`) {
    unavailable('activation-stale', 'candidate-current-state-identity-drift');
  }
  const manifestBlob = readGitBlob(candidateRoot, `${revision}:${pointer.manifest}`);
  const manifestBytes = manifestBlob.bytes;
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(
    decodeUtf8(manifestBytes, 'activation-stale'), pointer.manifest
  );
  assertManifestTestBlobsExist(candidateRoot, revision, manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;
  if (pointer.manifestDigest !== manifestDigest || rolling.activePackageId !== manifest.id
      || manifest.base !== receipt.exactMain
      || gitObjectExists(candidateRoot, `${receipt.exactMain}:${pointer.manifest}`)) {
    unavailable('activation-stale', 'candidate-control-binding-invalid');
  }
  return Object.freeze({
    manifestPath: pointer.manifest,
    manifestRevision: manifestBlob.oid,
    manifestDigest,
    manifestBytes,
    manifest,
    rollingTopology: Object.freeze({
      activePackageId: rolling.activePackageId,
      candidatePackageIds: Object.freeze([...rolling.candidatePackageIds])
    }),
    controlDigests: Object.freeze({
      currentState: rawSha256(stateBytes),
      pointer: rawSha256(pointerBytes),
      rollingPlan: rawSha256(rollingBytes)
    })
  });
}

function assertPreparationSelection(
  control: CandidateControlSnapshot,
  decision: SecWorkDecisionReceiptV1
): void {
  const topology = guarded('activation-scope-conflict', () => compileSecWorkRollingTopologyV1(decision));
  if (topology.activePackageId !== control.manifest.id
      || control.rollingTopology.activePackageId !== topology.activePackageId
      || !canonicalEqual(control.rollingTopology.candidatePackageIds, topology.candidatePackageIds)) {
    unavailable('activation-scope-conflict', 'candidate-rolling-topology-differs-from-work-decision');
  }
}

function exactPullRequestEntry(
  receipt: SecWorkDecisionReceiptV1,
  request: SecAgentOperationActivationRequestV1,
  headRef: string,
  candidateRoot: string
): Readonly<{
  number: number;
  baseSha: string;
  headSha: string;
  headTreeSha: string;
  headRef: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
}> {
  const entries = receipt.registry.entries.filter((entry) => entry.source === 'open-pr'
    && entry.prNumber === request.pullRequestNumber
    && entry.baseSha === request.expectedBaseSha
    && entry.headSha === request.expectedHeadSha
    && entry.manifestPath === request.manifestPath
    && entry.manifestDigest === request.manifestDigest);
  if (entries.length !== 1 || entries[0]!.headTreeSha === null
      || gitTree(candidateRoot, request.expectedHeadSha) !== entries[0]!.headTreeSha) {
    unavailable('activation-stale', 'exact-open-pr-registry-entry-missing');
  }
  if (!headRef.startsWith('codex/')) unavailable('activation-stale', headRef);
  return Object.freeze({
    number: request.pullRequestNumber,
    baseSha: request.expectedBaseSha,
    headSha: request.expectedHeadSha,
    headTreeSha: entries[0]!.headTreeSha,
    headRef,
    manifestPath: request.manifestPath,
    manifestDigest: request.manifestDigest
  });
}

function assertRequestBindings(
  request: SecAgentOperationActivationRequestV1,
  provider: SecAgentOperationActivationProviderV1,
  receipt: SecWorkDecisionReceiptV1,
  candidateRoot: string
): void {
  if (provider.workflowSha !== receipt.exactMain || request.expectedBaseSha !== receipt.exactMain
      || gitHead(candidateRoot) !== request.expectedHeadSha
      || gitTree(candidateRoot, request.expectedHeadSha) === receipt.exactMainTree) {
    unavailable('activation-stale', 'request-base-head-provider-binding-drift');
  }
  if (!isGitAncestor(candidateRoot, request.expectedBaseSha, request.expectedHeadSha)) {
    unavailable('activation-stale', 'request-base-is-not-an-ancestor');
  }
}

function assertPreparationProposal(
  records: readonly CodexDevelopmentGitChangedRecordV1[],
  manifest: CodexDevelopmentWorkPackageManifest,
  manifestPath: string,
  manifestBytes: Uint8Array,
  trustedBase: string,
  proposalRevision: string,
  candidateRoot: string
): void {
  const deletedPackagePaths = preparationWorkPackageDeletions(
    candidateRoot,
    trustedBase,
    proposalRevision,
    manifestPath,
    manifestBytes,
    manifest.tracking
  );
  const allowed = new Set<string>([
    CONTROL_PATHS.pointer,
    CONTROL_PATHS.rollingPlan,
    manifestPath,
    ...deletedPackagePaths
  ]);
  const paths = changedPaths(records);
  if (!paths.includes(CONTROL_PATHS.pointer) || !paths.includes(CONTROL_PATHS.rollingPlan)
      || !paths.includes(manifestPath) || paths.length !== allowed.size
      || [...allowed].some((entry) => !paths.includes(entry))
      || paths.some((entry) => !allowed.has(entry))) {
    unavailable('activation-scope-conflict', JSON.stringify(paths));
  }
  CodexDevelopmentAssertWorkPackageChangedRecords(manifest, records);
}

function assertPreparationStillAuthorizesFinal(
  candidateRoot: string,
  decision: SecWorkDecisionReceiptV1,
  preparation: SecAgentOperationActivationPreparationV1,
  finalControl: CandidateControlSnapshot,
  binding: ReturnType<typeof workBinding>
): void {
  if (preparation.repository !== decision.repository
      || preparation.trustedBaseSha !== decision.exactMain
      || preparation.trustedBaseTreeSha !== decision.exactMainTree
      || !canonicalEqual(
        preparation.authorizedPaths,
        workPackageAuthorizedPaths(finalControl.manifest)
      )
      || !canonicalEqual(preparation.forbiddenPaths, workPackageForbiddenPaths(finalControl.manifest))
      || binding.item.workId !== preparation.workId
      || binding.item.currentSpecRef !== preparation.currentSpecRef
      || binding.currentSpecRevision !== preparation.currentSpecRevision) {
    unavailable('activation-stale', 'PRE-current-operation-binding-drift');
  }
  const proposalTree = gitTree(candidateRoot, preparation.proposal.headSha);
  const proposalRecords = changedRecordsBetween(
    candidateRoot,
    decision.exactMain,
    preparation.proposal.headSha
  );
  const proposalControl = readCandidateControl(
    candidateRoot,
    preparation.proposal.headSha,
    decision
  );
  assertPreparationSelection(proposalControl, decision);
  assertPreparationProposal(
    proposalRecords,
    proposalControl.manifest,
    proposalControl.manifestPath,
    proposalControl.manifestBytes,
    decision.exactMain,
    preparation.proposal.headSha,
    candidateRoot
  );
  if (proposalTree !== preparation.proposal.headTreeSha
      || !canonicalEqual(changedPaths(proposalRecords), preparation.proposalChangedPaths)
      || proposalControl.manifestPath !== finalControl.manifestPath
      || proposalControl.manifestDigest !== finalControl.manifestDigest
      || !canonicalEqual(proposalControl.controlDigests, finalControl.controlDigests)) {
    unavailable('activation-stale', 'PRE-consumer-stable-fact-rederivation-drift');
  }
}

function listActivationComments(root: string, endpoint: string): readonly IssueCommentRecord[] {
  const bytes = requireCommand('gh', [
    'api', '--paginate', '--slurp', `${endpoint}?per_page=100`
  ], root, 'activation-provider-unavailable');
  try {
    const pages = parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
      'activation-provider-readback-conflict');
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
      unavailable('activation-provider-readback-conflict', bytes);
    }
    return Object.freeze(pages.flat().map((value, index) => issueCommentRecord(
      value, `Agent operation activation comment ${index}`
    )));
  } catch {
    unavailable('activation-provider-readback-conflict', bytes);
  }
}

function apiRecord(
  root: string,
  endpoint: string
): Readonly<{ value: Record<string, unknown>; bytes: Buffer }> {
  const bytes = requireCommand('gh', ['api', endpoint], root, 'activation-provider-unavailable');
  try {
    return Object.freeze({
      value: record(parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
        'activation-provider-readback-conflict'), 'activation-provider-readback-conflict'),
      bytes
    });
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) {
      unavailable('activation-provider-readback-conflict', bytes);
    }
    throw error;
  }
}

function providerFromEnvironment(): SecAgentOperationActivationProviderV1 {
  const required = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value.length === 0) unavailable('activation-issuer-unavailable', name);
    return value;
  };
  return createSecAgentOperationActivationProviderV1({
    repositoryId: required('GITHUB_REPOSITORY_ID'),
    workflowPath: SEC_AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH,
    workflowRef: `${SEC_AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH}@${required('GITHUB_SHA')}`,
    workflowSha: required('GITHUB_SHA'),
    runId: required('GITHUB_RUN_ID'),
    runAttempt: Number(required('GITHUB_RUN_ATTEMPT')),
    eventName: 'repository_dispatch',
    jobName: SEC_AGENT_OPERATION_ACTIVATION_JOB_NAME,
    uploadStepName: SEC_AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME,
    publicationStepName: SEC_AGENT_OPERATION_ACTIVATION_STEP_NAME,
    actorLogin: required('SEC_ACTIVATION_ACTOR_LOGIN'),
    actorNodeId: required('SEC_ACTIVATION_ACTOR_NODE_ID'),
    actorPermission: required('SEC_ACTIVATION_ACTOR_PERMISSION') as 'admin' | 'maintain'
  });
}

function assertProviderLive(
  root: string,
  repository: string,
  provider: SecAgentOperationActivationProviderV1
): void {
  const repoObservation = apiRecord(root, `/repos/${repository}`);
  const repo = repoObservation.value;
  if (String(repo.id ?? '') !== provider.repositoryId || repo.full_name !== repository
      || repo.default_branch !== 'main') {
    unavailable('activation-provider-readback-conflict', repoObservation.bytes);
  }
  const runObservation = apiRecord(root,
    `/repos/${repository}/actions/runs/${provider.runId}/attempts/${provider.runAttempt}`);
  const run = runObservation.value;
  let actor: Record<string, unknown>;
  let runRepository: Record<string, unknown>;
  try {
    actor = record(run.actor, 'activation-provider-readback-conflict');
    runRepository = record(run.repository, 'activation-provider-readback-conflict');
  } catch {
    unavailable('activation-provider-readback-conflict', runObservation.bytes);
  }
  if (String(run.id ?? '') !== provider.runId || run.run_attempt !== provider.runAttempt
      || run.event !== provider.eventName || run.path !== provider.workflowPath
      || run.head_sha !== provider.workflowSha
      || String(actor.login ?? '').toLowerCase() !== provider.actorLogin
      || actor.node_id !== provider.actorNodeId || String(runRepository.id ?? '') !== provider.repositoryId) {
    unavailable('activation-provider-readback-conflict', runObservation.bytes);
  }
  const permissionObservation = apiRecord(root,
    `/repos/${repository}/collaborators/${provider.actorLogin}/permission`);
  const permission = permissionObservation.value;
  const role = String(permission.permission ?? '').toLowerCase();
  if (role !== provider.actorPermission || (role !== 'admin' && role !== 'maintain')) {
    unavailable('activation-provider-readback-conflict', permissionObservation.bytes);
  }
  const jobsBytes = requireCommand('gh', [
    'api', '--paginate', '--slurp',
    `/repos/${repository}/actions/runs/${provider.runId}/attempts/${provider.runAttempt}/jobs?per_page=100`
  ], root, 'activation-provider-unavailable');
  let jobsValue: unknown;
  try {
    jobsValue = parseJson(decodeUtf8(jobsBytes, 'activation-provider-readback-conflict'),
      'activation-provider-readback-conflict');
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) {
      unavailable('activation-provider-readback-conflict', jobsBytes);
    }
    throw error;
  }
  let jobs: Record<string, unknown>[];
  try {
    if (!Array.isArray(jobsValue)) unavailable('activation-provider-readback-conflict', jobsBytes);
    jobs = jobsValue.flatMap((page) => {
      const pageRecord = record(page, 'activation-provider-readback-conflict');
      return Array.isArray(pageRecord.jobs) ? pageRecord.jobs : [];
    }).map((job) => record(job, 'activation-provider-readback-conflict'));
  } catch {
    unavailable('activation-provider-readback-conflict', jobsBytes);
  }
  const matching = jobs.filter((job) => job.name === provider.jobName
    && String(job.run_id ?? '') === provider.runId
    && job.run_attempt === provider.runAttempt);
  if (matching.length !== 1) unavailable('activation-provider-readback-conflict', jobsBytes);
  const steps = matching[0]!.steps;
  if (!Array.isArray(steps)) unavailable('activation-provider-readback-conflict', jobsBytes);
  let upload: Record<string, unknown> | undefined;
  let publish: Record<string, unknown> | undefined;
  try {
    const normalizedSteps = steps.map((step) => record(step, 'activation-provider-readback-conflict'));
    upload = normalizedSteps.find((step) => step.name === provider.uploadStepName);
    publish = normalizedSteps.find((step) => step.name === provider.publicationStepName);
  } catch {
    unavailable('activation-provider-readback-conflict', jobsBytes);
  }
  if (upload?.status !== 'completed' || upload.conclusion !== 'success'
      || publish === undefined) {
    unavailable('activation-provider-readback-conflict', jobsBytes);
  }
}

function assertArtifactMetadata(
  root: string,
  repository: string,
  publication: SecAgentOperationActivationPublicationV1
): void {
  const metadataObservation = apiRecord(root,
    `/repos/${repository}/actions/artifacts/${publication.artifactId}`);
  const metadata = metadataObservation.value;
  let workflowRun: Record<string, unknown>;
  try {
    workflowRun = record(metadata.workflow_run, 'activation-provider-readback-conflict');
  } catch {
    unavailable('activation-provider-readback-conflict', metadataObservation.bytes);
  }
  if (String(metadata.id ?? '') !== publication.artifactId
      || metadata.name !== publication.artifactName || metadata.expired !== false
      || String(metadata.digest ?? '') !== publication.artifactDigest
      || String(workflowRun.id ?? '') !== publication.provider.runId
      || String(workflowRun.repository_id ?? '') !== publication.provider.repositoryId
      || String(workflowRun.head_repository_id ?? '') !== publication.provider.repositoryId
      || workflowRun.head_sha !== publication.provider.workflowSha) {
    unavailable('activation-provider-readback-conflict', metadataObservation.bytes);
  }
}

function downloadArtifactPayload(
  root: string,
  repository: string,
  publication: SecAgentOperationActivationPublicationV1
): Readonly<{ bytes: Buffer; payload: unknown }> {
  assertArtifactMetadata(root, repository, publication);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-agent-operation-activation-'));
  try {
    const archiveBytes = requireCommand('gh', [
      'api', '-H', 'Accept: application/vnd.github+json',
      `/repos/${repository}/actions/artifacts/${publication.artifactId}/zip`
    ], root, 'activation-provider-unavailable');
    if (rawSha256(archiveBytes) !== publication.artifactDigest) {
      unavailable('activation-provider-readback-conflict', archiveBytes);
    }
    const archivePath = path.join(temporaryRoot, 'artifact.zip');
    writeFileSync(archivePath, archiveBytes, { flag: 'wx' });
    const archiveTool = process.platform === 'win32' ? 'tar' : 'unzip';
    const listArgs = process.platform === 'win32'
      ? ['-tf', archivePath]
      : ['-Z1', archivePath];
    const list = requireCommand(
      archiveTool, listArgs, temporaryRoot, 'activation-provider-readback-conflict'
    );
    const entries = decodeUtf8(list, 'activation-provider-readback-conflict')
      .split(/\r?\n/u).filter(Boolean);
    if (entries.length !== 1 || entries[0] !== publication.artifactFileName) {
      unavailable('activation-provider-readback-conflict', list);
    }
    const readArgs = process.platform === 'win32'
      ? ['-xOf', archivePath, publication.artifactFileName]
      : ['-p', archivePath, publication.artifactFileName];
    const bytes = requireCommand(
      archiveTool, readArgs, temporaryRoot, 'activation-provider-readback-conflict'
    );
    let payload: unknown;
    try {
      payload = parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
        'activation-provider-readback-conflict');
    } catch {
      unavailable('activation-provider-readback-conflict', bytes);
    }
    return Object.freeze({ bytes, payload });
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) throw error;
    unavailable('activation-provider-readback-conflict', error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function allPublications(
  root: string,
  repository: string,
  pullRequestNumber: number
): readonly Readonly<{ publication: SecAgentOperationActivationPublicationV1; commentId: number }>[] {
  const inventory = listActivationComments(
    root, `/repos/${repository}/issues/${pullRequestNumber}/comments`
  );
  const result: Array<{ publication: SecAgentOperationActivationPublicationV1; commentId: number }> = [];
  for (const comment of inventory) {
    if (!comment.body.includes(SEC_AGENT_OPERATION_ACTIVATION_COMMENT_MARKER)) continue;
    if (!hostedPublisherMatches(comment)) continue;
    let publication: SecAgentOperationActivationPublicationV1 | null;
    try {
      publication = parseSecAgentOperationActivationPublicationCommentV1(comment.body);
    } catch {
      unavailable('activation-provider-readback-conflict', comment.body);
    }
    if (publication === null) continue;
    result.push(Object.freeze({ publication, commentId: comment.id }));
  }
  return Object.freeze(result);
}

function assertNoDuplicatePublicationIdentities(
  publications: readonly Readonly<{
    publication: SecAgentOperationActivationPublicationV1;
    commentId: number;
  }>[]
): void {
  const identities = new Set<string>();
  for (const entry of publications) {
    const identity = `${entry.publication.request.phase}:${entry.publication.request.requestOperationId}`;
    if (identities.has(identity)) unavailable('activation-provider-readback-conflict', identity);
    identities.add(identity);
  }
}

function validateArtifactPayload(
  root: string,
  repository: string,
  publication: SecAgentOperationActivationPublicationV1
): SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1 {
  const downloaded = downloadArtifactPayload(root, repository, publication);
  let payload: SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1;
  try {
    payload = publication.request.phase === 'prepare'
      ? parseSecAgentOperationActivationPreparationV1(downloaded.payload)
      : parseSecAgentOperationActivationReceiptV1(downloaded.payload);
  } catch {
    unavailable('activation-provider-readback-conflict', downloaded.bytes);
  }
  const payloadDigest = 'preparationDigest' in payload
    ? payload.preparationDigest
    : payload.activationDigest;
  if (!canonicalBytes(payload).equals(downloaded.bytes)
      || payloadDigest !== publication.payloadDigest
      || !canonicalEqual(payload.request, publication.request)
      || !canonicalEqual(payload.provider, publication.provider)) {
    unavailable('activation-provider-readback-conflict', downloaded.bytes);
  }
  return payload;
}

function writeHostedPayload(
  outputPath: string,
  value: SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1
): void {
  writeFileSync(path.resolve(outputPath), canonicalBytes(value), { flag: 'wx' });
}

function payloadDigest(
  value: SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1
): `sha256:${string}` {
  return 'preparationDigest' in value ? value.preparationDigest : value.activationDigest;
}

function rebindPayloadProvider(
  value: SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1,
  provider: SecAgentOperationActivationProviderV1
): SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1 {
  if (value.schema === 'sec-agent-operation-activation-preparation-v1') {
    const {
      schema: _schema,
      preparationDigest: _preparationDigest,
      provider: _provider,
      ...input
    } = value;
    return createSecAgentOperationActivationPreparationV1({ ...input, provider });
  }
  const {
    schema: _schema,
    activationDigest: _activationDigest,
    provider: _provider,
    ...input
  } = value;
  return createSecAgentOperationActivationReceiptV1({ ...input, provider });
}

function materializeOrReuseHostedPayload(
  runtimeRoot: string,
  repository: string,
  request: SecAgentOperationActivationRequestV1,
  outputPath: string,
  value: SecAgentOperationActivationPreparationV1 | SecAgentOperationActivationReceiptV1
): Readonly<{
  disposition: 'created' | 'existing';
  commentId: number | null;
  payloadDigest: `sha256:${string}`;
}> {
  const publications = allPublications(runtimeRoot, repository, request.pullRequestNumber);
  assertNoDuplicatePublicationIdentities(publications);
  const matching = publications.filter(({ publication }) => (
    publication.request.requestOperationId === request.requestOperationId
  ));
  if (matching.length > 1) unavailable('activation-provider-readback-conflict', request.requestOperationId);
  if (matching.length === 1) {
    const existing = matching[0]!;
    assertProviderLive(runtimeRoot, repository, existing.publication.provider);
    const payload = validateArtifactPayload(runtimeRoot, repository, existing.publication);
    const expected = rebindPayloadProvider(value, existing.publication.provider);
    if (!canonicalEqual(payload, expected)) {
      unavailable('activation-provider-readback-conflict', request.requestOperationId);
    }
    return Object.freeze({
      disposition: 'existing',
      commentId: existing.commentId,
      payloadDigest: payloadDigest(payload)
    });
  }
  writeHostedPayload(outputPath, value);
  return Object.freeze({
    disposition: 'created',
    commentId: null,
    payloadDigest: payloadDigest(value)
  });
}

function produceHosted(input: Readonly<{
  runtimeRoot: string;
  candidateRoot: string;
  requestPath: string;
  outputPath: string;
}>): Readonly<{
  disposition: 'created' | 'existing';
  commentId: number | null;
  phase: 'prepare' | 'finalize';
  payloadDigest: `sha256:${string}`;
  requestOperationId: `sha256:${string}`;
  artifactName: string;
}> {
  const runtimeRoot = repositoryRoot(input.runtimeRoot);
  const candidateRoot = repositoryRoot(input.candidateRoot);
  const requestBytes = readFileSync(path.resolve(input.requestPath));
  const request = parseSecAgentOperationActivationRequestV1(
    parseJson(decodeUtf8(requestBytes, 'activation-issuer-unavailable'), 'activation-issuer-unavailable')
  );
  const provider = providerFromEnvironment();
  assertCleanExactRoot(runtimeRoot, provider.workflowSha);
  assertCleanExactRoot(candidateRoot, request.expectedHeadSha);
  const decision = requireResolvedWorkDecision(runtimeRoot);
  assertRequestBindings(request, provider, decision, candidateRoot);
  const control = readCandidateControl(candidateRoot, request.expectedHeadSha, decision);
  if (request.manifestPath !== control.manifestPath || request.manifestDigest !== control.manifestDigest) {
    unavailable('activation-stale', 'request-manifest-binding-drift');
  }
  const binding = workBinding(decision, control.manifest, request.phase);
  const hostedHeadRef = process.env.SEC_ACTIVATION_HEAD_REF;
  if (hostedHeadRef === undefined) unavailable('activation-issuer-unavailable', 'SEC_ACTIVATION_HEAD_REF');
  const pullRequest = exactPullRequestEntry(decision, request, hostedHeadRef, candidateRoot);
  const records = changedRecordsBetween(candidateRoot, request.expectedBaseSha, request.expectedHeadSha);
  const paths = changedPaths(records);
  CodexDevelopmentAssertWorkPackageChangedRecords(control.manifest, records);
  observeOperationAuthorityOwners(
    candidateRoot, decision.exactMain, request.expectedHeadSha, control.manifest, paths
  );
  if (request.phase === 'prepare') {
    assertPreparationSelection(control, decision);
    assertPreparationProposal(records, control.manifest, control.manifestPath,
      control.manifestBytes, request.expectedBaseSha, request.expectedHeadSha, candidateRoot);
    const preparation = createSecAgentOperationActivationPreparationV1({
      request,
      repository: decision.repository,
      workId: binding.item.workId,
      currentSpecRef: binding.item.currentSpecRef,
      currentSpecRevision: binding.currentSpecRevision,
      trustedBaseSha: decision.exactMain,
      trustedBaseTreeSha: decision.exactMainTree,
      proposal: pullRequest,
      controlDigests: control.controlDigests,
      authorizedPaths: workPackageAuthorizedPaths(control.manifest),
      forbiddenPaths: workPackageForbiddenPaths(control.manifest),
      proposalChangedPaths: paths,
      operationId: secAgentOperationActivationOperationIdV1(request.requestOperationId),
      role: 'worker',
      operationKind: 'implement',
      availableCapabilities: ['git'],
      workDecisionReceiptDigest: decision.receiptDigest,
      workDecisionDecisionDigest: decision.decision.decisionDigest,
      provider
    });
    const publication = materializeOrReuseHostedPayload(
      runtimeRoot, decision.repository, request, input.outputPath, preparation
    );
    return Object.freeze({
      ...publication,
      phase: 'prepare',
      requestOperationId: request.requestOperationId,
      artifactName: secAgentOperationActivationArtifactNameV1('prepare', request.requestOperationId)
    });
  }
  if (request.preparationCommentId === null) unavailable('activation-stale', 'preparation-comment-id-missing');
  const maximalPreparation = resolveMaximalPreparationV1(
    runtimeRoot,
    candidateRoot,
    decision.repository,
    request.pullRequestNumber,
    request.expectedBaseSha,
    request.expectedHeadSha,
    control.manifestPath,
    control.manifestDigest
  );
  if (request.preparationCommentId !== maximalPreparation.commentId) {
    unavailable('activation-stale', 'caller-selected-PRE-is-not-unique-maximal-ancestor');
  }
  const preparation = maximalPreparation.preparation;
  if (!isGitAncestor(candidateRoot, preparation.proposal.headSha, request.expectedHeadSha)
      || preparation.request.pullRequestNumber !== request.pullRequestNumber
      || preparation.trustedBaseSha !== decision.exactMain
      || preparation.proposal.headRef !== pullRequest.headRef
      || preparation.proposal.manifestPath !== control.manifestPath
      || preparation.proposal.manifestDigest !== control.manifestDigest) {
    unavailable('activation-stale', 'PRE-FINAL-stable-binding-drift');
  }
  assertPreparationStillAuthorizesFinal(candidateRoot, decision, preparation, control, binding);
  const finalReceipt = createSecAgentOperationActivationReceiptV1({
    request,
    preparation,
    pullRequest,
    controlDigests: control.controlDigests,
    changedPaths: paths,
    workDecisionReceiptDigest: decision.receiptDigest,
    workDecisionDecisionDigest: decision.decision.decisionDigest,
    provider
  });
  const publication = materializeOrReuseHostedPayload(
    runtimeRoot, decision.repository, request, input.outputPath, finalReceipt
  );
  return Object.freeze({
    ...publication,
    phase: 'finalize',
    requestOperationId: request.requestOperationId,
    artifactName: secAgentOperationActivationArtifactNameV1('finalize', request.requestOperationId)
  });
}

function publishHosted(input: Readonly<{
  runtimeRoot: string;
  requestPath: string;
  payloadPath: string;
  artifactId: string;
  artifactDigest: `sha256:${string}`;
}>): Readonly<{
  commentId: number;
  publication: SecAgentOperationActivationPublicationV1;
}> {
  const runtimeRoot = repositoryRoot(input.runtimeRoot);
  const requestBytes = readFileSync(path.resolve(input.requestPath));
  const request = parseSecAgentOperationActivationRequestV1(
    parseJson(decodeUtf8(requestBytes, 'activation-issuer-unavailable'), 'activation-issuer-unavailable')
  );
  const provider = providerFromEnvironment();
  assertCleanExactRoot(runtimeRoot, provider.workflowSha);
  const bytes = readFileSync(path.resolve(input.payloadPath));
  const payload = request.phase === 'prepare'
    ? parseSecAgentOperationActivationPreparationV1(
        parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
          'activation-provider-readback-conflict')
      )
    : parseSecAgentOperationActivationReceiptV1(
        parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
          'activation-provider-readback-conflict')
      );
  if (!canonicalBytes(payload).equals(bytes) || !canonicalEqual(payload.request, request)
      || !canonicalEqual(payload.provider, provider)) {
    unavailable('activation-provider-readback-conflict', bytes);
  }
  const publication = createSecAgentOperationActivationPublicationV1({
    request,
    payloadDigest: 'preparationDigest' in payload ? payload.preparationDigest : payload.activationDigest,
    artifactId: input.artifactId,
    artifactName: secAgentOperationActivationArtifactNameV1(request.phase, request.requestOperationId),
    artifactFileName: SEC_AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE,
    artifactDigest: input.artifactDigest,
    provider
  });
  const repository = CodexDevelopmentParseCurrentStateSpecV1(decodeUtf8(
    readGitBlob(runtimeRoot, `${provider.workflowSha}:${CONTROL_PATHS.currentState}`).bytes,
    'activation-stale'
  )).resolver.repository;
  assertArtifactMetadata(runtimeRoot, repository, publication);
  const body = renderSecAgentOperationActivationPublicationCommentV1(publication);
  const response = command('gh', [
    'api', '--method', 'POST', `/repos/${repository}/issues/${request.pullRequestNumber}/comments`,
    '--input', '-'
  ], runtimeRoot, canonicalBytes({ body }));
  if (response.status !== 0) unavailable('activation-provider-unavailable', response.stderr);
  let created: IssueCommentRecord;
  try {
    created = issueCommentRecord(
      parseJson(decodeUtf8(response.stdout, 'activation-provider-readback-conflict'),
        'activation-provider-readback-conflict'),
      'Published Agent operation activation comment'
    );
  } catch {
    unavailable('activation-provider-readback-conflict', response.stdout);
  }
  if (created.body !== body || !hostedPublisherMatches(created)) {
    unavailable('activation-provider-readback-conflict', response.stdout);
  }
  const inventory = listActivationComments(
    runtimeRoot, `/repos/${repository}/issues/${request.pullRequestNumber}/comments`
  );
  const matches = inventory.filter((comment) => comment.id === created.id
    && comment.body === body && hostedPublisherMatches(comment));
  if (matches.length !== 1) {
    unavailable('activation-provider-readback-conflict', response.stdout);
  }
  return Object.freeze({
    commentId: created.id,
    publication
  });
}

interface SecResolvedAgentOperationActivationCommonV1 {
  readonly manifest: CodexDevelopmentWorkPackageManifest;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
  readonly manifestPath: string;
  readonly manifestRevision: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly authorityOwners: readonly SecOperationAuthorityOwnerObservationV1[];
}

export type SecResolvedAgentOperationActivationV1 =
  SecResolvedAgentOperationActivationCommonV1 & Readonly<
    | {
        phase: 'prepare';
        preparation: SecAgentOperationActivationPreparationV1;
        receipt: null;
        activationDigest: `sha256:${string}`;
      }
    | {
        phase: 'finalize';
        preparation: SecAgentOperationActivationPreparationV1;
        receipt: SecAgentOperationActivationReceiptV1;
        activationDigest: `sha256:${string}`;
      }
  >;

function resolveSecAgentOperationActivationUncheckedV1(
  runtimeRootInput: string,
  candidateRootInput: string
): SecResolvedAgentOperationActivationV1 {
  const runtimeRoot = repositoryRoot(runtimeRootInput);
  const candidateRoot = repositoryRoot(candidateRootInput);
  assertSameRepository(runtimeRoot, candidateRoot);
  assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
  const decision = requireResolvedWorkDecision(runtimeRoot);
  assertCleanExactRoot(runtimeRoot, decision.exactMain);
  const targetCandidate = gitHead(candidateRoot);
  const branch = gitBranch(candidateRoot);
  const entries = decision.registry.entries.filter((entry) => entry.source === 'open-pr'
    && entry.headSha === targetCandidate && entry.baseSha === decision.exactMain
    && entry.prNumber !== null && entry.headTreeSha !== null);
  if (entries.length !== 1 || entries[0]!.headTreeSha !== gitTree(candidateRoot, targetCandidate)) {
    unavailable('activation-receipt-absent', 'exact-open-pr-missing');
  }
  const entry = entries[0]!;
  const requestBinding = Object.freeze({
    pullRequestNumber: entry.prNumber!,
    expectedBaseSha: decision.exactMain,
    expectedHeadSha: targetCandidate,
    manifestPath: entry.manifestPath,
    manifestDigest: entry.manifestDigest
  });
  const publications = allPublications(runtimeRoot, decision.repository, entry.prNumber!);
  assertNoDuplicatePublicationIdentities(publications);
  const finals = publications.filter(({ publication }) => publication.request.phase === 'finalize'
    && publication.request.pullRequestNumber === requestBinding.pullRequestNumber
    && publication.request.expectedBaseSha === requestBinding.expectedBaseSha
    && publication.request.expectedHeadSha === requestBinding.expectedHeadSha
    && publication.request.manifestPath === requestBinding.manifestPath
    && publication.request.manifestDigest === requestBinding.manifestDigest);
  if (finals.length > 1) unavailable('activation-provider-readback-conflict', targetCandidate);
  if (finals.length === 0) {
    const preparations = publications.filter(({ publication }) => publication.request.phase === 'prepare'
      && publication.request.pullRequestNumber === requestBinding.pullRequestNumber
      && publication.request.expectedBaseSha === requestBinding.expectedBaseSha
      && publication.request.expectedHeadSha === requestBinding.expectedHeadSha
      && publication.request.manifestPath === requestBinding.manifestPath
      && publication.request.manifestDigest === requestBinding.manifestDigest);
    if (preparations.length === 0) unavailable('activation-receipt-absent', targetCandidate);
    if (preparations.length !== 1) unavailable('activation-provider-readback-conflict', targetCandidate);
    const preparationPublication = preparations[0]!;
    assertProviderLive(runtimeRoot, decision.repository, preparationPublication.publication.provider);
    const preparationPayload = validateArtifactPayload(
      runtimeRoot, decision.repository, preparationPublication.publication
    );
    if (preparationPayload.schema !== 'sec-agent-operation-activation-preparation-v1') {
      unavailable('activation-provider-readback-conflict', 'preparation-artifact-schema-drift');
    }
    const preparation = preparationPayload;
    const control = readCandidateControl(candidateRoot, targetCandidate, decision);
    const binding = workBinding(decision, control.manifest, 'prepare');
    const pullRequest = exactPullRequestEntry(decision, preparation.request, branch, candidateRoot);
    const records = changedRecordsBetween(candidateRoot, decision.exactMain, targetCandidate);
    const paths = changedPaths(records);
    CodexDevelopmentAssertWorkPackageChangedRecords(control.manifest, records);
    assertPreparationSelection(control, decision);
    assertPreparationProposal(records, control.manifest, control.manifestPath,
      control.manifestBytes, decision.exactMain, targetCandidate, candidateRoot);
    const authorityOwners = observeOperationAuthorityOwners(
      candidateRoot, decision.exactMain, targetCandidate, control.manifest, paths
    );
    const expected = createSecAgentOperationActivationPreparationV1({
      request: preparation.request,
      repository: decision.repository,
      workId: binding.item.workId,
      currentSpecRef: binding.item.currentSpecRef,
      currentSpecRevision: binding.currentSpecRevision,
      trustedBaseSha: decision.exactMain,
      trustedBaseTreeSha: decision.exactMainTree,
      proposal: pullRequest,
      controlDigests: control.controlDigests,
      authorizedPaths: workPackageAuthorizedPaths(control.manifest),
      forbiddenPaths: workPackageForbiddenPaths(control.manifest),
      proposalChangedPaths: paths,
      operationId: secAgentOperationActivationOperationIdV1(preparation.request.requestOperationId),
      role: 'worker',
      operationKind: 'implement',
      availableCapabilities: ['git'],
      workDecisionReceiptDigest: decision.receiptDigest,
      workDecisionDecisionDigest: decision.decision.decisionDigest,
      provider: preparation.provider
    });
    if (!canonicalEqual(expected, preparation)) {
      unavailable('activation-stale', 'PRE-consumer-whole-value-rederivation-drift');
    }
    return Object.freeze({
      phase: 'prepare',
      preparation,
      receipt: null,
      activationDigest: preparation.preparationDigest,
      manifest: control.manifest,
      runtimeRoot,
      candidateRoot,
      trustedRevision: decision.exactMain,
      targetCandidate,
      changedPaths: paths,
      manifestPath: control.manifestPath,
      manifestRevision: control.manifestRevision,
      manifestDigest: control.manifestDigest,
      authorityOwners
    });
  }
  const final = finals[0]!;
  assertProviderLive(runtimeRoot, decision.repository, final.publication.provider);
  const receiptPayload = validateArtifactPayload(runtimeRoot, decision.repository, final.publication);
  if (receiptPayload.schema !== 'sec-agent-operation-activation-receipt-v1') {
    unavailable('activation-provider-readback-conflict', 'final-artifact-schema-drift');
  }
  const receipt = receiptPayload;
  if (receipt.request.preparationCommentId === null) unavailable('activation-provider-readback-conflict');
  const maximalPreparation = resolveMaximalPreparationV1(
    runtimeRoot,
    candidateRoot,
    decision.repository,
    entry.prNumber!,
    decision.exactMain,
    targetCandidate,
    entry.manifestPath,
    entry.manifestDigest
  );
  if (receipt.request.preparationCommentId !== maximalPreparation.commentId) {
    unavailable('activation-stale', 'FINAL-consumer-PRE-is-not-unique-maximal-ancestor');
  }
  if (!canonicalEqual(maximalPreparation.preparation, receipt.preparation)) {
    unavailable('activation-provider-readback-conflict', 'PRE-FINAL-payload-drift');
  }
  const control = readCandidateControl(candidateRoot, targetCandidate, decision);
  const binding = workBinding(decision, control.manifest, 'finalize');
  const pullRequest = exactPullRequestEntry(decision, receipt.request, branch, candidateRoot);
  const records = changedRecordsBetween(candidateRoot, decision.exactMain, targetCandidate);
  const paths = changedPaths(records);
  CodexDevelopmentAssertWorkPackageChangedRecords(control.manifest, records);
  const authorityOwners = observeOperationAuthorityOwners(
    candidateRoot, decision.exactMain, targetCandidate, control.manifest, paths
  );
  if (branch !== pullRequest.headRef) {
    unavailable('activation-stale', 'consumer-whole-value-rederivation-drift');
  }
  assertPreparationStillAuthorizesFinal(
    candidateRoot,
    decision,
    receipt.preparation,
    control,
    binding
  );
  const expected = createSecAgentOperationActivationReceiptV1({
    request: receipt.request,
    preparation: receipt.preparation,
    pullRequest,
    controlDigests: control.controlDigests,
    changedPaths: paths,
    workDecisionReceiptDigest: decision.receiptDigest,
    workDecisionDecisionDigest: decision.decision.decisionDigest,
    provider: receipt.provider
  });
  if (!canonicalEqual(expected, receipt)) {
    unavailable('activation-stale', 'FINAL-consumer-whole-value-rederivation-drift');
  }
  return Object.freeze({
    phase: 'finalize',
    preparation: receipt.preparation,
    receipt,
    activationDigest: receipt.activationDigest,
    manifest: control.manifest,
    runtimeRoot,
    candidateRoot,
    trustedRevision: decision.exactMain,
    targetCandidate,
    changedPaths: paths,
    manifestPath: control.manifestPath,
    manifestRevision: control.manifestRevision,
    manifestDigest: control.manifestDigest,
    authorityOwners
  });
}

export function resolveSecAgentOperationActivationV1(
  runtimeRootInput: string,
  candidateRootInput: string
): SecResolvedAgentOperationActivationV1 {
  return guarded('activation-stale', () => resolveSecAgentOperationActivationUncheckedV1(
    runtimeRootInput,
    candidateRootInput
  ));
}

function dispatchRequest(
  runtimeRoot: string,
  repository: string,
  request: SecAgentOperationActivationRequestV1
): void {
  const payload = canonicalBytes({ event_type: SEC_AGENT_OPERATION_ACTIVATION_EVENT, client_payload: { payload: request } });
  requireCommand('gh', [
    'api', '--method', 'POST', `/repos/${repository}/dispatches`,
    '--input', '-'
  ], runtimeRoot, 'activation-provider-unavailable', payload);
}

function resolveMaximalPreparationV1(
  runtimeRoot: string,
  candidateRoot: string,
  repository: string,
  pullRequestNumber: number,
  exactBase: string,
  targetCandidate: string,
  manifestPath: string,
  manifestDigest: `sha256:${string}`
): Readonly<{
  commentId: number;
  preparation: SecAgentOperationActivationPreparationV1;
}> {
  const publications = allPublications(runtimeRoot, repository, pullRequestNumber);
  assertNoDuplicatePublicationIdentities(publications);
  const candidates = publications.filter(({ publication }) => {
    const request = publication.request;
    if (request.phase !== 'prepare' || request.pullRequestNumber !== pullRequestNumber
        || request.expectedBaseSha !== exactBase || request.expectedHeadSha === targetCandidate
        || request.manifestPath !== manifestPath || request.manifestDigest !== manifestDigest) {
      return false;
    }
    return isGitAncestor(candidateRoot, request.expectedHeadSha, targetCandidate);
  });
  if (candidates.length === 0) unavailable('activation-receipt-absent', targetCandidate);
  const maximal = candidates.filter((candidate) => !candidates.some((other) => (
    other !== candidate
    && isGitAncestor(
      candidateRoot,
      candidate.publication.request.expectedHeadSha,
      other.publication.request.expectedHeadSha
    )
  )));
  if (maximal.length !== 1) unavailable('activation-provider-readback-conflict', targetCandidate);
  const selected = maximal[0]!;
  assertProviderLive(runtimeRoot, repository, selected.publication.provider);
  const payload = validateArtifactPayload(runtimeRoot, repository, selected.publication);
  if (payload.schema !== 'sec-agent-operation-activation-preparation-v1') {
    unavailable('activation-provider-readback-conflict', 'preparation-artifact-schema-drift');
  }
  return Object.freeze({
    commentId: selected.commentId,
    preparation: payload
  });
}

function parseOptions(args: readonly string[]): Readonly<Record<string, string | true>> {
  const options: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith('--')) unavailable('activation-issuer-unavailable', argument);
    const key = argument.slice(2);
    if (key === 'json') {
      if (options[key] !== undefined) unavailable('activation-issuer-unavailable', argument);
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--') || options[key] !== undefined) {
      unavailable('activation-issuer-unavailable', argument);
    }
    options[key] = value;
    index += 1;
  }
  return Object.freeze(options);
}

function requiredOption(options: Readonly<Record<string, string | true>>, name: string): string {
  const value = options[name];
  if (typeof value !== 'string') unavailable('activation-issuer-unavailable', name);
  return value;
}

function assertExactOptionKeys(
  options: Readonly<Record<string, string | true>>,
  expected: readonly string[]
): void {
  const actual = Object.keys(options).sort(compareCodeUnits);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    unavailable('activation-issuer-unavailable', JSON.stringify(actual));
  }
}

async function main(): Promise<void> {
  const [subcommand, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (subcommand === 'request') {
    assertExactOptionKeys(options, [
      'phase', 'candidate-root',
      ...(options.json === true ? ['json'] : [])
    ]);
    const runtimeRoot = repositoryRoot(path.resolve(import.meta.dir, '../..'));
    const candidateRoot = repositoryRoot(requiredOption(options, 'candidate-root'));
    assertSameRepository(runtimeRoot, candidateRoot);
    assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
    gitBranch(candidateRoot);
    const phase = requiredOption(options, 'phase');
    if (phase !== 'prepare' && phase !== 'finalize') unavailable('activation-issuer-unavailable', phase);
    const decision = requireResolvedWorkDecision(runtimeRoot);
    assertCleanExactRoot(runtimeRoot, decision.exactMain);
    const targetCandidate = gitHead(candidateRoot);
    const entries = decision.registry.entries.filter((entry) => entry.source === 'open-pr'
      && entry.headSha === targetCandidate && entry.baseSha === decision.exactMain
      && entry.prNumber !== null && entry.headTreeSha !== null);
    if (entries.length !== 1 || entries[0]!.headTreeSha !== gitTree(candidateRoot, targetCandidate)) {
      unavailable('activation-stale', 'exact-open-pr-missing');
    }
    const entry = entries[0]!;
    const control = readCandidateControl(candidateRoot, targetCandidate, decision);
    if (entry.manifestPath !== control.manifestPath || entry.manifestDigest !== control.manifestDigest) {
      unavailable('activation-stale', 'registry-manifest-drift');
    }
    const request = createSecAgentOperationActivationRequestV1({
      phase,
      pullRequestNumber: entry.prNumber!,
      expectedBaseSha: decision.exactMain,
      expectedHeadSha: targetCandidate,
      manifestPath: control.manifestPath,
      manifestDigest: control.manifestDigest,
      preparationCommentId: phase === 'prepare'
        ? null
        : resolveMaximalPreparationV1(
            runtimeRoot,
            candidateRoot,
            decision.repository,
            entry.prNumber!,
            decision.exactMain,
            targetCandidate,
            control.manifestPath,
            control.manifestDigest
          ).commentId
    });
    dispatchRequest(runtimeRoot, decision.repository, request);
    process.stdout.write(`${JSON.stringify({
      status: 'dispatched',
      event: SEC_AGENT_OPERATION_ACTIVATION_EVENT,
      requestOperationId: request.requestOperationId
    }, null, options.json === true ? 2 : 0)}\n`);
    return;
  }
  if (subcommand === 'observe') {
    assertExactOptionKeys(options, [
      'candidate-root', 'request-id', ...(options.json === true ? ['json'] : [])
    ]);
    const runtimeRoot = repositoryRoot(path.resolve(import.meta.dir, '../..'));
    const candidateRoot = repositoryRoot(requiredOption(options, 'candidate-root'));
    assertSameRepository(runtimeRoot, candidateRoot);
    assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
    const decision = requireResolvedWorkDecision(runtimeRoot);
    assertCleanExactRoot(runtimeRoot, decision.exactMain);
    const targetCandidate = gitHead(candidateRoot);
    const entries = decision.registry.entries.filter((entry) => entry.source === 'open-pr'
      && entry.headSha === targetCandidate && entry.baseSha === decision.exactMain
      && entry.prNumber !== null && entry.headTreeSha !== null);
    if (entries.length !== 1 || entries[0]!.headTreeSha !== gitTree(candidateRoot, targetCandidate)) {
      unavailable('activation-stale', 'exact-open-pr-missing');
    }
    const requestId = requiredOption(options, 'request-id');
    if (!/^sha256:[0-9a-f]{64}$/u.test(requestId)) {
      unavailable('activation-issuer-unavailable', requestId);
    }
    const matches = allPublications(runtimeRoot, decision.repository, entries[0]!.prNumber!)
      .filter(({ publication }) => publication.request.requestOperationId === requestId);
    if (matches.length === 0) unavailable('activation-receipt-absent', requestId);
    if (matches.length !== 1) unavailable('activation-provider-readback-conflict', requestId);
    const match = matches[0]!;
    assertProviderLive(runtimeRoot, decision.repository, match.publication.provider);
    validateArtifactPayload(runtimeRoot, decision.repository, match.publication);
    process.stdout.write(`${JSON.stringify({
      status: 'observed',
      commentId: match.commentId,
      phase: match.publication.request.phase,
      requestOperationId: match.publication.request.requestOperationId,
      payloadDigest: match.publication.payloadDigest,
      publicationDigest: match.publication.publicationDigest
    }, null, options.json === true ? 2 : 0)}\n`);
    return;
  }
  if (subcommand === 'produce-hosted') {
    assertExactOptionKeys(options, ['runtime-root', 'candidate-root', 'request', 'output', 'json']);
    const result = produceHosted({
      runtimeRoot: requiredOption(options, 'runtime-root'),
      candidateRoot: requiredOption(options, 'candidate-root'),
      requestPath: requiredOption(options, 'request'),
      outputPath: requiredOption(options, 'output')
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (subcommand === 'publish-hosted') {
    assertExactOptionKeys(options, [
      'runtime-root', 'request', 'payload', 'artifact-id', 'artifact-digest', 'json'
    ]);
    const result = publishHosted({
      runtimeRoot: requiredOption(options, 'runtime-root'),
      requestPath: requiredOption(options, 'request'),
      payloadPath: requiredOption(options, 'payload'),
      artifactId: positiveId(requiredOption(options, 'artifact-id'), 'activation-issuer-unavailable'),
      artifactDigest: requiredOption(options, 'artifact-digest') as `sha256:${string}`
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  unavailable('activation-issuer-unavailable',
    'usage: request | observe | produce-hosted | publish-hosted');
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const blocked = error instanceof SecAgentOperationActivationUnavailableError
      ? error
      : new SecAgentOperationActivationUnavailableError(
          'activation-issuer-unavailable',
          error instanceof Error ? error.message : String(error)
        );
    console.error(JSON.stringify({
      schema: 'sec-agent-operation-activation-blocked-v1',
      status: 'blocked',
      reasonCode: blocked.reasonCode,
      blockerDigest: blocked.blockerDigest
    }));
    process.exitCode = 2;
  }
}
