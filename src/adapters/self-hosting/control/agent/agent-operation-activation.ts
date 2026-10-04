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
import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import { resolveAgentRuntimeRepositoryRoot } from './runtime-root.ts';
import { selectOperationAuthoritySourceRevision } from './skill.ts';

import { canonicalJson, compareCodeUnits, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { parseGitChangedRecordsOutput, type CodexDevelopmentGitChangedRecord } from '../../../verification/platform/test-impact/runtime/transition.ts';
import {
  hostedPublisherMatches,
  issueCommentRecord,
  type IssueCommentRecord
} from '../branch-lifecycle/branch-closeout-receipt.ts';
import {
  DOCUMENTATION_IDENTITY_PATH,
  documentationIdentityById,
  documentationIdentityByPath,
  parseDocumentationIdentityRegistry,
  type DocumentationIdentityRecord
} from '../documentation/active.ts';
import {
  assertControlPlaneBinding,
  assertStablePlanRollingBinding,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingMachineProjection,
  parseRollingPlan
} from '../documentation/document-control-plane-contract.ts';
import {
  assertMainHealthPublicationAuthorityStable,
  observeCanonicalMainHealthForPublication,
  withMainHealthGitHubReadSession
} from '../main-health/work-selection-main-health.ts';
import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageAcceptsObservedBase,
  CodexDevelopmentWorkPackageManifestDigest,
  type CodexDevelopmentWorkPackageManifest
} from '../task/contract/work-package.ts';
import {
  compileWorkRollingTopology,
  type RoadmapWorkCatalogItem,
  type WorkDecisionReceipt
} from '../work-selection/live-contract.ts';
import { observeWorkSelectionLive } from '../work-selection/runtime.ts';
import {
  assertAgentOperationActivationTestCensus,
  assertAgentOperationActivationWorkPackageCensus,
  isCanonicalAgentOperationActivationWorkPackagePath
} from './agent-operation-activation-census.ts';
import {
  AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE,
  AGENT_OPERATION_ACTIVATION_COMMENT_MARKER,
  AGENT_OPERATION_ACTIVATION_EVENT,
  AGENT_OPERATION_ACTIVATION_JOB_NAME,
  AGENT_OPERATION_ACTIVATION_STEP_NAME,
  AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME,
  AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH,
  agentOperationActivationArtifactName,
  agentOperationActivationOperationId,
  createAgentOperationActivationPreparation,
  createAgentOperationActivationProvider,
  createAgentOperationActivationPublication,
  createAgentOperationActivationReceipt,
  createAgentOperationActivationRequest,
  parseAgentOperationActivationPreparation,
  parseAgentOperationActivationPublicationComment,
  parseAgentOperationActivationReceipt,
  parseAgentOperationActivationRequest,
  renderAgentOperationActivationPublicationComment,
  type AgentOperationActivationPreparation,
  type AgentOperationActivationProvider,
  type AgentOperationActivationPublication,
  type AgentOperationActivationReceipt,
  type AgentOperationActivationRequest
} from './operation-activation.ts';

const CONTROL_PATHS = Object.freeze({
  currentState: 'config/repository/current-state.yaml',
  pointer: 'config/repository/active-work-package.md',
  rollingPlan: 'config/repository/rolling-plan.md'
});
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export const AGENT_OPERATION_ACTIVATION_REASON_CODES = Object.freeze([
  'activation-receipt-absent',
  'activation-stale',
  'activation-scope-conflict',
  'activation-issuer-unavailable',
  'activation-provider-unavailable',
  'activation-provider-readback-conflict'
] as const);
export type AgentOperationActivationReasonCode =
  typeof AGENT_OPERATION_ACTIVATION_REASON_CODES[number];

type CommandResult = Readonly<{
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}>;

export class AgentOperationActivationUnavailableError extends Error {
  readonly reasonCode: AgentOperationActivationReasonCode;
  readonly blockerDigest: `sha256:${string}`;

  constructor(reasonCode: AgentOperationActivationReasonCode, detail: string | Uint8Array = reasonCode) {
    super(`Agent operation activation is unavailable (${reasonCode}).`);
    this.name = 'AgentOperationActivationUnavailableError';
    this.reasonCode = reasonCode;
    this.blockerDigest = rawSha256(detail);
  }
}

function unavailable(
  reasonCode: AgentOperationActivationReasonCode,
  detail?: string | Uint8Array
): never {
  throw new AgentOperationActivationUnavailableError(reasonCode, detail);
}

function guarded<T>(
  reasonCode: AgentOperationActivationReasonCode,
  operation: () => T
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AgentOperationActivationUnavailableError) throw error;
    unavailable(reasonCode, error instanceof Error ? error.message : String(error));
  }
}

async function guardedAsync<T>(
  reasonCode: AgentOperationActivationReasonCode,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentOperationActivationUnavailableError) throw error;
    return unavailable(reasonCode, error instanceof Error ? error.message : String(error));
  }
}

function controlCliCommandId(executable: string): 'git' | 'gh' | null {
  const leaf = executable.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  if (leaf === 'git' || leaf === 'git.exe') return 'git';
  if (leaf === 'gh' || leaf === 'gh.exe') return 'gh';
  return null;
}

/**
 * The activation owner has not yet bound its synchronous Git reads and hosted
 * publication effect to opaque semantic operations. A physical executable
 * adoption receipt cannot fill that missing authority, so Windows remains
 * fail-closed before any child starts.
 * Archive tools (tar/unzip) and non-Windows commands deliberately remain on
 * their separate provider routes.
 */
function assertWindowsControlCliCommandAdmission(
  executable: string,
  args: readonly string[],
  cwd: string
): void {
  if (process.platform !== 'win32') return;
  const commandId = controlCliCommandId(executable);
  if (commandId === null) return;

  return unavailable('activation-provider-unavailable', JSON.stringify({
    commandId,
    status: 'unavailable',
    reason: 'semantic-session-unavailable',
    cwdDigest: sha256(path.resolve(cwd)),
    argumentCount: args.length
  }));
}

function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  input?: Uint8Array
): CommandResult {
  assertWindowsControlCliCommandAdmission(executable, args, cwd);
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
  reasonCode: AgentOperationActivationReasonCode,
  input?: Uint8Array
): Buffer {
  const result = command(executable, args, cwd, input);
  if (result.status !== 0) unavailable(reasonCode, Buffer.concat([result.stdout, result.stderr]));
  return result.stdout;
}

