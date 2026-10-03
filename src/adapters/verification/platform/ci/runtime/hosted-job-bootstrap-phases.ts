/** Closed PRE/POST bridge. Candidate snapshots and artifact members are data, never imports. */
import { arch, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalEquals, rawSha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { settleResources } from '../../../../../execution/resource-settlement.ts';
import {
  assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape,
  getCiVerificationPerJobHostedJobPolicy
} from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin, type AuthenticatedGitHubJobOriginObservation
} from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  currentGitHubApiCapability, executeGitHubApiOperation, HostedArtifactProjectionDataError, inspectGitHubApiCapability,
  withGitHubApiVerificationSession, type GitHubApiCapability, type GitHubApiOperation
} from '../../../../providers/github-api/operation-session.ts';
import {
  createNoFollowDirectoryChain, inspectNoFollowDirectoryChain, PhysicalNoFollowError, publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile, retainNoFollowOrdinaryFile, scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { hostedJobRuntimeReceiptComplete, parseHostedJobRuntimeReceiptBytes } from '../contract/hosted-job-runtime.ts';
import {
  computeHostedBootstrapChecker, HOSTED_BOOTSTRAP_CHECKER_SOURCE, HOSTED_BOOTSTRAP_SUT_FILES,
  parseHostedBootstrapCheckerReceipt, reduceHostedBootstrapFinal,
  type HostedBootstrapPostData, type HostedBootstrapSubject
} from './hosted-bootstrap-checker.ts';
import { withHostedCandidateWorkspace } from './hosted-candidate-workspace.ts';

const WORKFLOW = '.github/workflows/trusted-bootstrap.yml';
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const MAX_BYTES = 8 * 1024 * 1024;
const TERMINAL_FAILURES = Object.freeze(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'] as const);
const PRE_MEMBERS = Object.freeze(['checker.mjs', 'pre-receipt.json', 'SHA256SUMS']);
const SUT_MEMBERS = Object.freeze([...HOSTED_BOOTSTRAP_SUT_FILES, 'SHA256SUMS', 'sut-receipt.json', 'hosted-job-runtime-receipt.json']);
export const HOSTED_BOOTSTRAP_PHASE_HANDLERS = Object.freeze({
  'checker-pre': Object.freeze(['checker-pre']), 'checker-post': Object.freeze(['checker-post'])
} as const);
export class HostedBootstrapEvidenceUnavailableError extends Error {
  readonly code = 'hosted-bootstrap-evidence-unavailable' as const;
  constructor(readonly reason: string) { super(`Trusted bootstrap evidence unavailable: ${reason}.`); this.name = 'HostedBootstrapEvidenceUnavailableError'; }
}
/** Only SUT-local data failures may preserve already authenticated PRE authority. */
class SutArtifactDataError extends Error {
  constructor(readonly status: 'unavailable' | 'invalid', readonly reason: string) { super(reason); }
}
function unavailable(reason: string): never { throw new HostedBootstrapEvidenceUnavailableError(reason); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable('response is not an object');
  return value as Record<string, unknown>;
}
function json(source: string): Record<string, unknown> { return object(parseExactJsonBytes(Buffer.from(source), 'Bootstrap native channel', { maximumInputBytes: MAX_BYTES, maximumDepth: 32 })); }
function id(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) unavailable('provider ID is invalid');
  return String(value);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || /[\u0000\r\n]/u.test(value)) unavailable('bounded text is invalid');
  return value;
}
function sha(value: unknown): string { const result = text(value); if (!/^[0-9a-f]{40}$/u.test(result)) unavailable('Git identity is invalid'); return result; }
function digest(value: unknown): `sha256:${string}` { const result = text(value); if (!/^sha256:[0-9a-f]{64}$/u.test(result)) unavailable('digest is invalid'); return result as `sha256:${string}`; }
function timestamp(value: unknown): number {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 1) unavailable('provider timestamp is invalid');
  return result;
}
function census(pages: readonly unknown[], field: 'jobs' | 'artifacts'): readonly Record<string, unknown>[] {
  if (pages.length < 1 || pages.length > 2) unavailable('census page bound');
  let total: number | undefined;
  const records: Record<string, unknown>[] = [];
  for (const value of pages) {
    const page = object(value);
    if (!Number.isSafeInteger(page.total_count) || Number(page.total_count) < 0 || Number(page.total_count) > 200
        || (total !== undefined && total !== page.total_count) || !Array.isArray(page[field]) || page[field].length > 100) unavailable('census changed or exceeded bounds');
    total = Number(page.total_count); records.push(...page[field].map(object));
  }
  if (records.length !== total || new Set(records.map(item => id(item.id))).size !== records.length) unavailable('incomplete or duplicated census');
  return records;
}
interface BootstrapRequest {
  readonly subject: HostedBootstrapSubject; readonly manifestPath: string; readonly manifestDigest: `sha256:${string}`;
  readonly pullRequest: number;
}
function request(needs: Record<string, unknown>): BootstrapRequest {
  const resolve = object(needs.resolve), outputs = object(resolve.outputs);
  if (resolve.result !== 'success') unavailable('original resolver did not succeed');
  const subject = Object.freeze({ baseSha: sha(outputs.base), baseTreeSha: sha(outputs['base-tree']), headSha: sha(outputs.head),
    headTreeSha: sha(outputs.tree), registryDigest: digest(outputs['registry-digest']) });
  const manifestPath = text(outputs.manifest), manifestDigest = digest(outputs['manifest-digest']);
  const pullText = text(outputs['pull-request']);
  if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)
      || !/^[1-9][0-9]*$/u.test(pullText) || !Number.isSafeInteger(Number(pullText))) unavailable('request manifest or PR is invalid');
  return Object.freeze({ subject, manifestPath, manifestDigest, pullRequest: Number(pullText) });
}
function readFile(filePath: string, maximum = MAX_BYTES): Buffer {
  const retained = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(filePath)), path.basename(filePath));
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  let bytes!: Buffer;
  try {
    if (retained.linkCount !== 1 || retained.size > maximum) unavailable('artifact member is not bounded single-link ordinary data');
    retained.assertCurrent(); bytes = Buffer.from(retained.readBytes()); retained.assertCurrent();
  } catch (error) { primary = { label: 'bootstrap-file-read', error }; }
  settleResources({ primary, cleanup: [{ label: 'bootstrap-file-handle', settle: () => retained.dispose() }] });
  return bytes;
}
function writeFile(parent: PhysicalDirectoryIdentity, name: string, bytes: Uint8Array): void {
  publishExclusiveDurableCanonicalFile({ parent, name, bytes,
    validate: observed => { if (!Buffer.from(observed).equals(bytes)) unavailable('durable output readback differs'); } });
}
function writeJson(parent: PhysicalDirectoryIdentity, name: string, value: unknown): void { writeFile(parent, name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`)); }
function writeSums(parent: PhysicalDirectoryIdentity, names: readonly string[]): void {
  writeFile(parent, 'SHA256SUMS', Buffer.from(`${names.map(name => `${rawSha256(readFile(path.join(parent.path, name))).slice(7)}  ${name}`).join('\n')}\n`));
}
function artifactName(slot: 'pre' | 'sut', subject: HostedBootstrapSubject, origin: AuthenticatedGitHubJobOriginObservation): string {
  return `trusted-bootstrap-${slot}-${subject.headSha}-run-${origin.runId}-attempt-${origin.runAttempt}`;
}

export interface HostedBootstrapProducerProjection {
  readonly artifactId: string; readonly archiveDigest: `sha256:${string}`; readonly artifactName: string;
  readonly jobId: string; readonly checkRunId: string; readonly jobResult: string; readonly phaseResult: string;
  readonly phaseStarted: number; readonly phaseCompleted: number; readonly originalDeadline: number;
}
/** Pure response validator only. No DTO is registered as transport authority. */
export function decodeHostedBootstrapProducer(input: Readonly<{
  origin: Pick<AuthenticatedGitHubJobOriginObservation, 'repository' | 'repositoryId' | 'runId' | 'runAttempt' | 'workflowSha'>;
  subject: HostedBootstrapSubject; slot: 'pre' | 'sut'; jobs: readonly unknown[]; artifacts: readonly unknown[];
  artifact: unknown; observedAtUnixMs: number;
}>): HostedBootstrapProducerProjection {
  const { origin, slot } = input;
  const jobId = slot === 'pre' ? 'checker-pre' : 'candidate-sut';
  const policy = getCiVerificationPerJobHostedJobPolicy(WORKFLOW, jobId)!;
  const phaseName = slot === 'pre' ? 'checker-pre' : 'execute-trusted-bootstrap-sut';
  const jobs = census(input.jobs, 'jobs').filter(job => job.name === policy.jobName);
  if (jobs.length !== 1) unavailable('producer job is ambiguous');
  const job = jobs[0]!;
  const checkRunPrefix = `https://api.github.com/repos/${origin.repository}/check-runs/`;
  const checkRunUrl = text(job.check_run_url);
  const checkRunId = checkRunUrl.startsWith(checkRunPrefix) ? checkRunUrl.slice(checkRunPrefix.length) : '';
  if (!/^[1-9][0-9]{0,19}$/u.test(checkRunId) || id(job.run_id) !== origin.runId
      || (job.run_attempt !== undefined && job.run_attempt !== origin.runAttempt) || job.head_sha !== origin.workflowSha
      || job.status !== 'completed' || (job.conclusion !== 'success' && (slot === 'pre' || !TERMINAL_FAILURES.some(result => result === job.conclusion)))
      || !canonicalEquals(job.labels, [policy.runnerLabel]) || !Array.isArray(job.steps)) unavailable('exact completed producer differs');
  const started = timestamp(job.started_at), completed = timestamp(job.completed_at), originalDeadline = started + policy.maximumJobDurationMs;
  if (completed < started || completed > originalDeadline || !Number.isSafeInteger(input.observedAtUnixMs)
      || input.observedAtUnixMs < completed) unavailable('producer lifetime differs');
  const steps = job.steps.map(object);
  if (steps.length > 100 || new Set(steps.map(step => step.number)).size !== steps.length) unavailable('step census is ambiguous');
  const step = (name: string, allowFailure = false) => {
    const matches = steps.filter(item => item.name === name);
    if (matches.length !== 1) unavailable('producer step is not unique');
    const value = matches[0]!;
    if (value.status !== 'completed' || (value.conclusion !== 'success' && (!allowFailure || !TERMINAL_FAILURES.some(result => result === value.conclusion)))
        || !Number.isSafeInteger(value.number) || Number(value.number) < 1) unavailable('producer step is not terminal');
    const start = timestamp(value.started_at), end = timestamp(value.completed_at);
    if (start < started || end < start || end > completed) unavailable('producer step time differs');
    return { number: Number(value.number), started: start, completed: end, result: String(value.conclusion) };
  };
  const phase = policy.stages.filter(stage => stage.kind === 'phase' && stage.phase === phaseName);
  if (phase.length !== 1 || phase[0]!.kind !== 'phase') unavailable('closed phase is absent');
  const uploads = policy.stages.filter(stage => stage.kind === 'upload' && stage.slot === slot && stage.producerStepId === phase[0]!.stepId);
  if (uploads.length !== 1) unavailable('closed upload is absent');
  let previous = { number: 0, completed: started };
  for (const name of ['Checkout exact trusted hosted launcher', 'Setup exact trusted bootstrap Bun',
    'Verify exact bootstrap Bun bytes', 'Install exact trusted launcher dependencies']) {
    const current = step(name);
    if (current.number <= previous.number || current.started < previous.completed) unavailable('bootstrap ordering differs');
    previous = current;
  }
  const launcher = step(phase[0]!.stepName, slot === 'sut'), upload = step(uploads[0]!.stepName);
  if (launcher.number <= previous.number || launcher.started < previous.completed || upload.number <= launcher.number
      || upload.started < launcher.completed || (job.conclusion === 'success' && launcher.result !== 'success')) unavailable('producer/upload ordering differs');
  const expectedName = `trusted-bootstrap-${slot}-${input.subject.headSha}-run-${origin.runId}-attempt-${origin.runAttempt}`;
  const artifact = object(input.artifact), run = object(artifact.workflow_run);
  const created = timestamp(artifact.created_at), updated = timestamp(artifact.updated_at);
  const archiveDigest = digest(artifact.digest);
  if (artifact.name !== expectedName || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes)
      || Number(artifact.size_in_bytes) < 1 || Number(artifact.size_in_bytes) > 32 * 1024 * 1024
      || id(run.id) !== origin.runId || id(run.repository_id) !== origin.repositoryId || id(run.head_repository_id) !== origin.repositoryId
      || run.head_sha !== origin.workflowSha || run.head_branch !== 'main' || created < upload.started || updated < created || updated > upload.completed) unavailable('artifact upload window or run differs');
  const matches = census(input.artifacts, 'artifacts').filter(item => item.name === expectedName);
  if (matches.length !== 1) unavailable('artifact name has absent or multiple writers');
  for (const key of ['id', 'name', 'digest', 'size_in_bytes', 'expired', 'created_at', 'updated_at', 'workflow_run']) {
    if (!canonicalEquals(matches[0]![key], artifact[key])) unavailable('artifact metadata readback differs');
  }
  return Object.freeze({ artifactId: id(artifact.id), artifactName: expectedName, archiveDigest, jobId: id(job.id), checkRunId,
    jobResult: String(job.conclusion), phaseResult: launcher.result, phaseStarted: launcher.started,
    phaseCompleted: launcher.completed, originalDeadline });
}

