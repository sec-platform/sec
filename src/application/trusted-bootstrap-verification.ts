import { failureMessage } from '../contracts/failure-inspection.ts';
import { settleResources } from '../execution/resource-settlement.ts';
import {
  assertTrustedBootstrapExactKeys, assertTrustedBootstrapPreReceipt,
  assertTrustedBootstrapStableReceipt, assertTrustedBootstrapSutEvidenceDigestInventory,
  deriveTrustedBootstrapAuthority, evaluateTrustedBootstrapSutEvidence,
  prepareTrustedBootstrapCheckerReceipt,
  TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES,
  trustedBootstrapDigest,
  trustedBootstrapJsonDigest
} from '../execution/verification/trusted-bootstrap.ts';

export type TrustedBootstrapIdentity = Readonly<{
  phase: 'pre' | 'post'; baseSha: string; baseTreeSha: string;
  headSha: string; treeSha: string; registryDigest: `sha256:${string}`;
  preDownloadOutcome: string | null; sutDownloadOutcome: string | null;
  sutJobResult: string | null;
}>;

type Digest = `sha256:${string}`;
type ClosureAction = Readonly<{
  actionKey: Digest; resultDigest: Digest;
  identity: Readonly<{
    closureDigest: Digest; trustRevision: string; moduleCount: number;
    modules: readonly string[];
  }>;
}>;

export type TrustedBootstrapVerificationPorts<Snapshot, Registry, Plan, Action extends ClosureAction> = Readonly<{
  createSnapshot(root: 'base' | 'candidate'): Snapshot;
  finalizeSnapshot(snapshot: Snapshot): void;
  readRegistry(snapshot: Snapshot): Uint8Array;
  parseRegistry(bytes: Uint8Array): Registry;
  changedPaths(): readonly string[];
  compileChecker(snapshot: Snapshot): Action;
  baseTrustRuntimePaths(registry: Registry, checker: Action): readonly string[];
  selectCandidate(input: Readonly<{
    changedPaths: readonly string[]; registry: Registry; checker: Action;
  }>): Readonly<{ impactedPaths: readonly string[]; plan: Plan | null }>;
  compileCandidate(plan: Plan, snapshot: Snapshot, checker: Action): Action;
  readPreReceipt(): Uint8Array;
  readSutFile(name: string): Uint8Array;
  prepareSut(): Promise<void>;
  parseSutCapability(value: unknown): boolean;
  parseSutLifecycle(value: unknown): boolean;
  parseSutCleanup(value: unknown): boolean;
  sandboxPolicyDigest(): Digest;
  checkerProgramBytes(): Uint8Array;
  gitBlob(root: 'base' | 'candidate', repositoryPath: string): string;
  assertExactIdentity(): void;
}>;

const parseJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

async function inspectSut<Snapshot, Registry, Plan, Action extends ClosureAction>(
  identity: TrustedBootstrapIdentity,
  ports: TrustedBootstrapVerificationPorts<Snapshot, Registry, Plan, Action>
): Promise<Readonly<{
  auxiliaryStatus: string; sutEvidenceDigest: Digest | null; sutJobResult: string;
  sutDiagnosticDigest: Digest; diagnostic: Readonly<Record<string, unknown>>;
}>> {
  const jobResult = identity.sutJobResult;
  const downloadOutcome = identity.sutDownloadOutcome;
  if (jobResult === null || downloadOutcome === null) throw new Error('POST SUT inputs are absent.');
  let auxiliaryStatus = 'unavailable';
  let auxiliaryReason = 'candidate-sut-artifact-unavailable';
  let sutEvidenceDigest: Digest | null = null;
  let candidateReceiptDigest: Digest | null = null;
  if (downloadOutcome === 'success') {
    try {
      const files = new Map<string, Uint8Array>();
      files.set('SHA256SUMS', ports.readSutFile('SHA256SUMS'));
      for (const name of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES) files.set(name, ports.readSutFile(name));
      assertTrustedBootstrapSutEvidenceDigestInventory(files);
      files.set('sut-receipt.json', ports.readSutFile('sut-receipt.json'));
      const receipt = parseJson(files.get('sut-receipt.json')!);
      assertTrustedBootstrapExactKeys(receipt, [
        'schema', 'baseSha', 'headSha', 'treeSha', 'parentSha', 'auxiliaryStatus',
        'evidenceSetDigest', 'bootstrapDigest', 'sandboxPolicyDigest', 'commandPlanDigest',
        'archiveDigest', 'archiveInventoryDigest', 'executionOutputDigest',
        'capability', 'executionLifecycle', 'cleanup', 'receiptDigest'
      ], 'trusted bootstrap SUT receipt');
      await ports.prepareSut();
      const capabilityComplete = ports.parseSutCapability(receipt.capability);
      const lifecycleComplete = ports.parseSutLifecycle(receipt.executionLifecycle);
      const cleanupComplete = ports.parseSutCleanup(receipt.cleanup);
      const verified = evaluateTrustedBootstrapSutEvidence({ ...identity, jobResult,
        files, capabilityComplete, lifecycleComplete, cleanupComplete,
        sandboxPolicyDigest: ports.sandboxPolicyDigest() });
      auxiliaryStatus = verified.auxiliaryStatus;
      auxiliaryReason = verified.auxiliaryReason;
      sutEvidenceDigest = verified.evidenceSetDigest;
      candidateReceiptDigest = verified.candidateReceiptDigest;
    } catch (error) {
      auxiliaryStatus = 'invalid';
      auxiliaryReason = `candidate-sut-artifact-invalid:${failureMessage(error)}`;
    }
  }
  const diagnostic = {
    schema: 'sec-trusted-bootstrap-sut-diagnostic-v1',
    baseSha: identity.baseSha, headSha: identity.headSha, treeSha: identity.treeSha,
    jobResult, downloadOutcome, auxiliaryStatus, auxiliaryReason,
    evidenceSetDigest: sutEvidenceDigest, candidateReceiptDigest
  };
  const sutDiagnosticDigest = trustedBootstrapJsonDigest(diagnostic);
  return { auxiliaryStatus, sutEvidenceDigest, sutJobResult: jobResult, sutDiagnosticDigest,
    diagnostic: Object.freeze({ ...diagnostic, receiptDigest: sutDiagnosticDigest }) };
}