function decodeUtf8(value: Uint8Array, reasonCode: AgentOperationActivationReasonCode): string {
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
  reasonCode: AgentOperationActivationReasonCode,
  input?: Uint8Array
): string {
  return decodeUtf8(requireCommand(executable, args, cwd, reasonCode, input), reasonCode).trim();
}

function parseJson(source: string, reasonCode: AgentOperationActivationReasonCode): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    unavailable(reasonCode, source);
  }
}

function record(value: unknown, reasonCode: AgentOperationActivationReasonCode): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    unavailable(reasonCode, JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function gitSha(value: string, reasonCode: AgentOperationActivationReasonCode): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) unavailable(reasonCode, value);
  return value;
}

function positiveId(value: unknown, reasonCode: AgentOperationActivationReasonCode): string {
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
): CodexDevelopmentGitChangedRecord[] {
  return parseGitChangedRecordsOutput(requireCommand('git', [
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames',
    '--find-copies', '--diff-filter=ACDMRTUXB', baseRevision, targetRevision, '--'
  ], root, 'activation-scope-conflict'));
}

function changedPaths(records: readonly CodexDevelopmentGitChangedRecord[]): readonly string[] {
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
    '--', 'config/repository/work-packages'
  ], root, 'activation-scope-conflict');
  if (bytes.length === 0 || bytes.at(-1) !== 0) {
    unavailable('activation-scope-conflict', 'candidate-work-package-census-is-empty-or-unterminated');
  }
  const paths = decodeUtf8(bytes.subarray(0, -1), 'activation-scope-conflict')
    .split('\0')
    .sort(compareCodeUnits);
  if (paths.some((entry) => !isCanonicalAgentOperationActivationWorkPackagePath(entry))
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
    assertAgentOperationActivationWorkPackageCensus({
      selectedManifestPath: manifestPath,
      candidateEntries,
      defaultPackagePaths,
      ...(tracking === 'none' && candidatePackagePaths.length > 1
        ? {
            roadmapSource: decodeUtf8(
              readGitBlob(candidateRoot, `${proposalRevision}:config/repository/work-selection.md`).bytes,
              'activation-scope-conflict'
            )
          }
        : {})
    }));
}

export interface OperationAuthorityOwnerObservation {
  readonly id: string;
  readonly ref: string;
  readonly owner: string;
  readonly revision: string;
  readonly contentDigest: `sha256:${string}`;
  readonly projection: null;
}

/** Read-only owner facts; neither this observation nor its consumers grant Effect authority. */
export function observeOperationAuthorityOwners(
  candidateRoot: string,
  trustedRevision: string,
  targetCandidate: string,
  manifest: CodexDevelopmentWorkPackageManifest,
  paths: readonly string[]
): readonly OperationAuthorityOwnerObservation[] {
  if (manifest.authorityRefs === undefined) {
    unavailable('activation-scope-conflict', 'work-package-authority-refs-missing');
  }
  let records: readonly DocumentationIdentityRecord[];
  let identityBlob: ReturnType<typeof readGitBlob>;
  try {
    identityBlob = readGitBlob(
      candidateRoot,
      `${trustedRevision}:${DOCUMENTATION_IDENTITY_PATH}`
    );
    const registryBytes = identityBlob.bytes;
    const registry = parseDocumentationIdentityRegistry(
      decodeUtf8(registryBytes, 'activation-scope-conflict')
    );
    const owners = manifest.authorityRefs.map((documentId) => {
      const owner = documentationIdentityById(registry, documentId);
      if (owner === undefined) {
        unavailable('activation-scope-conflict', `unknown-document-authority:${documentId}`);
      }
      return owner;
    });
    const changedDocuments = paths.flatMap((repositoryPath) => {
      const record = documentationIdentityByPath(registry, repositoryPath);
      return record === undefined ? [] : [record];
    });
    const agents = documentationIdentityByPath(registry, 'AGENTS.md');
    if (agents === undefined) {
      unavailable('activation-scope-conflict', 'startup-document-owner-missing');
    }
    records = Object.freeze([agents, ...owners, ...changedDocuments]
      .filter((entry, index, values) => values.findIndex(
        ({ documentId }) => documentId === entry.documentId
      ) === index)
      .sort((left, right) => compareCodeUnits(left.documentId, right.documentId)));
  } catch (error) {
    if (error instanceof AgentOperationActivationUnavailableError) throw error;
    unavailable('activation-scope-conflict', error instanceof Error ? error.message : String(error));
  }
  return Object.freeze([Object.freeze({
    id: 'documentation-identity-registry',
    ref: DOCUMENTATION_IDENTITY_PATH,
    owner: 'documentation-identity',
    revision: identityBlob.oid,
    contentDigest: rawSha256(identityBlob.bytes),
    projection: null
  }), ...records.map((entry) => {
    const revision = selectOperationAuthoritySourceRevision({
      repositoryPath: entry.path, changedPaths: paths, trustedRevision, targetCandidate
    });
    const blob = readGitBlob(candidateRoot, `${revision}:${entry.path}`);
    return Object.freeze({
      id: entry.documentId,
      ref: entry.path,
      owner: entry.documentId,
      revision: blob.oid,
      contentDigest: rawSha256(blob.bytes),
      projection: null
    });
  })]);
}