async function readCensus(capability: GitHubApiCapability, origin: AuthenticatedGitHubJobOriginObservation, field: 'jobs' | 'artifacts'): Promise<readonly unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const operation: GitHubApiOperation = field === 'jobs'
      ? { kind: 'verification-workflow-jobs', runId: origin.runId, runAttempt: origin.runAttempt, page }
      : { kind: 'verification-artifacts', runId: origin.runId, page };
    const value = await executeGitHubApiOperation(capability, operation); pages.push(value);
    const total = object(value).total_count;
    if (!Number.isSafeInteger(total) || Number(total) < 0 || Number(total) > 200) unavailable('census bound exceeded');
    if (Number(total) <= page * 100) { census(pages, field); return pages; }
  }
  unavailable('incomplete census');
}
async function sourceBlob(capability: GitHubApiCapability, ref: string, file: string): Promise<string> {
  const value = object(await executeGitHubApiOperation(capability, { kind: 'verification-blob', ref, path: file }));
  if (value.type !== 'file' || value.path !== file || value.encoding !== 'base64' || typeof value.content !== 'string'
      || value.content.length > 768 * 1024) unavailable('source blob is unavailable');
  const encoded = value.content.replace(/\n/gu, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || value.size !== bytes.length || bytes.length > 512 * 1024) unavailable('source blob bytes differ');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function assertSourceContext(origin: AuthenticatedGitHubJobOriginObservation, repositoryValue: unknown, branchValue: unknown, runValue: unknown): void {
  const repository = object(repositoryValue), branch = object(branchValue), commit = object(branch.commit), run = object(runValue), runRepository = object(run.repository);
  if (repository.full_name !== origin.repository || id(repository.id) !== origin.repositoryId || repository.default_branch !== 'main'
      || branch.name !== 'main' || commit.sha !== origin.workflowSha || origin.trustedSourceSha !== origin.workflowSha
      || object(object(commit.commit).tree).sha !== origin.trustedSourceTreeSha || id(run.id) !== origin.runId
      || run.run_attempt !== origin.runAttempt || run.path !== WORKFLOW || run.head_sha !== origin.workflowSha
      || run.head_branch !== 'main' || run.event !== 'repository_dispatch' || runRepository.full_name !== origin.repository
      || id(runRepository.id) !== origin.repositoryId || run.status !== 'in_progress' || run.conclusion !== null) unavailable('live source or exact run binding differs');
}
async function authenticateRequest(capability: GitHubApiCapability, origin: AuthenticatedGitHubJobOriginObservation, selected: BootstrapRequest): Promise<void> {
  const pull = object(await executeGitHubApiOperation(capability, { kind: 'pull', pullRequestNumber: selected.pullRequest }));
  const commit = object(await executeGitHubApiOperation(capability, { kind: 'git-commit', sha: selected.subject.headSha }));
  const base = object(pull.base), head = object(pull.head);
  if (pull.state !== 'open' || pull.draft !== false || base.sha !== selected.subject.baseSha || head.sha !== selected.subject.headSha
      || id(object(base.repo).id) !== origin.repositoryId || id(object(head.repo).id) !== origin.repositoryId
      || commit.sha !== selected.subject.headSha || object(commit.tree).sha !== selected.subject.headTreeSha
      || !Array.isArray(commit.parents) || commit.parents.length !== 1 || object(commit.parents[0]).sha !== selected.subject.baseSha) unavailable('exact request PR/commit differs');
  const locators = typeof pull.body === 'string' ? pull.body.replaceAll('\r\n', '\n').split('\n').filter(line => line.startsWith('Work-Package:')) : [];
  if (locators.length !== 1 || locators[0] !== `Work-Package: ${selected.manifestPath}`
      || rawSha256(await sourceBlob(capability, selected.subject.headSha, selected.manifestPath)) !== selected.manifestDigest) unavailable('exact request manifest differs');
}
/** Data-only member integrity check after the original API has authenticated producer transport. */
export function assertHostedBootstrapPreMembers(files: Readonly<Record<string, string>>, checkerSource: Uint8Array, subject: HostedBootstrapSubject): void {
  if (Object.keys(files).sort().join(',') !== [...PRE_MEMBERS].sort().join(',')
      || !Buffer.from(files['checker.mjs']!).equals(checkerSource)
      || files.SHA256SUMS !== `${rawSha256(checkerSource).slice(7)}  checker.mjs\n${rawSha256(files['pre-receipt.json']!).slice(7)}  pre-receipt.json\n`) unavailable('PRE member inventory differs');
  const parsed = parseHostedBootstrapCheckerReceipt(files['pre-receipt.json']!);
  if (parsed.phase !== 'pre' || parsed.checkerBaseSha !== subject.baseSha || parsed.baseTreeSha !== subject.baseTreeSha
      || parsed.candidateHeadSha !== subject.headSha || parsed.candidateTreeSha !== subject.headTreeSha
      || parsed.registryDigest !== subject.registryDigest || parsed.checkerProgramDigest !== rawSha256(checkerSource)) unavailable('PRE subject/source differs');
}
/** Pure sidecar binding; it consumes no authority and cannot authenticate its own expected DTO. */
export function decodeHostedBootstrapSutBinding(input: Readonly<{
  origin: Pick<AuthenticatedGitHubJobOriginObservation, 'repository' | 'repositoryId' | 'workflowSha' | 'trustedSourceSha'
    | 'trustedSourceTreeSha' | 'runId' | 'runAttempt' | 'workflowSourceDigest' | 'launcherSourceDigest'>;
  producer: HostedBootstrapProducerProjection; files: Readonly<Record<string, string>>;
}>): HostedBootstrapPostData['sutProblem'] {
  const { origin, producer, files } = input;
  if (typeof files['hosted-job-runtime-receipt.json'] !== 'string') return Object.freeze({ status: 'unavailable', reason: 'SUT runtime sidecar is absent' });
  let outer: ReturnType<typeof parseHostedJobRuntimeReceiptBytes>;
  let sutReceipt: Record<string, unknown>;
  try {
    outer = parseHostedJobRuntimeReceiptBytes(Buffer.from(files['hosted-job-runtime-receipt.json']!));
    sutReceipt = json(files['sut-receipt.json']!);
  } catch { return Object.freeze({ status: 'invalid', reason: 'SUT runtime or inner receipt data is invalid' }); }
  if (outer.origin.repository !== origin.repository || outer.origin.repositoryId !== origin.repositoryId
      || outer.origin.workflowPath !== WORKFLOW || outer.origin.workflowSha !== origin.workflowSha
      || outer.origin.trustedSourceSha !== origin.trustedSourceSha || outer.origin.trustedSourceTreeSha !== origin.trustedSourceTreeSha
      || outer.origin.runId !== origin.runId || outer.origin.runAttempt !== origin.runAttempt
      || outer.origin.policyJobId !== 'candidate-sut' || outer.origin.role !== 'sut'
      || outer.origin.jobId !== producer.jobId || outer.origin.checkRunId !== producer.checkRunId
      || outer.origin.originalDeadlineAtUnixMs !== producer.originalDeadline
      || outer.origin.workflowSourceDigest !== origin.workflowSourceDigest || outer.origin.launcherSourceDigest !== origin.launcherSourceDigest
      || outer.operation.phase !== 'execute-trusted-bootstrap-sut' || outer.operation.actionKey !== null
      || outer.operation.deadlineAtUnixMs > producer.originalDeadline
      || outer.execution.startedAtUnixMs === null || outer.execution.settledAtUnixMs === null
      || outer.execution.startedAtUnixMs < producer.phaseStarted || outer.execution.settledAtUnixMs > producer.phaseCompleted
      || outer.execution.outputDigest !== rawSha256(files['sut-receipt.json']!)
      || outer.execution.sandboxObservationDigest !== sutReceipt.receiptDigest) return Object.freeze({ status: 'invalid', reason: 'SUT original runtime observation differs' });
  if (sutReceipt.auxiliaryStatus === 'passed') {
    if (producer.jobResult !== 'success' || producer.phaseResult !== 'success' || outer.execution.exitCode !== 0) {
      return Object.freeze({ status: 'invalid', reason: 'SUT PASS conflicts with its actual producer outcome' });
    }
    if (!hostedJobRuntimeReceiptComplete(outer)) return Object.freeze({ status: 'unavailable', reason: 'SUT PASS lacks settled physical capability evidence' });
  }
  return undefined;
}
async function readPostData(originCapability: AuthenticatedGitHubJobOrigin, selected: BootstrapRequest, root: string,
  checkerSource: Buffer, steps: Record<string, unknown>): Promise<HostedBootstrapPostData> {
  const origin = assertAuthenticatedGitHubJobOriginCurrent(originCapability);
  return withGitHubApiVerificationSession({ repositoryRoot: origin.trustedDriverRoot, repository: origin.repository,
    effect: 'verification-read', deadlineAtUnixMs: origin.deadlineAtUnixMs, signal: getAuthenticatedGitHubJobOriginSignal(originCapability),
    operation: async capability => {
      const identity = inspectGitHubApiCapability(capability);
      if (identity.origin !== 'production' || identity.repository !== origin.repository || identity.effect !== 'verification-read'
          || currentGitHubApiCapability(origin.repository, 'verification-read') !== capability) unavailable('original production transport is absent');
      const repository = await executeGitHubApiOperation(capability, { kind: 'repository' });
      const branch = await executeGitHubApiOperation(capability, { kind: 'branch', branch: 'main' });
      const run = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: origin.runId });
      assertSourceContext(origin, repository, branch, run);
      const workflow = await sourceBlob(capability, origin.workflowSha, WORKFLOW);
      assertCiVerificationPerJobHostedWholeWorkflowShape(workflow);
      for (const job of ['checker-pre', 'candidate-sut', 'checker-post']) assertCiVerificationPerJobHostedWorkflowShape(workflow, job);
      const policy = getCiVerificationPerJobHostedJobPolicy(WORKFLOW, 'checker-post')!;
      if (policy.runtime.kind !== 'per-job-runtime' || rawSha256(workflow) !== origin.workflowSourceDigest
          || rawSha256(await sourceBlob(capability, origin.workflowSha, policy.runtime.launcherPath)) !== origin.launcherSourceDigest
          || !Buffer.from(await sourceBlob(capability, origin.workflowSha, HOSTED_BOOTSTRAP_CHECKER_SOURCE)).equals(checkerSource)) unavailable('loaded checker or launcher source differs');
      await authenticateRequest(capability, origin, selected);
      const jobs = await readCensus(capability, origin, 'jobs'), artifacts = await readCensus(capability, origin, 'artifacts');
      const readSlot = async (slot: 'pre' | 'sut', members: readonly string[]) => {
        const name = artifactName(slot, selected.subject, origin);
        const found = census(artifacts, 'artifacts').filter(item => item.name === name);
        if (found.length !== 1) {
          if (slot === 'sut') throw new SutArtifactDataError(found.length === 0 ? 'unavailable' : 'invalid', 'unique SUT artifact is absent or duplicated');
          unavailable('unique PRE artifact is absent');
        }
        const artifact = await executeGitHubApiOperation(capability, { kind: 'verification-artifact', artifactId: id(found[0]!.id) });
        let producer: HostedBootstrapProducerProjection;
        try { producer = decodeHostedBootstrapProducer({ origin, subject: selected.subject, slot, jobs, artifacts, artifact, observedAtUnixMs: Date.now() }); }
        catch (error) {
          if (slot === 'sut' && error instanceof HostedBootstrapEvidenceUnavailableError) throw new SutArtifactDataError('invalid', error.reason);
          throw error;
        }
        let projected: unknown;
        try {
          projected = await executeGitHubApiOperation(capability, { kind: 'verification-artifact-members',
            artifactId: producer.artifactId, artifactName: name, runId: origin.runId,
            archiveDigest: producer.archiveDigest, projection: slot === 'pre' ? 'bootstrap-pre' : 'bootstrap-sut' });
        } catch (error) {
          if (slot === 'sut' && error instanceof HostedArtifactProjectionDataError) {
            throw new SutArtifactDataError(error.status, 'SUT artifact closed member projection is unavailable or invalid');
          }
          throw error;
        }
        const record = object(projected);
        if (Object.keys(record).sort().join(',') !== [...members].sort().join(',')) {
          if (slot === 'sut') throw new SutArtifactDataError('invalid', 'SUT archive member projection differs');
          unavailable('PRE archive member projection differs');
        }
        const files: Record<string, string> = {};
        for (const fileName of members) {
          const value = record[fileName];
          if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) {
            if (slot === 'sut') throw new SutArtifactDataError('invalid', 'SUT archive member data is invalid');
            unavailable('exact PRE archive member is unavailable');
          }
          let downloaded: Buffer;
          try { downloaded = readFile(path.join(root, 'in', slot, fileName)); }
          catch (error) {
            if (slot === 'sut' && error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
              throw new SutArtifactDataError('unavailable', 'downloaded SUT member is absent');
            }
            throw error;
          }
          if (!downloaded.equals(Buffer.from(value))) {
            if (slot === 'sut') throw new SutArtifactDataError('invalid', 'downloaded member differs from authenticated archive');
            unavailable('downloaded PRE member differs from authenticated archive');
          }
          files[fileName] = value;
        }
        return { producer, files: Object.freeze(files) };
      };
      if (object(steps['download-pre']).outcome !== 'success') unavailable('original PRE download did not succeed');
      const pre = await readSlot('pre', PRE_MEMBERS);
      assertHostedBootstrapPreMembers(pre.files, checkerSource, selected.subject);
      const sutJobs = census(jobs, 'jobs').filter(job => job.name === getCiVerificationPerJobHostedJobPolicy(WORKFLOW, 'candidate-sut')!.jobName);
      if (sutJobs.length !== 1 || sutJobs[0]!.status !== 'completed'
          || !['success', 'skipped', ...TERMINAL_FAILURES].includes(String(sutJobs[0]!.conclusion))) unavailable('SUT terminal result is unavailable');
      const sutJobResult = String(sutJobs[0]!.conclusion);
      let sutFiles: Readonly<Record<string, string>> | null = null;
      let sutDownloadOutcome = typeof steps['download-sut'] === 'object' && steps['download-sut'] !== null ? String(object(steps['download-sut']).outcome) : 'skipped';
      let sutProblem: HostedBootstrapPostData['sutProblem'];
      if (sutDownloadOutcome === 'success') {
        try {
          const sut = await readSlot('sut', SUT_MEMBERS);
          sutProblem = decodeHostedBootstrapSutBinding({ origin, producer: sut.producer, files: sut.files });
          sutFiles = sut.files;
        } catch (error) {
          if (!(error instanceof SutArtifactDataError)) throw error;
          sutProblem = Object.freeze({ status: error.status, reason: error.reason });
        }
      }
      const finalRun = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: origin.runId });
      const finalBranch = await executeGitHubApiOperation(capability, { kind: 'branch', branch: 'main' });
      assertSourceContext(origin, repository, finalBranch, finalRun);
      if (currentGitHubApiCapability(origin.repository, 'verification-read') !== capability) unavailable('original API session is no longer current');
      assertAuthenticatedGitHubJobOriginCurrent(originCapability);
      return Object.freeze({ preSource: pre.files['pre-receipt.json']!, sutJobResult, sutDownloadOutcome, sutFiles, sutProblem });
    } });
}