export type PreparedTrustedBootstrapVerification = Readonly<{
  receipt: Readonly<Record<string, unknown>>;
  diagnostic: Readonly<Record<string, unknown>> | null;
}>;

export async function runTrustedBootstrapVerification<Snapshot, Registry, Plan, Action extends ClosureAction>(
  identity: TrustedBootstrapIdentity,
  ports: TrustedBootstrapVerificationPorts<Snapshot, Registry, Plan, Action>
): Promise<PreparedTrustedBootstrapVerification> {
  ports.assertExactIdentity();
  const baseSnapshot = ports.createSnapshot('base');
  let candidateSnapshot!: Snapshot;
  let candidateIssued = false;
  let semantic: Record<string, unknown> | null = null;
  let pre: Record<string, unknown> | null = null;
  let diagnostic: Readonly<Record<string, unknown>> | null = null;
  let primary: { label: string; error: unknown } | undefined;
  try {
    candidateSnapshot = ports.createSnapshot('candidate');
    candidateIssued = true;
    const changedPaths = ports.changedPaths();
    const baseRegistryBytes = ports.readRegistry(baseSnapshot);
    const candidateRegistryBytes = ports.readRegistry(candidateSnapshot);
    const baseRegistryDigest = trustedBootstrapDigest(baseRegistryBytes);
    const candidateRegistryDigest = trustedBootstrapDigest(candidateRegistryBytes);
    if (baseRegistryDigest !== identity.registryDigest) throw new Error('Trusted bootstrap base registry digest drifted.');
    const baseRegistry = ports.parseRegistry(baseRegistryBytes);
    if (identity.phase === 'post') {
      if (identity.preDownloadOutcome !== 'success') throw new Error('Trusted bootstrap reducer requires the base-owned PRE artifact.');
      const parsed = parseJson(ports.readPreReceipt());
      assertTrustedBootstrapPreReceipt(parsed, { ...identity, registryDigest: baseRegistryDigest,
        checkerProgramDigest: trustedBootstrapDigest(ports.checkerProgramBytes()) });
      pre = parsed;
    }
    let checkerActionKey: unknown;
    let checkerActionResultDigest: unknown;
    let checkerClosureDigest: unknown;
    let candidateActionKey: unknown = null;
    let candidateActionResultDigest: unknown = null;
    let candidateClosureDigest: unknown = null;
    let candidateTrustRevision: unknown = null;
    let candidateModuleCount: unknown = null;
    let baseUndecidablePaths: unknown;
    let authorityVerdict: unknown;
    let authorityReason: unknown;
    if (pre === null) {
      const checker = ports.compileChecker(baseSnapshot);
      checkerActionKey = checker.actionKey;
      checkerActionResultDigest = checker.resultDigest;
      checkerClosureDigest = checker.identity.closureDigest;
      const baseRuntimePaths = ports.baseTrustRuntimePaths(baseRegistry, checker);
      const demand = ports.selectCandidate({ changedPaths, registry: baseRegistry, checker });
      baseUndecidablePaths = demand.impactedPaths;
      let candidateRegistryFailure: string | null = null;
      try { ports.parseRegistry(candidateRegistryBytes); }
      catch (error) { candidateRegistryFailure = failureMessage(error); }
      let candidateCompilationFailure: string | null = null;
      let candidateCausalClosureMatches: boolean | null = null;
      if (demand.plan !== null) {
        try {
          const candidate = ports.compileCandidate(demand.plan, candidateSnapshot, checker);
          candidateActionKey = candidate.actionKey;
          candidateActionResultDigest = candidate.resultDigest;
          candidateClosureDigest = candidate.identity.closureDigest;
          candidateTrustRevision = candidate.identity.trustRevision;
          candidateModuleCount = candidate.identity.moduleCount;
          candidateCausalClosureMatches = JSON.stringify(candidate.identity.modules) === JSON.stringify(baseRuntimePaths);
        } catch (error) {
          candidateCompilationFailure = failureMessage(error);
        }
      }
      const authority = deriveTrustedBootstrapAuthority({
        impactedPaths: demand.impactedPaths, candidateRegistryFailure,
        candidateRegistryDigestMatches: candidateRegistryDigest === baseRegistryDigest,
        candidateCompilationFailure, candidateCausalClosureMatches
      });
      authorityVerdict = authority.verdict;
      authorityReason = authority.reason;
    } else {
      checkerActionKey = pre.checkerActionKey;
      checkerActionResultDigest = pre.checkerActionResultDigest;
      checkerClosureDigest = pre.checkerClosureDigest;
      candidateActionKey = pre.candidateActionKey;
      candidateActionResultDigest = pre.candidateActionResultDigest;
      candidateClosureDigest = pre.candidateClosureDigest;
      candidateTrustRevision = pre.candidateTrustRevision;
      candidateModuleCount = pre.candidateModuleCount;
      baseUndecidablePaths = pre.baseUndecidablePaths;
      authorityVerdict = pre.authorityVerdict;
      authorityReason = pre.authorityReason;
    }
    const sut = identity.phase === 'post' ? await inspectSut(identity, ports) : {
      auxiliaryStatus: 'not-observed', sutEvidenceDigest: null,
      sutJobResult: null, sutDiagnosticDigest: null, diagnostic: null
    };
    diagnostic = sut.diagnostic;
    semantic = {
      schema: 'sec-trusted-bootstrap-checker-receipt-v1', phase: identity.phase,
      checkerBaseSha: identity.baseSha, baseTreeSha: identity.baseTreeSha,
      candidateHeadSha: identity.headSha, candidateTreeSha: identity.treeSha,
      candidateParentSha: identity.baseSha, registryDigest: baseRegistryDigest,
      checkerActionKey, checkerActionResultDigest, checkerClosureDigest,
      candidateActionKey, candidateActionResultDigest, candidateClosureDigest,
      candidateTrustRevision, candidateModuleCount,
      checkerProgramDigest: trustedBootstrapDigest(ports.checkerProgramBytes()),
      checkerToolBlob: ports.gitBlob('base', 'src/adapters/verification/platform/trust/runtime/closure-lock.ts'),
      checkerWorkflowBlob: ports.gitBlob('base', '.github/workflows/trusted-bootstrap.yml'),
      candidateToolBlob: ports.gitBlob('candidate', 'src/adapters/verification/platform/trust/runtime/closure-lock.ts'),
      candidateWorkflowBlob: ports.gitBlob('candidate', '.github/workflows/trusted-bootstrap.yml'),
      authorityVerdict, authorityReason, baseUndecidablePaths,
      auxiliaryStatus: sut.auxiliaryStatus, sutEvidenceDigest: sut.sutEvidenceDigest,
      sutJobResult: sut.sutJobResult, sutDiagnosticDigest: sut.sutDiagnosticDigest
    };
  } catch (error) {
    primary = { label: 'trusted-bootstrap-verification', error };
  }
  const cleanup = [{ label: 'trusted-bootstrap-base-snapshot', settle: () => ports.finalizeSnapshot(baseSnapshot) }];
  if (candidateIssued) cleanup.push({
    label: 'trusted-bootstrap-candidate-snapshot', settle: () => ports.finalizeSnapshot(candidateSnapshot)
  });
  settleResources({ primary, cleanup });
  if (semantic === null) throw new Error('Trusted bootstrap completion lacks its semantic receipt.');
  ports.assertExactIdentity();
  const receipt = prepareTrustedBootstrapCheckerReceipt(semantic);
  if (pre !== null) assertTrustedBootstrapStableReceipt(pre, receipt);
  return Object.freeze({ receipt, diagnostic });
}