async function requireResolvedWorkDecision(root: string): Promise<WorkDecisionReceipt> {
  try {
    const candidateHead = gitHead(root);
    const candidateState = parseCurrentStateSpec(decodeUtf8(
      readGitBlob(root, `${candidateHead}:${CONTROL_PATHS.currentState}`).bytes,
      'activation-stale'
    ));
    const exactMain = gitSha(
      textCommand('git', ['rev-parse', '--verify', candidateState.resolver.defaultRef], root,
        'activation-stale'),
      'activation-stale'
    );
    const exactMainTree = gitTree(root, exactMain);
    const trustedState = parseCurrentStateSpec(decodeUtf8(
      readGitBlob(root, `${exactMain}:${CONTROL_PATHS.currentState}`).bytes,
      'activation-stale'
    ));
    if (trustedState.resolver.repository !== candidateState.resolver.repository
        || trustedState.resolver.remote !== candidateState.resolver.remote
        || trustedState.resolver.defaultBranch !== candidateState.resolver.defaultBranch
        || trustedState.resolver.defaultRef !== candidateState.resolver.defaultRef) {
      unavailable('activation-stale', 'main-health-current-state-identity-drift');
    }
    return await withMainHealthGitHubReadSession({
      repositoryRoot: root,
      repository: trustedState.resolver.repository,
      operation: async () => {
        const snapshotInput = Object.freeze({
          repositoryRoot: root,
          repository: trustedState.resolver.repository,
          defaultBranch: trustedState.resolver.defaultBranch,
          mainSha: exactMain,
          mainTreeSha: exactMainTree
        });
        const first = await observeCanonicalMainHealthForPublication(snapshotInput);
        const second = await observeCanonicalMainHealthForPublication(snapshotInput);
        assertMainHealthPublicationAuthorityStable(first.authority, second.authority);
        if (first.stableDigest !== second.stableDigest) {
          unavailable('activation-stale', 'main-health-snapshot-drift');
        }
        if (second.repairDecision.routingState !== 'ordinary-only') {
          unavailable('activation-stale', JSON.stringify({
            routingState: second.repairDecision.routingState,
            stableDigest: second.stableDigest
          }));
        }
        const result = await observeWorkSelectionLive({
          cwd: root,
          exactMain,
          exactMainTree,
          mainHealthSnapshot: second.workSelectionSnapshot
        });
        if (result.status !== 'resolved') {
          unavailable('activation-stale', JSON.stringify({
            reasonCodes: result.reasonCodes,
            blockerRefsDigest: sha256(result.blockerRefs)
          }));
        }
        return result.receipt;
      }
    });
  } catch (error) {
    if (error instanceof AgentOperationActivationUnavailableError) throw error;
    unavailable('activation-stale', error instanceof Error ? error.message : String(error));
  }
}

function workBinding(
  receipt: WorkDecisionReceipt,
  manifest: CodexDevelopmentWorkPackageManifest,
  phase: 'prepare' | 'finalize'
): Readonly<{ item: RoadmapWorkCatalogItem; currentSpecRevision: `sha256:${string}` }> {
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
    '--literal-pathspecs', '-c', 'core.quotepath=false',
    'ls-tree', '-r', '-z', '--full-tree', revision, '--', ...manifest.tests
  ], candidateRoot, 'activation-stale');
  guarded('activation-stale', () => assertAgentOperationActivationTestCensus(manifest.tests, bytes));
}

function readCandidateControl(
  candidateRoot: string,
  revision: string,
  receipt: WorkDecisionReceipt
): CandidateControlSnapshot {
  const stateBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.currentState}`).bytes;
  const pointerBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.pointer}`).bytes;
  const rollingBytes = readGitBlob(candidateRoot, `${revision}:${CONTROL_PATHS.rollingPlan}`).bytes;
  const state = parseCurrentStateSpec(decodeUtf8(stateBytes, 'activation-stale'));
  const pointer = parseActivePointer(decodeUtf8(pointerBytes, 'activation-stale'));
  const rolling = parseRollingPlan(decodeUtf8(rollingBytes, 'activation-stale'));
  assertControlPlaneBinding({ spec: state, pointer });
  if (state.resolver.repository !== receipt.repository
      || state.resolver.defaultRef !== `refs/remotes/${state.resolver.remote}/${state.resolver.defaultBranch}`) {
    unavailable('activation-stale', 'candidate-current-state-identity-drift');
  }
  const manifestBlob = readGitBlob(candidateRoot, `${revision}:${pointer.manifest}`);
  const manifestBytes = manifestBlob.bytes;
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    decodeUtf8(manifestBytes, 'activation-stale'), pointer.manifest
  );
  assertManifestTestBlobsExist(candidateRoot, revision, manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;
  if (pointer.manifestDigest !== manifestDigest || rolling.activePackageId !== manifest.id
      || !CodexDevelopmentWorkPackageAcceptsObservedBase(manifest, receipt.exactMain)
      || gitObjectExists(candidateRoot, `${receipt.exactMain}:${pointer.manifest}`)) {
    unavailable('activation-stale', 'candidate-control-binding-invalid');
  }
  guarded('activation-stale', () => assertStablePlanRollingBinding({
    manifest,
    manifestPath: pointer.manifest,
    manifestDigest,
    projection: parseRollingMachineProjection(decodeUtf8(rollingBytes, 'activation-stale')),
    exactMain: receipt.exactMain,
    exactMainTree: receipt.exactMainTree
  }));
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
  decision: WorkDecisionReceipt
): void {
  const topology = guarded('activation-scope-conflict', () => compileWorkRollingTopology(decision));
  if (topology.activePackageId !== control.manifest.id
      || control.rollingTopology.activePackageId !== topology.activePackageId
      || !canonicalEqual(control.rollingTopology.candidatePackageIds, topology.candidatePackageIds)) {
    unavailable('activation-scope-conflict', 'candidate-rolling-topology-differs-from-work-decision');
  }
}

function exactPullRequestEntry(
  receipt: WorkDecisionReceipt,
  request: AgentOperationActivationRequest,
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
  request: AgentOperationActivationRequest,
  provider: AgentOperationActivationProvider,
  receipt: WorkDecisionReceipt,
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
  records: readonly CodexDevelopmentGitChangedRecord[],
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
  decision: WorkDecisionReceipt,
  preparation: AgentOperationActivationPreparation,
  finalControl: CandidateControlSnapshot,
  binding: ReturnType<typeof workBinding>
): void {
  assertFinalOperationBinding(decision, preparation, finalControl, binding);
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
  assertProposalReadback(proposalTree, proposalRecords, proposalControl, finalControl, preparation);
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
    if (error instanceof AgentOperationActivationUnavailableError) {
      unavailable('activation-provider-readback-conflict', bytes);
    }
    throw error;
  }
}

function providerFromEnvironment(): AgentOperationActivationProvider {
  const required = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value.length === 0) unavailable('activation-issuer-unavailable', name);
    return value;
  };
  return createAgentOperationActivationProvider({
    repositoryId: required('GITHUB_REPOSITORY_ID'),
    workflowPath: AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH,
    workflowRef: `${AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH}@${required('GITHUB_SHA')}`,
    workflowSha: required('GITHUB_SHA'),
    runId: required('GITHUB_RUN_ID'),
    runAttempt: Number(required('GITHUB_RUN_ATTEMPT')),
    eventName: 'repository_dispatch',
    jobName: AGENT_OPERATION_ACTIVATION_JOB_NAME,
    uploadStepName: AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME,
    publicationStepName: AGENT_OPERATION_ACTIVATION_STEP_NAME,
    actorLogin: required('SEC_ACTIVATION_ACTOR_LOGIN'),
    actorNodeId: required('SEC_ACTIVATION_ACTOR_NODE_ID'),
    actorPermission: required('SEC_ACTIVATION_ACTOR_PERMISSION') as 'admin' | 'maintain'
  });
}