export async function executeHostedBootstrapPhase(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; jobId: string; phase: string;
  nativeChannels: Readonly<{ runnerTemp: string; needsJson: string; stepsJson: string }>;
}>): Promise<Readonly<{ outputs: Readonly<Record<string, string>>; exitCode: 0 | 1; diagnostic: string | null; failure: Readonly<{ error: unknown }> | null }>> {
  const origin = input.origin;
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  input = Object.freeze({ origin, jobId: input.jobId, phase: input.phase,
    nativeChannels: Object.freeze({ runnerTemp: input.nativeChannels.runnerTemp,
      needsJson: input.nativeChannels.needsJson, stepsJson: input.nativeChannels.stepsJson }) });
  if (input.nativeChannels.runnerTemp !== process.env.RUNNER_TEMP
      || input.nativeChannels.needsJson !== process.env.SEC_HOSTED_NEEDS_JSON
      || input.nativeChannels.stepsJson !== process.env.SEC_HOSTED_STEPS_JSON) unavailable('native channels differ from the executing job');
  const phase = input.jobId === 'checker-pre' && input.phase === 'checker-pre' ? 'pre'
    : input.jobId === 'checker-post' && input.phase === 'checker-post' ? 'post' : null;
  if (phase === null || observed.workflowPath !== WORKFLOW || observed.role !== 'trusted'
      || observed.policyJobId !== input.jobId || observed.phase !== input.phase || observed.trustedDriverRoot !== SOURCE_ROOT) unavailable('genuine executing checker phase is absent');
  const selected = request(json(input.nativeChannels.needsJson)), steps = json(input.nativeChannels.stepsJson);
  if (selected.subject.baseSha !== observed.trustedSourceSha || selected.subject.baseTreeSha !== observed.trustedSourceTreeSha) unavailable('request base differs from loaded source');
  const runnerTemp = text(input.nativeChannels.runnerTemp);
  if (!path.isAbsolute(runnerTemp) || path.normalize(runnerTemp) !== runnerTemp) unavailable('native temporary root is not canonical');
  const root = path.join(runnerTemp, 'sec-hosted-job', input.jobId), slot = phase === 'pre' ? 'pre' : 'bootstrap';
  const output = createNoFollowDirectoryChain(inspectNoFollowDirectoryChain(runnerTemp).target, ['sec-hosted-job', input.jobId, 'out', slot]);
  const metadataBudget = { maximumEntries: 32, deadlineAtMs: performance.now() + observed.deadlineAtUnixMs - Date.now(), signal: getAuthenticatedGitHubJobOriginSignal(input.origin) };
  if (scanNoFollowDirectoryDirectMetadata(output, metadataBudget).length !== 0) unavailable('existing phase output is preserved for its original owner');
  const checkerSource = readFile(path.join(observed.trustedDriverRoot, HOSTED_BOOTSTRAP_CHECKER_SOURCE));
  const finalSemantic = { schema: 'sec-trusted-bootstrap-final-evidence-v1', baseSha: selected.subject.baseSha,
    baseTreeSha: selected.subject.baseTreeSha, headSha: selected.subject.headSha, treeSha: selected.subject.headTreeSha,
    runId: observed.runId, runAttempt: String(observed.runAttempt), status: 'incomplete', reason: 'checker-post-not-complete' };
  const finalValue = { ...finalSemantic, receiptDigest: rawSha256(JSON.stringify(finalSemantic)) };
  if (phase === 'post') writeJson(output, 'final-envelope.json', finalValue);
  let exitCode: 0 | 1 = 1;
  let diagnostic: string | null = null;
  let failure: Readonly<{ error: unknown }> | null = null;
  let gitVersion: string | null = null;
  let sutJobResult: string | null = null;
  try {
    const post = phase === 'post' ? await readPostData(input.origin, selected, root, checkerSource, steps) : undefined;
    const computed = await withHostedCandidateWorkspace({ origin: input.origin, subject: selected.subject, purpose: 'bootstrap-checker' }, async workspace => {
      await workspace.assertCurrent();
      const value = await computeHostedBootstrapChecker({ subject: selected.subject, phase, baseRoot: workspace.baseRoot,
        candidateRoot: workspace.candidateRoot, checkerSource, deadlineAtUnixMs: workspace.identity.deadlineAtUnixMs,
        signal: getAuthenticatedGitHubJobOriginSignal(input.origin), post });
      await workspace.assertCurrent(); return value;
    });
    assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    gitVersion = computed.gitVersion;
    sutJobResult = post?.sutJobResult ?? null;
    if (phase === 'pre') {
      writeFile(output, 'checker.mjs', checkerSource); // Inert source member retained for artifact compatibility; never imported.
      writeJson(output, 'pre-receipt.json', computed.receipt); writeSums(output, ['checker.mjs', 'pre-receipt.json']); exitCode = 0;
    } else {
      writeJson(output, 'post-receipt.json', computed.receipt);
      writeFile(output, 'pre-receipt.json', Buffer.from(post!.preSource)); writeJson(output, 'sut-diagnostic.json', computed.diagnostic);
      const status = reduceHostedBootstrapFinal(computed.receipt), final = { ...finalSemantic, ...status };
      const previous = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(output.path), 'final-envelope.json');
      let physical: typeof previous.physical | undefined;
      const expectedExistingBytes = Buffer.from(`${JSON.stringify(finalValue, null, 2)}\n`);
      let primary: Readonly<{ label: string; error: unknown }> | undefined;
      try {
        previous.assertCurrent();
        if (previous.linkCount !== 1 || !Buffer.from(previous.readBytes()).equals(expectedExistingBytes)) unavailable('initial final envelope changed');
        physical = previous.physical;
      } catch (error) { primary = { label: 'bootstrap-final-envelope-preimage', error }; }
      settleResources({ primary, cleanup: [{ label: 'bootstrap-final-envelope-handle', settle: () => previous.dispose() }] });
      const bytes = Buffer.from(`${JSON.stringify({ ...final, receiptDigest: rawSha256(JSON.stringify(final)) }, null, 2)}\n`);
      replaceDurableCanonicalFile({ parent: output, name: 'final-envelope.json', bytes, expectedExisting: physical!, expectedExistingBytes,
        rejectExistingHardLinks: true, validate: value => { if (!Buffer.from(value).equals(bytes)) unavailable('final envelope readback differs'); } });
      exitCode = status.status === 'passed' ? 0 : 1;
    }
  } catch (error) {
    if (phase === 'pre') throw error;
    // Original incomplete envelope remains publishable; transport failure is not candidate failure.
    failure = Object.freeze({ error });
    diagnostic = error instanceof HostedBootstrapEvidenceUnavailableError ? error.reason : 'checker-post-not-complete';
    // Preserve the original resource owner's composite failure and recovery
    // locator. The launcher publishes ready outputs, then rethrows this exact
    // object; unavailable/unknown cleanup is never reduced to candidate FAIL.
  }
  let ready = false;
  try {
    settleResources({ primary: failure === null ? undefined : { label: 'bootstrap-checker-phase', error: failure.error },
      cleanup: [{ label: 'bootstrap-final-evidence-publication', settle: () => {
        assertAuthenticatedGitHubJobOriginCurrent(input.origin);
        if (phase === 'post') {
          const environment = `schema=sec-trusted-bootstrap-environment-v1\nbase=${selected.subject.baseSha}\nbaseTree=${selected.subject.baseTreeSha}\nhead=${selected.subject.headSha}\ntree=${selected.subject.headTreeSha}\nregistryDigest=${selected.subject.registryDigest}\nmanifestDigest=${selected.manifestDigest}\nsutJobResult=${sutJobResult ?? 'unavailable'}\nbun=${Bun.version} ${observed.driverBunExecutableDigest}\ngit=${gitVersion ?? 'unavailable'}\nos=${platform()} ${release()} ${arch()}\n`;
          writeFile(output, 'environment.txt', Buffer.from(environment));
          const members = scanNoFollowDirectoryDirectMetadata(output, metadataBudget).map(entry => entry.relativePath).sort();
          writeSums(output, members);
        }
        ready = true;
      } }] });
  } catch (error) { failure = Object.freeze({ error }); }
  const name = phase === 'pre' ? artifactName('pre', selected.subject, observed)
    : `trusted-bootstrap-v1-pr-${selected.pullRequest}-base-${selected.subject.baseSha}-head-${selected.subject.headSha}-run-${observed.runId}-attempt-${observed.runAttempt}`;
  return Object.freeze({ outputs: Object.freeze({ [`${slot}-artifact-name`]: name, [`${slot}-ready`]: ready ? 'true' : 'false' }), exitCode: ready ? exitCode : 1, diagnostic, failure });
}
