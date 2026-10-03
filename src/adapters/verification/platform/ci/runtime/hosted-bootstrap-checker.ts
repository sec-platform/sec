/** Trusted bootstrap CHECKER, lifted from the reviewed workflow without executing candidate code.
 * This module computes data. The native bridge owns origin, transport authentication and publication.
 */
import path from 'node:path';
import { rawSha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { settleResources } from '../../../../../execution/resource-settlement.ts';
import { issueGitReadAuthorityOperation, withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET, type GitReadSession } from '../../../../providers/git-read/runtime/session.ts';
import * as registryContract from '../../trust/contract/root.ts';
import * as tcb from '../../trust/runtime/closure-lock.ts';
import * as sutContract from '../contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../contract/revision.ts';

export const HOSTED_BOOTSTRAP_CHECKER_SOURCE = 'src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts';
export const HOSTED_BOOTSTRAP_SUT_FILES = Object.freeze([
  'tcb-lock-pre.json', 'imports.log', 'docs-doctor.log', 'typecheck.log', 'diff-check.log',
  'focused-tests.log', 'repository-audit.json', 'affected-plan.json', 'affected-tests.log', 'tcb-lock-post.json'
] as const);
export type HostedBootstrapSubject = Readonly<{
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string; registryDigest: `sha256:${string}`;
}>;
type Digest = `sha256:${string}`;
type Verdict = 'passed' | 'failed' | 'manual-bootstrap-required';
type Auxiliary = 'not-observed' | 'unavailable' | 'passed' | 'failed' | 'invalid';
export interface HostedBootstrapCheckerReceipt {
  readonly schema: 'sec-trusted-bootstrap-checker-receipt-v1';
  readonly phase: 'pre' | 'post';
  readonly checkerBaseSha: string; readonly baseTreeSha: string;
  readonly candidateHeadSha: string; readonly candidateTreeSha: string; readonly candidateParentSha: string;
  readonly registryDigest: Digest; readonly checkerActionKey: Digest; readonly checkerActionResultDigest: Digest;
  readonly checkerClosureDigest: Digest; readonly candidateActionKey: Digest | null;
  readonly candidateActionResultDigest: Digest | null; readonly candidateClosureDigest: Digest | null;
  readonly candidateTrustRevision: string | null; readonly candidateModuleCount: number | null;
  readonly checkerProgramDigest: Digest; readonly checkerToolBlob: string; readonly checkerWorkflowBlob: string;
  readonly candidateToolBlob: string; readonly candidateWorkflowBlob: string;
  readonly authorityVerdict: Verdict; readonly authorityReason: string; readonly baseUndecidablePaths: readonly string[];
  readonly auxiliaryStatus: Auxiliary; readonly sutEvidenceDigest: Digest | null;
  readonly sutJobResult: string | null; readonly sutDiagnosticDigest: Digest | null; readonly receiptDigest: Digest;
}
export interface HostedBootstrapSutDiagnostic {
  readonly schema: 'sec-trusted-bootstrap-sut-diagnostic-v1';
  readonly baseSha: string; readonly headSha: string; readonly treeSha: string;
  readonly jobResult: string; readonly downloadOutcome: string; readonly auxiliaryStatus: Auxiliary;
  readonly auxiliaryReason: string; readonly evidenceSetDigest: Digest | null;
  readonly candidateReceiptDigest: Digest | null; readonly receiptDigest: Digest;
}
/** Authenticated bytes are supplied only by the bridge's original API reader.
 * A caller-created value is data, never an authenticated artifact capability.
 */
export type HostedBootstrapPostData = Readonly<{
  preSource: string;
  sutJobResult: string;
  sutDownloadOutcome: string;
  sutFiles: Readonly<Record<string, string>> | null;
  sutProblem?: Readonly<{ status: 'unavailable' | 'invalid'; reason: string }>;
}>;
const RECEIPT_KEYS = Object.freeze([
  'schema', 'phase', 'checkerBaseSha', 'baseTreeSha', 'candidateHeadSha', 'candidateTreeSha', 'candidateParentSha',
  'registryDigest', 'checkerActionKey', 'checkerActionResultDigest', 'checkerClosureDigest', 'candidateActionKey',
  'candidateActionResultDigest', 'candidateClosureDigest', 'candidateTrustRevision', 'candidateModuleCount',
  'checkerProgramDigest', 'checkerToolBlob', 'checkerWorkflowBlob', 'candidateToolBlob', 'candidateWorkflowBlob',
  'authorityVerdict', 'authorityReason', 'baseUndecidablePaths', 'auxiliaryStatus', 'sutEvidenceDigest',
  'sutJobResult', 'sutDiagnosticDigest', 'receiptDigest'
]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('trusted bootstrap receipt is not an object.');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} fields are unknown or missing.`);
  }
}
function json(source: string, label: string): Record<string, unknown> {
  return object(parseExactJsonBytes(Buffer.from(source, 'utf8'), label, { maximumInputBytes: 8 * 1024 * 1024, maximumDepth: 32 }));
}
function isDigest(value: unknown): value is Digest { return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value); }
function isSha(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value); }
function canonicalPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/')
    && path.posix.normalize(value) === value && !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..');
}

/** Strict data decoder; a valid self-digest is not producer authentication. */
export function parseHostedBootstrapCheckerReceipt(source: string): HostedBootstrapCheckerReceipt {
  const value = json(source, 'Trusted bootstrap checker receipt');
  exactKeys(value, RECEIPT_KEYS, 'trusted bootstrap checker receipt');
  const { receiptDigest, ...semantic } = value;
  if (value.schema !== 'sec-trusted-bootstrap-checker-receipt-v1' || !['pre', 'post'].includes(String(value.phase))
      || !['checkerBaseSha', 'baseTreeSha', 'candidateHeadSha', 'candidateTreeSha', 'candidateParentSha',
        'checkerToolBlob', 'checkerWorkflowBlob', 'candidateToolBlob', 'candidateWorkflowBlob'].every(key => isSha(value[key]))
      || !['registryDigest', 'checkerActionKey', 'checkerActionResultDigest', 'checkerClosureDigest', 'checkerProgramDigest'].every(key => isDigest(value[key]))
      || !['candidateActionKey', 'candidateActionResultDigest', 'candidateClosureDigest', 'sutEvidenceDigest', 'sutDiagnosticDigest'].every(key => value[key] === null || isDigest(value[key]))
      || !['passed', 'failed', 'manual-bootstrap-required'].includes(String(value.authorityVerdict))
      || typeof value.authorityReason !== 'string' || value.authorityReason.length < 1
      || !Array.isArray(value.baseUndecidablePaths) || !value.baseUndecidablePaths.every(canonicalPath)
      || new Set(value.baseUndecidablePaths).size !== value.baseUndecidablePaths.length
      || !['not-observed', 'unavailable', 'passed', 'failed', 'invalid'].includes(String(value.auxiliaryStatus))
      || (value.sutJobResult !== null && typeof value.sutJobResult !== 'string')
      || receiptDigest !== rawSha256(JSON.stringify(semantic))
      || value.checkerActionResultDigest !== value.checkerClosureDigest
      || value.candidateParentSha !== value.checkerBaseSha) throw new Error('trusted bootstrap checker receipt identity or digest is invalid.');
  if (value.candidateActionKey === null ? ['candidateActionResultDigest', 'candidateClosureDigest', 'candidateTrustRevision', 'candidateModuleCount'].some(key => value[key] !== null)
    : value.candidateActionResultDigest !== value.candidateClosureDigest || !isDigest(value.candidateClosureDigest)
      || typeof value.candidateTrustRevision !== 'string' || value.candidateTrustRevision.length < 1
      || !Number.isSafeInteger(value.candidateModuleCount) || Number(value.candidateModuleCount) < 1) {
    throw new Error('trusted bootstrap candidate Action fields are inconsistent.');
  }
  if (value.phase === 'pre' && (value.auxiliaryStatus !== 'not-observed' || value.sutEvidenceDigest !== null
      || value.sutJobResult !== null || value.sutDiagnosticDigest !== null)) throw new Error('trusted bootstrap PRE contains POST diagnostics.');
  return Object.freeze(value) as unknown as HostedBootstrapCheckerReceipt;
}

/** Original auxiliary reducer, with provider result taking precedence over a self-reported PASS. */
export function reduceHostedBootstrapSut(subject: HostedBootstrapSubject, post: HostedBootstrapPostData): HostedBootstrapSutDiagnostic {
  let auxiliaryStatus: Auxiliary = post.sutProblem?.status ?? 'unavailable';
  let auxiliaryReason = post.sutProblem === undefined ? 'candidate-sut-artifact-unavailable'
    : `candidate-sut-artifact-${post.sutProblem.status}:${post.sutProblem.reason}`;
  let sutEvidenceDigest: Digest | null = null;
  let candidateReceiptDigest: Digest | null = null;
  if (post.sutProblem === undefined && post.sutDownloadOutcome === 'success' && post.sutFiles !== null) {
    try {
      const files = post.sutFiles;
      const sumsSource = files.SHA256SUMS;
      const expectedLines = HOSTED_BOOTSTRAP_SUT_FILES.map(name => {
        if (typeof files[name] !== 'string') throw new Error(`missing candidate SUT evidence member ${name}`);
        return `${rawSha256(files[name]).slice(7)}  ${name}`;
      });
      if (sumsSource !== `${expectedLines.join('\n')}\n`) throw new Error('candidate SUT evidence digest inventory is invalid');
      const sutReceipt = json(files['sut-receipt.json']!, 'Trusted bootstrap SUT receipt');
      exactKeys(sutReceipt, ['schema', 'baseSha', 'headSha', 'treeSha', 'parentSha', 'auxiliaryStatus',
        'evidenceSetDigest', 'bootstrapDigest', 'sandboxPolicyDigest', 'commandPlanDigest', 'archiveDigest',
        'archiveInventoryDigest', 'executionOutputDigest', 'capability', 'executionLifecycle', 'cleanup', 'receiptDigest'], 'trusted bootstrap SUT receipt');
      const { receiptDigest, ...semantic } = sutReceipt;
      const capability = sutContract.parseHostedSutCapabilityObservation(sutReceipt.capability);
      const lifecycle = sutContract.parseHostedSutLifecycle(sutReceipt.executionLifecycle);
      const cleanup = sutContract.parseHostedSutCleanup(sutReceipt.cleanup);
      const physicalComplete = sutContract.hostedSutCapabilityComplete(capability)
        && sutContract.hostedSutLifecycleComplete(lifecycle) && sutContract.hostedSutCleanupComplete(cleanup);
      if (sutReceipt.schema !== 'sec-trusted-bootstrap-sut-receipt-v3' || sutReceipt.baseSha !== subject.baseSha
          || sutReceipt.headSha !== subject.headSha || sutReceipt.treeSha !== subject.headTreeSha || sutReceipt.parentSha !== subject.baseSha
          || !['passed', 'failed'].includes(String(sutReceipt.auxiliaryStatus))
          || !['evidenceSetDigest', 'bootstrapDigest', 'sandboxPolicyDigest', 'archiveDigest', 'archiveInventoryDigest', 'executionOutputDigest'].every(key => isDigest(sutReceipt[key]))
          || (sutReceipt.commandPlanDigest !== null && !isDigest(sutReceipt.commandPlanDigest))
          || sutReceipt.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
          || (sutReceipt.auxiliaryStatus === 'passed' && (sutReceipt.commandPlanDigest === null || !physicalComplete))
          || sutReceipt.evidenceSetDigest !== rawSha256(sumsSource) || receiptDigest !== rawSha256(JSON.stringify(semantic))
          || (sutReceipt.auxiliaryStatus === 'passed') !== (post.sutJobResult === 'success')) {
        throw new Error('candidate SUT receipt identity or digest is invalid');
      }
      auxiliaryStatus = sutReceipt.auxiliaryStatus as 'passed' | 'failed';
      auxiliaryReason = auxiliaryStatus === 'passed' ? 'candidate-sut-diagnostics-passed' : 'candidate-sut-diagnostics-failed';
      sutEvidenceDigest = sutReceipt.evidenceSetDigest as Digest;
      candidateReceiptDigest = receiptDigest as Digest;
    } catch (error) {
      auxiliaryStatus = 'invalid';
      auxiliaryReason = `candidate-sut-artifact-invalid:${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const semantic = { schema: 'sec-trusted-bootstrap-sut-diagnostic-v1' as const, baseSha: subject.baseSha,
    headSha: subject.headSha, treeSha: subject.headTreeSha, jobResult: post.sutJobResult, downloadOutcome: post.sutDownloadOutcome,
    auxiliaryStatus, auxiliaryReason, evidenceSetDigest: sutEvidenceDigest, candidateReceiptDigest };
  return Object.freeze({ ...semantic, receiptDigest: rawSha256(JSON.stringify(semantic)) });
}

async function gitBytes(session: GitReadSession, args: readonly string[]): Promise<Buffer> {
  const result = await session.run(args);
  if (result.kind !== 'completed' || result.result.code !== 0) throw new Error(`trusted bootstrap checker git ${args.join(' ')} failed.`);
  return Buffer.from(result.result.stdout);
}
async function gitText(session: GitReadSession, args: readonly string[]): Promise<string> { return (await gitBytes(session, args)).toString('utf8').trim(); }
async function git(session: GitReadSession, ref: string): Promise<string> {
  const value = await gitText(session, ['rev-parse', '--verify', ref]);
  if (!isSha(value)) throw new Error(`trusted bootstrap checker cannot resolve ${ref}.`);
  return value;
}

/** One bounded data computation in clean private roots retained by the bridge's workspace owner. */
export async function computeHostedBootstrapChecker(input: Readonly<{
  subject: HostedBootstrapSubject; phase: 'pre' | 'post'; baseRoot: string; candidateRoot: string;
  checkerSource: Uint8Array; deadlineAtUnixMs: number; signal: AbortSignal;
  post?: HostedBootstrapPostData;
}>): Promise<Readonly<{ receipt: HostedBootstrapCheckerReceipt; diagnostic: HostedBootstrapSutDiagnostic | null; gitVersion: string }>> {
  // Snapshot data before the first await. Neither a caller mutation nor a
  // retained Buffer alias may substitute identities, PRE evidence or source.
  input = Object.freeze({ subject: Object.freeze({ baseSha: input.subject.baseSha, baseTreeSha: input.subject.baseTreeSha,
    headSha: input.subject.headSha, headTreeSha: input.subject.headTreeSha, registryDigest: input.subject.registryDigest }),
    phase: input.phase, baseRoot: input.baseRoot, candidateRoot: input.candidateRoot,
    checkerSource: new Uint8Array(input.checkerSource), deadlineAtUnixMs: input.deadlineAtUnixMs, signal: input.signal,
    post: input.post === undefined ? undefined : Object.freeze({ preSource: input.post.preSource,
      sutJobResult: input.post.sutJobResult, sutDownloadOutcome: input.post.sutDownloadOutcome,
      sutFiles: input.post.sutFiles === null ? null : Object.freeze({ ...input.post.sutFiles }),
      sutProblem: input.post.sutProblem === undefined ? undefined : Object.freeze({ ...input.post.sutProblem }) }) });
  const { subject, phase, baseRoot, candidateRoot } = input;
  if (![subject.baseSha, subject.baseTreeSha, subject.headSha, subject.headTreeSha].every(isSha)
      || !isDigest(subject.registryDigest) || (phase !== 'pre' && phase !== 'post')
      || (phase === 'post') !== (input.post !== undefined)) throw new Error('trusted bootstrap checker input is invalid.');
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs, Date.now() + GIT_READ_EXACT_TREE_OPERATION_BUDGET.deadlineMs);
  const open = <T>(cwd: string, use: (session: GitReadSession) => Promise<T>) => {
    const sessionInput = { cwd, budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET, deadlineAtUnixMs, signal: input.signal, source: process.env };
    return withAuthorityGitReadSession({ ...sessionInput,
      operation: issueGitReadAuthorityOperation(sessionInput, deadlineAtUnixMs) }, use);
  };
  return open(baseRoot, baseGit => open(candidateRoot, async candidateGit => {
    const assertExactGitIdentity = async (): Promise<void> => {
      if (await git(baseGit, 'HEAD^{commit}') !== subject.baseSha || await git(baseGit, 'HEAD^{tree}') !== subject.baseTreeSha
          || (await gitBytes(baseGit, ['status', '--porcelain=v1'])).length !== 0) {
        throw new Error('trusted bootstrap checker base identity is not exact and clean.');
      }
      const parents = (await gitText(candidateGit, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(/\s+/u);
      if (await git(candidateGit, 'HEAD^{commit}') !== subject.headSha || await git(candidateGit, 'HEAD^{tree}') !== subject.headTreeSha
          || parents.length !== 2 || parents[0] !== subject.headSha || parents[1] !== subject.baseSha
          || (await gitBytes(candidateGit, ['status', '--porcelain=v1'])).length !== 0) {
        throw new Error('trusted bootstrap candidate identity is not exact, single-parent, and clean.');
      }
    };
    await assertExactGitIdentity();
    const baseSnapshot = tcb.createTcbClosureCandidateSnapshot({ candidateRoot: baseRoot });
    let candidateSnapshot: ReturnType<typeof tcb.createTcbClosureCandidateSnapshot> | undefined;
    let primary: Readonly<{ label: string; error: unknown }> | undefined;
    let result: Readonly<{ receipt: HostedBootstrapCheckerReceipt; diagnostic: HostedBootstrapSutDiagnostic | null; gitVersion: string }> | undefined;
    try {
      candidateSnapshot = tcb.createTcbClosureCandidateSnapshot({ candidateRoot });
      const baseOptions = { candidateSnapshot: baseSnapshot }, candidateOptions = { candidateSnapshot };
      const changedPaths = (await gitBytes(candidateGit, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', '-z', subject.baseSha, subject.headSha])).toString('utf8').split('\0').filter(Boolean);
      if (!changedPaths.every(canonicalPath)) throw new Error('trusted bootstrap candidate changed-path inventory is not canonical.');
      const registryPath = registryContract.SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH;
      const baseRegistryBytes = tcb.readTcbClosureCandidateFile(registryPath, baseOptions);
      const candidateRegistryBytes = tcb.readTcbClosureCandidateFile(registryPath, candidateOptions);
      const registryDigest = rawSha256(baseRegistryBytes), candidateRegistryDigest = rawSha256(candidateRegistryBytes);
      if (registryDigest !== subject.registryDigest) throw new Error('trusted bootstrap checker base registry digest drifted.');
      const baseRegistry = registryContract.parseSecTrustedBootstrapRegistry(Buffer.from(baseRegistryBytes).toString('utf8'));
      const pre = input.post === undefined ? null : parseHostedBootstrapCheckerReceipt(input.post.preSource);
      if (pre !== null && (pre.phase !== 'pre' || pre.checkerBaseSha !== subject.baseSha || pre.baseTreeSha !== subject.baseTreeSha
          || pre.candidateHeadSha !== subject.headSha || pre.candidateTreeSha !== subject.headTreeSha
          || pre.candidateParentSha !== subject.baseSha || pre.registryDigest !== registryDigest)) {
        throw new Error('trusted bootstrap PRE receipt identity or digest is invalid.');
      }
      let checkerAction: Pick<tcb.TcbClosureActionResult, 'actionKey' | 'resultDigest'>;
      let checkerClosureDigest: Digest;
      let candidateAction: { actionKey: Digest; resultDigest: Digest; identity: { closureDigest: string; trustRevision: string; moduleCount: number } } | null;
      let baseUndecidablePaths: readonly string[], authorityVerdict: Verdict, authorityReason: string;
      if (pre === null) {
        const checker = tcb.compileTcbClosureActionResult({ plan: tcb.createTcbClosureActionPlan({ exactTreeSha: subject.baseTreeSha,
          registryDigest, toolchainRevision: `bun@${Bun.version}:typescript`, providerRevision: 'github-actions-trusted-bootstrap-v1' }), options: baseOptions });
        checkerAction = checker; checkerClosureDigest = checker.identity.closureDigest as Digest;
        const baseTrustRoot = registryContract.createSecTrustedBootstrapTrustRoot({ registry: baseRegistry, causalRuntimePaths: checker.identity.modules });
        const demand = tcb.selectTcbClosureCandidateAction({ changedPaths, exactTreeSha: subject.headTreeSha, registryDigest,
          toolchainRevision: `bun@${Bun.version}:typescript`, providerRevision: 'github-actions-trusted-bootstrap-v1', trustedRegistry: baseRegistry, checkerResult: checker });
        baseUndecidablePaths = demand.impactedPaths;
        const hardFailures = new Set<string>();
        const manual = new Set(baseUndecidablePaths.length === 0 ? [] : ['trusted-base-cannot-decide-checker-policy-or-validation-plan-change']);
        if (baseUndecidablePaths.length === 0) hardFailures.add('trusted-bootstrap-request-does-not-change-trust-root');
        try { registryContract.parseSecTrustedBootstrapRegistry(Buffer.from(candidateRegistryBytes).toString('utf8')); }
        catch (error) { manual.add(`candidate-registry-schema-or-policy-change:${error instanceof Error ? error.message : String(error)}`); }
        if (candidateRegistryDigest !== registryDigest) manual.add('candidate-registry-differs-from-trusted-base-policy');
        candidateAction = null;
        if (demand.plan !== null) {
          try {
            const candidate = tcb.compileTcbClosureActionResult({ plan: demand.plan, options: candidateOptions, upstreamResults: [checker] });
            candidateAction = candidate;
            if (JSON.stringify(candidate.identity.modules) !== JSON.stringify(baseTrustRoot.causalRuntimePaths)) {
              manual.add('candidate-causal-closure-differs-from-trusted-base-closure');
            }
          } catch (error) { hardFailures.add(`candidate-closure-computation-failed:${error instanceof Error ? error.message : String(error)}`); }
        }
        authorityVerdict = hardFailures.size > 0 ? 'failed' : manual.size > 0 ? 'manual-bootstrap-required' : 'passed';
        authorityReason = authorityVerdict === 'failed' ? [...hardFailures].sort().join('|')
          : authorityVerdict === 'manual-bootstrap-required' ? [...manual].sort().join('|') : 'trusted-base-policy-fully-decided-candidate';
      } else {
        checkerAction = { actionKey: pre.checkerActionKey, resultDigest: pre.checkerActionResultDigest };
        checkerClosureDigest = pre.checkerClosureDigest;
        candidateAction = pre.candidateActionKey === null ? null : { actionKey: pre.candidateActionKey,
          resultDigest: pre.candidateActionResultDigest!, identity: { closureDigest: pre.candidateClosureDigest!, trustRevision: pre.candidateTrustRevision!, moduleCount: pre.candidateModuleCount! } };
        baseUndecidablePaths = pre.baseUndecidablePaths; authorityVerdict = pre.authorityVerdict; authorityReason = pre.authorityReason;
      }
      const diagnostic = input.post === undefined ? null : reduceHostedBootstrapSut(subject, input.post);
      const semantic = { schema: 'sec-trusted-bootstrap-checker-receipt-v1' as const, phase, checkerBaseSha: subject.baseSha,
        baseTreeSha: subject.baseTreeSha, candidateHeadSha: subject.headSha, candidateTreeSha: subject.headTreeSha,
        candidateParentSha: subject.baseSha, registryDigest, checkerActionKey: checkerAction.actionKey,
        checkerActionResultDigest: checkerAction.resultDigest, checkerClosureDigest,
        candidateActionKey: candidateAction?.actionKey ?? null, candidateActionResultDigest: candidateAction?.resultDigest ?? null,
        candidateClosureDigest: candidateAction?.identity.closureDigest ?? null, candidateTrustRevision: candidateAction?.identity.trustRevision ?? null,
        candidateModuleCount: candidateAction?.identity.moduleCount ?? null, checkerProgramDigest: rawSha256(input.checkerSource),
        checkerToolBlob: await git(baseGit, 'HEAD:src/adapters/verification/platform/trust/runtime/closure-lock.ts'),
        checkerWorkflowBlob: await git(baseGit, 'HEAD:.github/workflows/trusted-bootstrap.yml'),
        candidateToolBlob: await git(candidateGit, 'HEAD:src/adapters/verification/platform/trust/runtime/closure-lock.ts'),
        candidateWorkflowBlob: await git(candidateGit, 'HEAD:.github/workflows/trusted-bootstrap.yml'), authorityVerdict, authorityReason, baseUndecidablePaths,
        auxiliaryStatus: diagnostic?.auxiliaryStatus ?? 'not-observed', sutEvidenceDigest: diagnostic?.evidenceSetDigest ?? null,
        sutJobResult: diagnostic?.jobResult ?? null, sutDiagnosticDigest: diagnostic?.receiptDigest ?? null };
      const receipt = parseHostedBootstrapCheckerReceipt(JSON.stringify({ ...semantic, receiptDigest: rawSha256(JSON.stringify(semantic)) }));
      if (pre !== null) {
        const stable = ({ phase: _phase, receiptDigest: _digest, auxiliaryStatus: _status, sutEvidenceDigest: _sutDigest,
          sutJobResult: _result, sutDiagnosticDigest: _diagnosticDigest, ...value }: HostedBootstrapCheckerReceipt) => value;
        if (JSON.stringify(stable(pre)) !== JSON.stringify(stable(receipt))) throw new Error('trusted bootstrap PRE and POST candidate closure receipts differ.');
      }
      result = Object.freeze({ receipt, diagnostic, gitVersion: await gitText(baseGit, ['--version']) });
    } catch (error) { primary = { label: 'trusted-bootstrap-checker', error }; }
    settleResources({ primary, cleanup: [
      { label: 'trusted-bootstrap-base-snapshot', settle: () => tcb.finalizeTcbClosureCandidateSnapshot(baseSnapshot) },
      { label: 'trusted-bootstrap-candidate-snapshot', settle: () => { if (candidateSnapshot !== undefined) tcb.finalizeTcbClosureCandidateSnapshot(candidateSnapshot); } }
    ] });
    await assertExactGitIdentity();
    return result!;
  }));
}

/** Original final-envelope branch order: authority remains independent from auxiliary diagnostics. */
export function reduceHostedBootstrapFinal(receipt: HostedBootstrapCheckerReceipt): Readonly<{ status: Verdict | 'incomplete'; reason: string }> {
  if (receipt.phase !== 'post') throw new Error('trusted bootstrap final reducer requires POST.');
  if (receipt.authorityVerdict === 'manual-bootstrap-required' || receipt.authorityVerdict === 'failed') {
    return Object.freeze({ status: receipt.authorityVerdict, reason: receipt.authorityReason });
  }
  return Object.freeze(receipt.auxiliaryStatus === 'passed' ? { status: 'passed', reason: 'base-authority-and-candidate-auxiliary-passed' }
    : receipt.auxiliaryStatus === 'failed' ? { status: 'failed', reason: 'candidate-auxiliary-diagnostics-failed' }
      : { status: 'incomplete', reason: 'candidate-auxiliary-diagnostics-missing-or-invalid' });
}