function assertProviderLive(
  root: string,
  repository: string,
  provider: AgentOperationActivationProvider
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
  const role = normalizeGitHubRepositoryPermission(permission);
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
    if (error instanceof AgentOperationActivationUnavailableError) {
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
  publication: AgentOperationActivationPublication
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
  publication: AgentOperationActivationPublication
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
    if (error instanceof AgentOperationActivationUnavailableError) throw error;
    unavailable('activation-provider-readback-conflict', error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function allPublications(
  root: string,
  repository: string,
  pullRequestNumber: number
): readonly Readonly<{ publication: AgentOperationActivationPublication; commentId: number }>[] {
  const inventory = listActivationComments(
    root, `/repos/${repository}/issues/${pullRequestNumber}/comments`
  );
  const result: Array<{ publication: AgentOperationActivationPublication; commentId: number }> = [];
  for (const comment of inventory) {
    if (!comment.body.includes(AGENT_OPERATION_ACTIVATION_COMMENT_MARKER)) continue;
    if (!hostedPublisherMatches(comment)) continue;
    let publication: AgentOperationActivationPublication | null;
    try {
      publication = parseAgentOperationActivationPublicationComment(comment.body);
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
    publication: AgentOperationActivationPublication;
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
  publication: AgentOperationActivationPublication
): AgentOperationActivationPreparation | AgentOperationActivationReceipt {
  const downloaded = downloadArtifactPayload(root, repository, publication);
  let payload: AgentOperationActivationPreparation | AgentOperationActivationReceipt;
  try {
    payload = publication.request.phase === 'prepare'
      ? parseAgentOperationActivationPreparation(downloaded.payload)
      : parseAgentOperationActivationReceipt(downloaded.payload);
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
  value: AgentOperationActivationPreparation | AgentOperationActivationReceipt
): void {
  writeFileSync(path.resolve(outputPath), canonicalBytes(value), { flag: 'wx' });
}

function payloadDigest(
  value: AgentOperationActivationPreparation | AgentOperationActivationReceipt
): `sha256:${string}` {
  return 'preparationDigest' in value ? value.preparationDigest : value.activationDigest;
}

function rebindPayloadProvider(
  value: AgentOperationActivationPreparation | AgentOperationActivationReceipt,
  provider: AgentOperationActivationProvider
): AgentOperationActivationPreparation | AgentOperationActivationReceipt {
  if (value.schema === 'sec-agent-operation-activation-preparation-v2') {
    const {
      schema: _schema,
      preparationDigest: _preparationDigest,
      provider: _provider,
      ...input
    } = value;
    return createAgentOperationActivationPreparation({ ...input, provider });
  }
  const {
    schema: _schema,
    activationDigest: _activationDigest,
    provider: _provider,
    ...input
  } = value;
  return createAgentOperationActivationReceipt({ ...input, provider });
}




export interface AgentOperationActivationHostedValues {
  request: AgentOperationActivationRequest;
  provider: AgentOperationActivationProvider;
  decision: WorkDecisionReceipt;
  control: CandidateControlSnapshot;
  binding: ReturnType<typeof workBinding>;
  pullRequest: ReturnType<typeof exactPullRequestEntry>;
  records: ReturnType<typeof changedRecordsBetween>;
  preparation: AgentOperationActivationPreparation;
  receipt: AgentOperationActivationReceipt;
  publication: AgentOperationActivationPublication;
}

function assertFinalOperationBinding(
  decision: WorkDecisionReceipt, preparation: AgentOperationActivationPreparation,
  finalControl: CandidateControlSnapshot, binding: ReturnType<typeof workBinding>
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
}

function assertProposalReadback(
  proposalTree: string, proposalRecords: readonly CodexDevelopmentGitChangedRecord[],
  proposalControl: CandidateControlSnapshot, finalControl: CandidateControlSnapshot,
  preparation: AgentOperationActivationPreparation
): void {
  if (proposalTree !== preparation.proposal.headTreeSha
      || !canonicalEqual(changedPaths(proposalRecords), preparation.proposalChangedPaths)
      || proposalControl.manifestPath !== finalControl.manifestPath
      || proposalControl.manifestDigest !== finalControl.manifestDigest
      || !canonicalEqual(proposalControl.controlDigests, finalControl.controlDigests)) {
    unavailable('activation-stale', 'PRE-consumer-stable-fact-rederivation-drift');
  }
}

function publishActivationComment(
  runtimeRoot: string, repository: string, publication: AgentOperationActivationPublication
): Readonly<{ commentId: number; publication: AgentOperationActivationPublication }> {
  const body = renderAgentOperationActivationPublicationComment(publication);
const response = command('gh', [
    'api', '--method', 'POST', `/repos/${repository}/issues/${publication.request.pullRequestNumber}/comments`,
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
    runtimeRoot, `/repos/${repository}/issues/${publication.request.pullRequestNumber}/comments`
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

function readHostedActivationRequest(requestPath: string): AgentOperationActivationRequest {
  const bytes = readFileSync(path.resolve(requestPath));
  return parseAgentOperationActivationRequest(
    parseJson(decodeUtf8(bytes, 'activation-issuer-unavailable'), 'activation-issuer-unavailable')
  );
}

function readHostedPublicationPayload(
  payloadPath: string, request: AgentOperationActivationRequest, provider: AgentOperationActivationProvider
): AgentOperationActivationPreparation | AgentOperationActivationReceipt {
  const bytes = readFileSync(path.resolve(payloadPath));
const payload = request.phase === 'prepare'
    ? parseAgentOperationActivationPreparation(
        parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
          'activation-provider-readback-conflict')
      )
    : parseAgentOperationActivationReceipt(
        parseJson(decodeUtf8(bytes, 'activation-provider-readback-conflict'),
          'activation-provider-readback-conflict')
      );
if (!canonicalBytes(payload).equals(bytes) || !canonicalEqual(payload.request, request)
      || !canonicalEqual(payload.provider, provider)) {
    unavailable('activation-provider-readback-conflict', bytes);
  }
  return payload;
}

/** Each property exposes one original observation, predicate or effect. Pure
 * builders project existing contract inputs; they perform no reads or decisions. */
export function createAgentOperationActivationHostedStagePorts() {
  // This invocation's observations prevent callers from splitting the original
  // admission sequence. They are not Scope, Work, Review or publication authority.
  let request: AgentOperationActivationRequest | undefined;
  let provider: AgentOperationActivationProvider | undefined;
  let decision: WorkDecisionReceipt | undefined;
  let control: CandidateControlSnapshot | undefined;
  let binding: ReturnType<typeof workBinding> | undefined;
  let pullRequest: ReturnType<typeof exactPullRequestEntry> | undefined;
  let records: readonly CodexDevelopmentGitChangedRecord[] | undefined;
  let paths: readonly string[] | undefined;
  let requestBinding: Readonly<{ root: string; request: AgentOperationActivationRequest; provider: AgentOperationActivationProvider; decision: WorkDecisionReceipt }> | undefined;
  let changedRecordBinding: CandidateControlSnapshot | undefined;
  let owners: Readonly<{ root: string; decision: WorkDecisionReceipt; head: string; control: CandidateControlSnapshot; paths: readonly string[] }> | undefined;
  const selections = new WeakMap<CandidateControlSnapshot, WorkDecisionReceipt>();
  const proposals = new WeakMap<CandidateControlSnapshot, Readonly<{ records: readonly CodexDevelopmentGitChangedRecord[]; root: string; base: string; head: string }>>();
  let preparation: AgentOperationActivationPreparation | undefined;
  let finalBinding: Readonly<{ decision: WorkDecisionReceipt; preparation: AgentOperationActivationPreparation; control: CandidateControlSnapshot; binding: ReturnType<typeof workBinding> }> | undefined;
  let proposalReadback: Readonly<{ preparation: AgentOperationActivationPreparation; final: CandidateControlSnapshot; proposal: CandidateControlSnapshot }> | undefined;
  let payload: AgentOperationActivationPreparation | AgentOperationActivationReceipt | undefined;
  let publicationPayload: AgentOperationActivationPreparation | AgentOperationActivationReceipt | undefined;
  let publication: AgentOperationActivationPublication | undefined;
  let runtimeRoot: string | undefined;
  let publicationInventory: ReturnType<typeof allPublications> | undefined;
  let preparationSelection: Readonly<{
    inventory: ReturnType<typeof allPublications>; request: AgentOperationActivationRequest;
    control: CandidateControlSnapshot; candidateRoot: string;
    selected: ReturnType<typeof allPublications>[number];
    payload?: AgentOperationActivationPreparation;
  }> | undefined;
  const qualifiedPublications = new WeakSet<AgentOperationActivationPublication>();
  const liveProviders = new WeakMap<AgentOperationActivationProvider, Readonly<{ root: string; repository: string }>>();
  let artifactPayload: AgentOperationActivationPreparation | AgentOperationActivationReceipt | undefined;
  const observedControls = new WeakSet<CandidateControlSnapshot>();
  const issuedRecordInventories = new WeakSet<readonly CodexDevelopmentGitChangedRecord[]>();
  const observedTrees = new Map<string, string>();

  function requireObservation(condition: boolean): asserts condition {
    if (!condition) unavailable('activation-issuer-unavailable', 'hosted-stage-native-observation-binding-missing');
  }

  function assertProductionObservations(input: Readonly<{
    request: AgentOperationActivationRequest; provider: AgentOperationActivationProvider;
    decision: WorkDecisionReceipt; control: CandidateControlSnapshot;
    pullRequest: ReturnType<typeof exactPullRequestEntry>; paths: readonly string[];
    binding?: ReturnType<typeof workBinding>;
  }>): void {
    requireObservation(request !== undefined && provider !== undefined && decision !== undefined
      && control !== undefined && binding !== undefined && pullRequest !== undefined && records !== undefined
      && paths !== undefined && requestBinding !== undefined && owners !== undefined
      && input.request === request && input.provider === provider && input.decision === decision
      && input.control === control && input.pullRequest === pullRequest && input.paths === paths
      && requestBinding?.request === request && requestBinding.provider === provider
      && requestBinding.decision === decision && changedRecordBinding === control
      && owners?.root === requestBinding.root && owners.decision === decision
      && owners.head === request.expectedHeadSha && owners.control === control && owners.paths === paths
      && request.manifestPath === control.manifestPath && request.manifestDigest === control.manifestDigest
      && (input.request.phase !== 'prepare' || input.binding === binding));
    assertCleanExactRoot(requestBinding.root, request.expectedHeadSha);
  }

  return Object.freeze({
    repositoryRoot: (value: string): string => {
      const root = repositoryRoot(value);
      if (runtimeRoot === undefined) runtimeRoot = root;
      return root;
    },
    readRequest: (requestPath: string): AgentOperationActivationRequest => {
      requireObservation(request === undefined);
      request = readHostedActivationRequest(requestPath);
      return request;
    },
    provider: (): AgentOperationActivationProvider => {
      requireObservation(provider === undefined);
      provider = providerFromEnvironment();
      return provider;
    },
    assertCleanExactRoot,
    workDecision: async (root: string): Promise<WorkDecisionReceipt> => {
      requireObservation(decision === undefined && provider !== undefined);
      assertCleanExactRoot(root, provider.workflowSha);
      decision = await requireResolvedWorkDecision(root);
      return decision;
    },
    assertRequestBindings: (observedRequest: AgentOperationActivationRequest, observedProvider: AgentOperationActivationProvider,
      observedDecision: WorkDecisionReceipt, root: string): void => {
      requireObservation(request !== undefined && provider !== undefined && decision !== undefined
        && observedRequest === request && observedProvider === provider && observedDecision === decision);
      assertRequestBindings(observedRequest, observedProvider, observedDecision, root);
      requestBinding = Object.freeze({ root, request: observedRequest, provider: observedProvider, decision: observedDecision });
    },
    readControl: (root: string, revision: string, observedDecision: WorkDecisionReceipt): CandidateControlSnapshot => {
      requireObservation(requestBinding !== undefined && observedDecision === decision && root === requestBinding.root);
      const observed = readCandidateControl(root, revision, observedDecision);
      observedControls.add(observed);
      if (revision === request!.expectedHeadSha) {
        requireObservation(control === undefined);
        control = observed;
      }
      return observed;
    },
    workBinding: (observedDecision: WorkDecisionReceipt, observedControl: CandidateControlSnapshot, phase: 'prepare' | 'finalize') => {
      requireObservation(observedDecision === decision && observedControl === control && phase === request?.phase);
      binding = workBinding(observedDecision, observedControl.manifest, phase);
      return binding;
    },
    headRef: (): string => {
      const value = process.env.SEC_ACTIVATION_HEAD_REF;
      if (value === undefined) unavailable('activation-issuer-unavailable', 'SEC_ACTIVATION_HEAD_REF');
      return value;
    },
    pullRequest: (observedDecision: WorkDecisionReceipt, observedRequest: AgentOperationActivationRequest, headRef: string, root: string) => {
      requireObservation(observedDecision === decision && observedRequest === request && root === requestBinding?.root
        && headRef === process.env.SEC_ACTIVATION_HEAD_REF);
      pullRequest = exactPullRequestEntry(observedDecision, observedRequest, headRef, root);
      return pullRequest;
    },
    changedRecords: (root: string, base: string, head: string): ReturnType<typeof changedRecordsBetween> => {
      requireObservation(root === requestBinding?.root);
      const observed = changedRecordsBetween(root, base, head);
      issuedRecordInventories.add(observed);
      if (base === request?.expectedBaseSha && head === request.expectedHeadSha) records = observed;
      return observed;
    },
    changedPaths: (observedRecords: readonly CodexDevelopmentGitChangedRecord[]): readonly string[] => {
      const observed = changedPaths(observedRecords);
      if (observedRecords === records) paths = observed;
      return observed;
    },
    assertChangedRecords: (observedControl: CandidateControlSnapshot, observedRecords: readonly CodexDevelopmentGitChangedRecord[]): void => {
      requireObservation(observedControl === control && observedRecords === records);
      CodexDevelopmentAssertWorkPackageChangedRecords(observedControl.manifest, observedRecords);
      changedRecordBinding = observedControl;
    },
    observeOwners: (root: string, observedDecision: WorkDecisionReceipt, head: string, observedControl: CandidateControlSnapshot, observedPaths: readonly string[]): void => {
      requireObservation(root === requestBinding?.root && observedDecision === decision && head === request?.expectedHeadSha
        && observedControl === control && observedPaths === paths);
      observeOperationAuthorityOwners(root, observedDecision.exactMain, head, observedControl.manifest, observedPaths);
      owners = Object.freeze({ root, decision: observedDecision, head, control: observedControl, paths: observedPaths });
    },
    assertPreparationSelection: (observedControl: CandidateControlSnapshot, observedDecision: WorkDecisionReceipt): void => {
      requireObservation(observedDecision === decision && observedControls.has(observedControl));
      assertPreparationSelection(observedControl, observedDecision);
      selections.set(observedControl, observedDecision);
    },
    assertPreparationProposal: (observedRecords: readonly CodexDevelopmentGitChangedRecord[], observedControl: CandidateControlSnapshot, base: string, head: string, root: string): void => {
      requireObservation(root === requestBinding?.root && base === decision?.exactMain
        && observedControls.has(observedControl) && issuedRecordInventories.has(observedRecords));
      assertPreparationProposal(observedRecords, observedControl.manifest, observedControl.manifestPath, observedControl.manifestBytes, base, head, root);
      proposals.set(observedControl, Object.freeze({ records: observedRecords, root, base, head }));
    },
    createPreparation: (input: Readonly<{
      request: AgentOperationActivationRequest; provider: AgentOperationActivationProvider;
      decision: WorkDecisionReceipt; control: CandidateControlSnapshot;
      binding: ReturnType<typeof workBinding>; pullRequest: ReturnType<typeof exactPullRequestEntry>; paths: readonly string[];
    }>): AgentOperationActivationPreparation => {
      const { request, provider, decision, control, binding, pullRequest, paths } = input;
      assertProductionObservations(input);
      requireObservation(request.phase === 'prepare' && selections.get(control) === decision
        && proposals.get(control)?.records === records && proposals.get(control)?.head === request.expectedHeadSha);
      payload = createAgentOperationActivationPreparation({
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
      operationId: agentOperationActivationOperationId(request.requestOperationId),
      role: 'worker',
      operationKind: 'implement',
      workDecisionReceiptDigest: decision.receiptDigest,
      workDecisionDecisionDigest: decision.decision.decisionDigest,
      provider
    });
      return payload;
    },
    createReceipt: (input: Readonly<{
      request: AgentOperationActivationRequest; preparation: AgentOperationActivationPreparation;
      provider: AgentOperationActivationProvider; decision: WorkDecisionReceipt;
      control: CandidateControlSnapshot; pullRequest: ReturnType<typeof exactPullRequestEntry>; paths: readonly string[];
    }>): AgentOperationActivationReceipt => {
      const { request, preparation, provider, decision, control, pullRequest, paths } = input;
      assertProductionObservations(input);
      requireObservation(request.phase === 'finalize' && finalBinding?.decision === decision
        && preparationSelection?.request === request && preparationSelection.control === control
        && preparationSelection.candidateRoot === requestBinding?.root
        && preparationSelection.selected.commentId === request.preparationCommentId
        && preparationSelection.payload === preparation
        && finalBinding.preparation === preparation && finalBinding.control === control
        && proposalReadback?.preparation === preparation && proposalReadback.final === control
        && selections.get(proposalReadback.proposal) === decision && proposals.has(proposalReadback.proposal));
      payload = createAgentOperationActivationReceipt({
    request,
    preparation,
    pullRequest,
    controlDigests: control.controlDigests,
    changedPaths: paths,
    workDecisionReceiptDigest: decision.receiptDigest,
    workDecisionDecisionDigest: decision.decision.decisionDigest,
    provider
  });
      return payload;
    },
    publications: (root: string, repository: string, pr: number): ReturnType<typeof allPublications> => {
      requireObservation(root === runtimeRoot && decision !== undefined && repository === decision.repository
        && request !== undefined && pr === request.pullRequestNumber);
      publicationInventory = allPublications(root, repository, pr);
      return publicationInventory;
    },
    assertPublicationIdentities: (inventory: ReturnType<typeof allPublications>): void => {
      requireObservation(publicationInventory !== undefined && inventory === publicationInventory);
      assertNoDuplicatePublicationIdentities(inventory);
      for (const entry of inventory) qualifiedPublications.add(entry.publication);
    },
    selectPreparationAncestor: (inventory: ReturnType<typeof allPublications>, observedRequest: AgentOperationActivationRequest,
      observedControl: CandidateControlSnapshot): ReturnType<typeof allPublications>[number] => {
      requireObservation(request !== undefined && request.phase === 'finalize' && observedRequest === request
        && control !== undefined && observedControl === control && requestBinding !== undefined
        && publicationInventory !== undefined && inventory === publicationInventory
        && inventory.every(entry => qualifiedPublications.has(entry.publication)));
      const selected = selectMaximalPreparationPublication(inventory, requestBinding.root,
        request.pullRequestNumber, request.expectedBaseSha, request.expectedHeadSha,
        control.manifestPath, control.manifestDigest);
      if (request.preparationCommentId !== selected.commentId) {
        unavailable('activation-stale', 'caller-selected-PRE-is-not-unique-maximal-ancestor');
      }
      preparationSelection = Object.freeze({ inventory, request, control, candidateRoot: requestBinding.root, selected });
      return selected;
    },
    isAncestor: isGitAncestor,
    assertProviderLive: (root: string, repository: string, observedProvider: AgentOperationActivationProvider): void => {
      requireObservation(root === runtimeRoot && decision !== undefined && repository === decision.repository);
      assertProviderLive(root, repository, observedProvider);
      liveProviders.set(observedProvider, Object.freeze({ root, repository }));
    },
    artifactPayload: (root: string, repository: string, observedPublication: AgentOperationActivationPublication) => {
      requireObservation(qualifiedPublications.has(observedPublication)
        && liveProviders.get(observedPublication.provider)?.root === root
        && liveProviders.get(observedPublication.provider)?.repository === repository);
      artifactPayload = validateArtifactPayload(root, repository, observedPublication);
      if (preparationSelection?.selected.publication === observedPublication
        && artifactPayload.schema === 'sec-agent-operation-activation-preparation-v2') {
        preparationSelection = Object.freeze({ ...preparationSelection, payload: artifactPayload });
      }
      return artifactPayload;
    },
    preparationPayload: (observedPayload: AgentOperationActivationPreparation | AgentOperationActivationReceipt): AgentOperationActivationPreparation => {
      requireObservation(artifactPayload !== undefined && observedPayload === artifactPayload);
      requireObservation(preparationSelection !== undefined && preparationSelection.payload === observedPayload
        && preparationSelection.request === request && preparationSelection.selected.commentId === request?.preparationCommentId);
      if (observedPayload.schema !== 'sec-agent-operation-activation-preparation-v2') {
        unavailable('activation-provider-readback-conflict', 'preparation-artifact-schema-drift');
      }
      preparation = observedPayload;
      return observedPayload;
    },
    assertFinalOperationBinding: (observedDecision: WorkDecisionReceipt, observedPreparation: AgentOperationActivationPreparation,
      observedControl: CandidateControlSnapshot, observedBinding: ReturnType<typeof workBinding>): void => {
      requireObservation(observedDecision === decision && observedPreparation === preparation
        && observedControl === control && observedBinding === binding);
      assertFinalOperationBinding(observedDecision, observedPreparation, observedControl, observedBinding);
      finalBinding = Object.freeze({ decision: observedDecision, preparation: observedPreparation, control: observedControl, binding: observedBinding });
    },
    gitTree: (root: string, revision: string): string => {
      requireObservation(root === requestBinding?.root);
      const tree = gitTree(root, revision);
      observedTrees.set(revision, tree);
      return tree;
    },
    assertProposalReadback: (tree: string, observedRecords: readonly CodexDevelopmentGitChangedRecord[],
      proposalControl: CandidateControlSnapshot, finalControl: CandidateControlSnapshot,
      observedPreparation: AgentOperationActivationPreparation): void => {
      requireObservation(observedPreparation === preparation && finalControl === control
        && proposals.get(proposalControl)?.records === observedRecords && selections.get(proposalControl) === decision
        && tree === observedTrees.get(observedPreparation.proposal.headSha));
      assertProposalReadback(tree, observedRecords, proposalControl, finalControl, observedPreparation);
      proposalReadback = Object.freeze({ preparation: observedPreparation, final: finalControl, proposal: proposalControl });
    },
    rebindProvider: rebindPayloadProvider,
    equal: canonicalEqual,
    payloadDigest,
    writePayload: (outputPath: string, observedPayload: AgentOperationActivationPreparation | AgentOperationActivationReceipt): void => {
      requireObservation(observedPayload === payload && requestBinding !== undefined && provider !== undefined);
      assertCleanExactRoot(requestBinding.root, requestBinding.request.expectedHeadSha);
      requireObservation(canonicalEqual(providerFromEnvironment(), provider));
      writeHostedPayload(outputPath, observedPayload);
    },
    artifactName: agentOperationActivationArtifactName,
    readPublicationPayload: (payloadPath: string, observedRequest: AgentOperationActivationRequest,
      observedProvider: AgentOperationActivationProvider): AgentOperationActivationPreparation | AgentOperationActivationReceipt => {
      requireObservation(request !== undefined && provider !== undefined && observedRequest === request && observedProvider === provider);
      publicationPayload = readHostedPublicationPayload(payloadPath, observedRequest, observedProvider);
      return publicationPayload;
    },
    createPublication: (observedRequest: AgentOperationActivationRequest, payload: AgentOperationActivationPreparation | AgentOperationActivationReceipt,
      observedProvider: AgentOperationActivationProvider, artifactId: string, artifactDigest: `sha256:${string}`) => {
      requireObservation(request !== undefined && provider !== undefined && publicationPayload !== undefined
        && observedRequest === request && payload === publicationPayload && observedProvider === provider);
      publication = createAgentOperationActivationPublication({
        request: observedRequest, payloadDigest: payloadDigest(payload), artifactId: positiveId(artifactId, 'activation-issuer-unavailable'),
        artifactName: agentOperationActivationArtifactName(observedRequest.phase, observedRequest.requestOperationId),
        artifactFileName: AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE, artifactDigest, provider: observedProvider
      });
      return publication;
    },
    publicationRepository: (root: string, provider: AgentOperationActivationProvider): string =>
      parseCurrentStateSpec(decodeUtf8(readGitBlob(root, `${provider.workflowSha}:${CONTROL_PATHS.currentState}`).bytes, 'activation-stale')).resolver.repository,
    assertArtifactMetadata,
    publishComment: (root: string, repository: string, observedPublication: AgentOperationActivationPublication) => {
      requireObservation(root === runtimeRoot && observedPublication === publication && publicationPayload !== undefined
        && canonicalEqual(observedPublication.request, request) && canonicalEqual(observedPublication.provider, provider));
      const currentProvider = providerFromEnvironment();
      requireObservation(canonicalEqual(currentProvider, provider));
      assertCleanExactRoot(root, currentProvider.workflowSha);
      const currentRepository = parseCurrentStateSpec(decodeUtf8(
        readGitBlob(root, `${currentProvider.workflowSha}:${CONTROL_PATHS.currentState}`).bytes, 'activation-stale'
      )).resolver.repository;
      requireObservation(currentRepository === repository);
      assertArtifactMetadata(root, repository, observedPublication);
      return publishActivationComment(root, repository, observedPublication);
    },
    unavailable
  });
}


interface ResolvedAgentOperationActivationCommon {
  readonly manifest: CodexDevelopmentWorkPackageManifest;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
  readonly manifestPath: string;
  readonly manifestRevision: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly authorityOwners: readonly OperationAuthorityOwnerObservation[];
}

export type ResolvedAgentOperationActivation =
  ResolvedAgentOperationActivationCommon & Readonly<
    | {
        phase: 'prepare';
        preparation: AgentOperationActivationPreparation;
        receipt: null;
        activationDigest: `sha256:${string}`;
      }
    | {
        phase: 'finalize';
        preparation: AgentOperationActivationPreparation;
        receipt: AgentOperationActivationReceipt;
        activationDigest: `sha256:${string}`;
      }
  >;

async function resolveAgentOperationActivationUnchecked(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<ResolvedAgentOperationActivation> {
  const runtimeRoot = repositoryRoot(runtimeRootInput);
  const candidateRoot = repositoryRoot(candidateRootInput);
  assertSameRepository(runtimeRoot, candidateRoot);
  assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
  const decision = await requireResolvedWorkDecision(runtimeRoot);
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
    if (preparationPayload.schema !== 'sec-agent-operation-activation-preparation-v2') {
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
    const expected = createAgentOperationActivationPreparation({
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
      operationId: agentOperationActivationOperationId(preparation.request.requestOperationId),
      role: 'worker',
      operationKind: 'implement',
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
  if (receiptPayload.schema !== 'sec-agent-operation-activation-receipt-v2') {
    unavailable('activation-provider-readback-conflict', 'final-artifact-schema-drift');
  }
  const receipt = receiptPayload;
  if (receipt.request.preparationCommentId === null) unavailable('activation-provider-readback-conflict');
  const maximalPreparation = resolveMaximalPreparation(
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
  const expected = createAgentOperationActivationReceipt({
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

export async function resolveAgentOperationActivation(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<ResolvedAgentOperationActivation> {
  return guardedAsync('activation-stale', () => resolveAgentOperationActivationUnchecked(
    runtimeRootInput,
    candidateRootInput
  ));
}

function dispatchRequest(
  runtimeRoot: string,
  repository: string,
  request: AgentOperationActivationRequest
): void {
  const payload = canonicalBytes({ event_type: AGENT_OPERATION_ACTIVATION_EVENT, client_payload: { payload: request } });
  requireCommand('gh', [
    'api', '--method', 'POST', `/repos/${repository}/dispatches`,
    '--input', '-'
  ], runtimeRoot, 'activation-provider-unavailable', payload);
}

function selectMaximalPreparationPublication(
  publications: ReturnType<typeof allPublications>, candidateRoot: string,
  pullRequestNumber: number, exactBase: string, targetCandidate: string,
  manifestPath: string, manifestDigest: `sha256:${string}`
): ReturnType<typeof allPublications>[number] {
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
  return selected;
}

function resolveMaximalPreparation(
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
  preparation: AgentOperationActivationPreparation;
}> {
  const publications = allPublications(runtimeRoot, repository, pullRequestNumber);
  assertNoDuplicatePublicationIdentities(publications);
  const selected = selectMaximalPreparationPublication(
    publications, candidateRoot, pullRequestNumber, exactBase, targetCandidate, manifestPath, manifestDigest
  );
  assertProviderLive(runtimeRoot, repository, selected.publication.provider);
  const payload = validateArtifactPayload(runtimeRoot, repository, selected.publication);
  if (payload.schema !== 'sec-agent-operation-activation-preparation-v2') {
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
    const runtimeRoot = repositoryRoot(await resolveAgentRuntimeRepositoryRoot());
    const candidateRoot = repositoryRoot(requiredOption(options, 'candidate-root'));
    assertSameRepository(runtimeRoot, candidateRoot);
    assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
    gitBranch(candidateRoot);
    const phase = requiredOption(options, 'phase');
    if (phase !== 'prepare' && phase !== 'finalize') unavailable('activation-issuer-unavailable', phase);
    const decision = await requireResolvedWorkDecision(runtimeRoot);
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
    const request = createAgentOperationActivationRequest({
      phase,
      pullRequestNumber: entry.prNumber!,
      expectedBaseSha: decision.exactMain,
      expectedHeadSha: targetCandidate,
      manifestPath: control.manifestPath,
      manifestDigest: control.manifestDigest,
      preparationCommentId: phase === 'prepare'
        ? null
        : resolveMaximalPreparation(
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
      event: AGENT_OPERATION_ACTIVATION_EVENT,
      requestOperationId: request.requestOperationId
    }, null, options.json === true ? 2 : 0)}\n`);
    return;
  }
  if (subcommand === 'observe') {
    assertExactOptionKeys(options, [
      'candidate-root', 'request-id', ...(options.json === true ? ['json'] : [])
    ]);
    const runtimeRoot = repositoryRoot(await resolveAgentRuntimeRepositoryRoot());
    const candidateRoot = repositoryRoot(requiredOption(options, 'candidate-root'));
    assertSameRepository(runtimeRoot, candidateRoot);
    assertCleanExactRoot(candidateRoot, gitHead(candidateRoot));
    const decision = await requireResolvedWorkDecision(runtimeRoot);
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
  unavailable('activation-issuer-unavailable',
    'usage: request | observe');
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const blocked = error instanceof AgentOperationActivationUnavailableError
      ? error
      : new AgentOperationActivationUnavailableError(
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
