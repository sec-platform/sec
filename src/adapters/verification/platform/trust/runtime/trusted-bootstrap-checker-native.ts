import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isProxy } from 'node:util/types';
import { readVerificationDataRecord, snapshotVerificationData } from '../../../../../assurance/verification/contract/data.ts';
import { snapshotByteView } from '../../../../../contracts/byte-snapshot.ts';
import { failureMessage } from '../../../../../contracts/failure-inspection.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';
import {
  TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS,
  TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES,
  assertTrustedBootstrapExactKeys, assertTrustedBootstrapPreReceipt, assertTrustedBootstrapPreparedReceipt,
  assertTrustedBootstrapStableReceipt, deriveTrustedBootstrapAuthority,
  evaluateTrustedBootstrapSutEvidence, prepareTrustedBootstrapCheckerReceipt,
  trustedBootstrapDigest, trustedBootstrapJsonDigest
} from '../../../../../execution/verification/trusted-bootstrap.ts';
import {
  inspectNoFollowDirectoryChain, publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';

export type TrustedBootstrapPhase = 'pre' | 'post';
export type TrustedBootstrapExecutionFacts = Readonly<{
  phase: TrustedBootstrapPhase;
  trustedRoot: string; candidateRoot: string; receiptPath: string;
  baseSha: string; baseTreeSha: string; headSha: string; treeSha: string;
  registryDigest: `sha256:${string}`;
  evidenceRoot: string; sutEvidenceRoot: string | null; finalEvidenceRoot: string | null;
  preDownloadOutcome: string | null; sutDownloadOutcome: string | null; sutJobResult: string | null;
}>;
export type TrustedBootstrapSourceFacts = Pick<TrustedBootstrapExecutionFacts,
  'trustedRoot' | 'candidateRoot' | 'baseSha' | 'baseTreeSha' | 'headSha' | 'treeSha' | 'registryDigest'>;

function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Trusted bootstrap checker requires ${name}.`);
  return value;
}

function sha(name: string): string {
  const value = required(name);
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`Trusted bootstrap ${name} is not an exact Git SHA.`);
  return value;
}

function physicalRoot(name: string): string {
  const value = required(name);
  if (!path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`Trusted bootstrap ${name} is not an absolute canonical root.`);
  }
  const entry = lstatSync(value);
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync.native(value) !== value) {
    throw new Error(`Trusted bootstrap ${name} is not one exact physical ordinary root.`);
  }
  return value;
}

const gitEnvironment = Object.freeze({ ...Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => !name.startsWith('GIT_'))), GIT_NO_REPLACE_OBJECTS: '1' });

export function trustedBootstrapGitBytes(root: string, args: readonly string[]): Buffer {
  const result = Bun.spawnSync(['git', '--no-replace-objects', '-C', root, ...args], {
    stdout: 'pipe', stderr: 'pipe', env: gitEnvironment
  });
  if (result.exitCode !== 0) throw new Error(`Trusted bootstrap Git ${args.join(' ')} failed.`);
  return Buffer.from(result.stdout);
}

function gitSha(root: string, ref: string): string {
  const value = trustedBootstrapGitBytes(root, ['rev-parse', '--verify', ref]).toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`Trusted bootstrap Git ${ref} is not exact.`);
  return value;
}

function clean(root: string): boolean {
  return trustedBootstrapGitBytes(root, ['status', '--porcelain=v1', '--untracked-files=all']).byteLength === 0;
}

export function assertTrustedBootstrapExactGitIdentity(facts: TrustedBootstrapSourceFacts): void {
  const baseTop = trustedBootstrapGitBytes(facts.trustedRoot, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const candidateTop = trustedBootstrapGitBytes(facts.candidateRoot, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (baseTop !== facts.trustedRoot || candidateTop !== facts.candidateRoot
      || gitSha(facts.trustedRoot, 'HEAD^{commit}') !== facts.baseSha
      || gitSha(facts.trustedRoot, 'HEAD^{tree}') !== facts.baseTreeSha
      || gitSha(facts.candidateRoot, 'HEAD^{commit}') !== facts.headSha
      || gitSha(facts.candidateRoot, 'HEAD^{tree}') !== facts.treeSha
      || !clean(facts.trustedRoot) || !clean(facts.candidateRoot)) {
    throw new Error('Trusted bootstrap source/candidate Git identities are not exact and clean.');
  }
  const parents = trustedBootstrapGitBytes(facts.candidateRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'])
    .toString('utf8').trim().split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== facts.headSha || parents[1] !== facts.baseSha) {
    throw new Error('Trusted bootstrap candidate is not an exact single-parent child of trusted base.');
  }
}

export function readTrustedBootstrapSourceFacts(): TrustedBootstrapSourceFacts {
  const digest = required('SEC_BOOTSTRAP_REGISTRY_DIGEST');
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new Error('Trusted bootstrap registry digest is invalid.');
  const facts = Object.freeze({
    trustedRoot: physicalRoot('TRUSTED_BASE_ROOT'), candidateRoot: physicalRoot('CANDIDATE_ROOT'),
    baseSha: sha('SEC_BOOTSTRAP_BASE'), baseTreeSha: sha('SEC_BOOTSTRAP_BASE_TREE'),
    headSha: sha('SEC_BOOTSTRAP_HEAD'), treeSha: sha('SEC_BOOTSTRAP_TREE'),
    registryDigest: digest as `sha256:${string}`
  });
  assertTrustedBootstrapExactGitIdentity(facts);
  return facts;
}

function readTrustedBootstrapExecutionFacts(): TrustedBootstrapExecutionFacts {
  const phase = required('SEC_BOOTSTRAP_PHASE');
  if (phase !== 'pre' && phase !== 'post') throw new Error('Trusted bootstrap checker phase is unsupported.');
  const source = readTrustedBootstrapSourceFacts();
  const evidenceRoot = physicalRoot('BOOTSTRAP_EVIDENCE_ROOT');
  const finalEvidenceRoot = phase === 'post' ? physicalRoot('FINAL_EVIDENCE_ROOT') : null;
  const receiptPath = required('SEC_BOOTSTRAP_RECEIPT');
  if (receiptPath !== path.join(phase === 'pre' ? evidenceRoot : finalEvidenceRoot!,
    phase === 'pre' ? 'pre-receipt.json' : 'post-receipt.json')) {
    throw new Error('Trusted bootstrap receipt does not bind its fixed phase slot.');
  }
  const facts = Object.freeze({
    phase, ...source,
    receiptPath, evidenceRoot,
    sutEvidenceRoot: phase === 'post' ? physicalRoot('SUT_EVIDENCE_ROOT') : null,
    finalEvidenceRoot,
    preDownloadOutcome: phase === 'post' ? required('SEC_PRE_DOWNLOAD_OUTCOME') : null,
    sutDownloadOutcome: phase === 'post' ? required('SEC_SUT_DOWNLOAD_OUTCOME') : null,
    sutJobResult: phase === 'post' ? required('SEC_SUT_JOB_RESULT') : null
  });
  return facts;
}

/** Import only the two original trusted-base sources. Their import.meta.dir
 * and package/resource resolution must remain rooted in the checked-out base. */
export async function loadTrustedBootstrapNativeModules(trustedRoot: string): Promise<Readonly<{
  tcb: typeof import('./closure-lock.ts');
  registry: typeof import('../contract/root.ts');
}>> {
  const imported = async (repositoryPath: string) => import(pathToFileURL(
    path.join(trustedRoot, ...repositoryPath.split('/'))).href);
  return Object.freeze({
    tcb: await imported('src/adapters/verification/platform/trust/runtime/closure-lock.ts') as typeof import('./closure-lock.ts'),
    registry: await imported('src/adapters/verification/platform/trust/contract/root.ts') as typeof import('../contract/root.ts')
  });
}

export async function loadTrustedBootstrapSutModules(trustedRoot: string): Promise<Readonly<{
  sut: typeof import('../../ci/contract/hosted-sut-observation.ts');
  sutPolicy: typeof import('../../ci/contract/revision.ts');
}>> {
  const imported = async (repositoryPath: string) => import(pathToFileURL(
    path.join(trustedRoot, ...repositoryPath.split('/'))).href);
  return Object.freeze({
    sut: await imported('src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts') as typeof import('../../ci/contract/hosted-sut-observation.ts'),
    sutPolicy: await imported('src/adapters/verification/platform/ci/contract/revision.ts') as typeof import('../../ci/contract/revision.ts')
  });
}

export function trustedBootstrapChangedPaths(facts: TrustedBootstrapSourceFacts): readonly string[] {
  const bytes = trustedBootstrapGitBytes(facts.candidateRoot,
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', '-z', facts.baseSha, facts.headSha]);
  const paths = bytes.toString('utf8').split('\0').filter(Boolean);
  if (paths.some(repositoryPath => !CodexDevelopmentIsCanonicalRepositoryPath(repositoryPath))) {
    throw new Error('Trusted bootstrap changed-path inventory is not canonical.');
  }
  return Object.freeze(paths);
}

export function trustedBootstrapGitBlob(root: string, repositoryPath: string): string {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(repositoryPath)) {
    throw new Error('Trusted bootstrap Git blob path is not canonical.');
  }
  const blob = trustedBootstrapGitBytes(root, ['rev-parse', '--verify', `HEAD:${repositoryPath}`])
    .toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(blob)) throw new Error('Trusted bootstrap Git blob is not exact.');
  return blob;
}

export function readTrustedBootstrapEvidenceFile(root: string, name: string): Uint8Array {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(name) || name.includes('..')) {
    throw new Error('Trusted bootstrap evidence member name is not fixed and ordinary.');
  }
  const parent = inspectNoFollowDirectoryChain(root, 'Trusted bootstrap evidence root');
  const bytes = readNoFollowOrdinaryFile(parent.target, name, { maximumBytes: 32 * 1024 * 1024 });
  if (bytes === null) throw new Error(`Trusted bootstrap evidence member ${name} is absent.`);
  return bytes;
}

function publishTrustedBootstrapJson(facts: TrustedBootstrapExecutionFacts,
  kind: 'receipt' | 'sut-diagnostic', value: object): void {
  const root = kind === 'receipt'
    ? (facts.phase === 'pre' ? facts.evidenceRoot : facts.finalEvidenceRoot)
    : facts.finalEvidenceRoot;
  if (root === null || (kind === 'sut-diagnostic' && facts.phase !== 'post')) {
    throw new Error('Trusted bootstrap JSON publication phase is invalid.');
  }
  const name = kind === 'sut-diagnostic' ? 'sut-diagnostic.json'
    : facts.phase === 'pre' ? 'pre-receipt.json' : 'post-receipt.json';
  if (kind === 'receipt' && facts.receiptPath !== path.join(root, name)) {
    throw new Error('Trusted bootstrap receipt publication slot drifted.');
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const parent = inspectNoFollowDirectoryChain(root, 'Trusted bootstrap publication root');
  publishExclusiveDurableCanonicalFile({ parent: parent.target, name, bytes,
    validate: observed => {
      if (!Buffer.from(observed).equals(bytes)) throw new Error('Trusted bootstrap JSON bytes drifted.');
    } });
  if (!Buffer.from(readTrustedBootstrapEvidenceFile(root, name)).equals(bytes)) {
    throw new Error('Trusted bootstrap JSON readback differs.');
  }
}

/** Capture actual original native stage results. The returned publication
 * method cannot accept a caller-constructed authority claim without every
 * required stage, original result and finalization being observed here. */
export async function createTrustedBootstrapCapture() {
  const facts = readTrustedBootstrapExecutionFacts();
  assertTrustedBootstrapExactGitIdentity(facts);
  const { tcb, registry } = await loadTrustedBootstrapNativeModules(facts.trustedRoot);
  let sutNative: Awaited<ReturnType<typeof loadTrustedBootstrapSutModules>> | null = null;
  type Snapshot = ReturnType<typeof tcb.createTcbClosureCandidateSnapshot>;
  type Action = ReturnType<typeof tcb.compileTcbClosureActionResult>;
  type Demand = ReturnType<typeof tcb.selectTcbClosureCandidateAction>;
  type Registry = ReturnType<typeof registry.parseSecTrustedBootstrapRegistry>;
  const retainAction = (action: Action): Action => {
    const identity = action.identity;
    Object.freeze(identity.modules);
    Object.freeze(identity.reviewedEdges);
    Object.freeze(identity.reviewedBoundaryEdges);
    Object.freeze(identity.reviewedExternalImports);
    Object.freeze(identity.reviewedProcessDispatchers);
    if (identity.reviewedNetworkDispatchers !== undefined) Object.freeze(identity.reviewedNetworkDispatchers);
    Object.freeze(identity.moduleBlobs);
    Object.freeze(identity.moduleContentDigests);
    Object.freeze(identity);
    return action;
  };
  let baseSnapshot!: Snapshot;
  let candidateSnapshot!: Snapshot;
  let baseIssued = false, candidateIssued = false, baseFinalized = false, candidateFinalized = false;
  let baseRegistryBytes: Uint8Array | null = null;
  let candidateRegistryBytes: Uint8Array | null = null;
  let baseRegistry: Registry | null = null;
  let candidateRegistryAttempted = false;
  let candidateRegistryFailure: string | null = null;
  let changedPaths: readonly string[] | null = null;
  let checkerAction: Action | null = null;
  let baseRuntimePaths: readonly string[] | null = null;
  let demand: Demand | null = null;
  let candidateCompileAttempted = false;
  let candidateAction: Action | null = null;
  let candidateCompilationFailure: string | null = null;
  let preReceipt: Record<string, unknown> | null = null;
  let preRead = false;
  let programBytes: Uint8Array | null = null;
  const blobs = new Map<string, string>();
  const sutFiles = new Map<string, Uint8Array>();
  let sutCapability: { source: string; complete: boolean } | null = null;
  let sutLifecycle: { source: string; complete: boolean } | null = null;
  let sutCleanup: { source: string; complete: boolean } | null = null;
  let sutPolicyDigest: `sha256:${string}` | null = null;
  let sutFailure: string | null = null;
  let consumed = false;
  const toolchainRevision = `bun@${Bun.version}:typescript`;
  const providerRevision = 'github-actions-trusted-bootstrap-v1';
  const sameBytes = (left: Uint8Array | null, right: Uint8Array): boolean =>
    left !== null && Buffer.from(left).equals(snapshotByteView(right, 'Trusted bootstrap parser caller bytes'));
  const requireOpen = (): void => {
    if (consumed) throw new Error('Trusted bootstrap native capture is already consumed.');
  };
  const recordSutFailure = (error: unknown): void => {
    if (sutFailure === null) sutFailure = failureMessage(error);
  };
  const ports = Object.freeze({
    createSnapshot(root: 'base' | 'candidate'): Snapshot {
      requireOpen();
      if (root === 'base' ? baseIssued : candidateIssued) throw new Error('Trusted bootstrap snapshot issued twice.');
      const snapshot = tcb.createTcbClosureCandidateSnapshot({
        candidateRoot: root === 'base' ? facts.trustedRoot : facts.candidateRoot
      });
      if (root === 'base') { baseIssued = true; baseSnapshot = snapshot; }
      else { candidateIssued = true; candidateSnapshot = snapshot; }
      return snapshot;
    },
    finalizeSnapshot(snapshot: Snapshot): void {
      requireOpen();
      if (baseIssued && snapshot === baseSnapshot && !baseFinalized) {
        tcb.finalizeTcbClosureCandidateSnapshot(snapshot);
        baseFinalized = true;
      } else if (candidateIssued && snapshot === candidateSnapshot && !candidateFinalized) {
        tcb.finalizeTcbClosureCandidateSnapshot(snapshot);
        candidateFinalized = true;
      } else throw new Error('Trusted bootstrap snapshot finalization has no live issued owner.');
    },
    readRegistry(snapshot: Snapshot): Uint8Array {
      requireOpen();
      if ((snapshot !== baseSnapshot || !baseIssued)
          && (snapshot !== candidateSnapshot || !candidateIssued)) {
        throw new Error('Trusted bootstrap registry read has no issued snapshot.');
      }
      const bytes = snapshotByteView(tcb.readTcbClosureCandidateFile(registry.SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH,
        { candidateSnapshot: snapshot }), 'Trusted bootstrap registry bytes');
      if (snapshot === baseSnapshot) baseRegistryBytes = bytes;
      else candidateRegistryBytes = bytes;
      return snapshotByteView(bytes, 'Trusted bootstrap registry caller bytes');
    },
    parseRegistry(bytes: Uint8Array): Registry {
      requireOpen();
      const base = sameBytes(baseRegistryBytes, bytes);
      const candidate = sameBytes(candidateRegistryBytes, bytes);
      if (!base && !candidate) throw new Error('Trusted bootstrap registry parser has no issued bytes.');
      if (base && baseRegistry === null) {
        const parsed = registry.parseSecTrustedBootstrapRegistry(Buffer.from(baseRegistryBytes!).toString('utf8'));
        baseRegistry = parsed;
        return parsed;
      }
      if (!candidate || candidateRegistryAttempted) {
        throw new Error('Trusted bootstrap candidate registry parse is repeated or unowned.');
      }
      candidateRegistryAttempted = true;
      try {
        return registry.parseSecTrustedBootstrapRegistry(Buffer.from(candidateRegistryBytes!).toString('utf8'));
      } catch (error) {
        candidateRegistryFailure = failureMessage(error);
        throw error;
      }
    },
    changedPaths(): readonly string[] {
      requireOpen();
      if (changedPaths !== null) throw new Error('Trusted bootstrap changed paths observed twice.');
      changedPaths = trustedBootstrapChangedPaths(facts);
      return changedPaths;
    },
    compileChecker(snapshot: Snapshot): Action {
      requireOpen();
      if (facts.phase !== 'pre' || snapshot !== baseSnapshot || baseRegistry === null
          || checkerAction !== null) throw new Error('Trusted bootstrap checker Action stage is unissued.');
      checkerAction = retainAction(tcb.compileTcbClosureActionResult({
        plan: tcb.createTcbClosureActionPlan({
          exactTreeSha: facts.baseTreeSha, registryDigest: facts.registryDigest,
          toolchainRevision, providerRevision
        }), options: { candidateSnapshot: snapshot }
      }));
      return checkerAction;
    },
    baseTrustRuntimePaths(parsed: Registry, checker: Action): readonly string[] {
      requireOpen();
      if (parsed !== baseRegistry || checker !== checkerAction || baseRuntimePaths !== null) {
        throw new Error('Trusted bootstrap base trust root has no original checker result.');
      }
      baseRuntimePaths = registry.createSecTrustedBootstrapTrustRoot({
        registry: parsed, causalRuntimePaths: checker.identity.modules
      }).causalRuntimePaths;
      return baseRuntimePaths;
    },
    selectCandidate(input: Readonly<{ changedPaths: readonly string[]; registry: Registry; checker: Action }>): Demand {
      requireOpen();
      if (input.changedPaths !== changedPaths || input.registry !== baseRegistry
          || input.checker !== checkerAction || baseRuntimePaths === null || demand !== null) {
        throw new Error('Trusted bootstrap candidate demand lacks original base facts.');
      }
      demand = tcb.selectTcbClosureCandidateAction({
        changedPaths: input.changedPaths, exactTreeSha: facts.treeSha,
        registryDigest: facts.registryDigest, toolchainRevision, providerRevision,
        trustedRegistry: input.registry, checkerResult: input.checker
      });
      return demand;
    },
    compileCandidate(plan: NonNullable<Demand['plan']>, snapshot: Snapshot, checker: Action): Action {
      requireOpen();
      if (facts.phase !== 'pre' || snapshot !== candidateSnapshot || checker !== checkerAction
          || demand?.plan !== plan || candidateCompileAttempted) {
        throw new Error('Trusted bootstrap candidate Action stage is unissued.');
      }
      candidateCompileAttempted = true;
      try {
        candidateAction = retainAction(tcb.compileTcbClosureActionResult({
          plan, options: { candidateSnapshot: snapshot }, upstreamResults: [checker]
        }));
        return candidateAction;
      } catch (error) {
        candidateCompilationFailure = failureMessage(error);
        throw error;
      }
    },
    readPreReceipt(): Uint8Array {
      requireOpen();
      if (facts.phase !== 'post' || preRead || baseRegistryBytes === null) {
        throw new Error('Trusted bootstrap PRE read is outside its original POST stage.');
      }
      const bytes = readTrustedBootstrapEvidenceFile(facts.evidenceRoot, 'pre-receipt.json');
      const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
      const program = ports.checkerProgramBytes();
      assertTrustedBootstrapPreReceipt(parsed, { ...facts,
        registryDigest: trustedBootstrapDigest(baseRegistryBytes),
        checkerProgramDigest: trustedBootstrapDigest(program) });
      preRead = true;
      preReceipt = parsed;
      return snapshotByteView(bytes, 'Trusted bootstrap PRE receipt caller bytes');
    },
    readSutFile(name: string): Uint8Array {
      requireOpen();
      if (facts.sutEvidenceRoot === null) throw new Error('SUT evidence is unavailable in PRE.');
      if (sutFiles.has(name)) throw new Error('Trusted bootstrap SUT member was observed twice.');
      try {
        const bytes = snapshotByteView(readTrustedBootstrapEvidenceFile(facts.sutEvidenceRoot, name),
          'Trusted bootstrap SUT member bytes');
        sutFiles.set(name, bytes);
        return snapshotByteView(bytes, 'Trusted bootstrap SUT caller bytes');
      } catch (error) { recordSutFailure(error); throw error; }
    },
    async prepareSut(): Promise<void> {
      requireOpen();
      if (facts.phase !== 'post') throw new Error('SUT native contract is unavailable in PRE.');
      try { sutNative = await loadTrustedBootstrapSutModules(facts.trustedRoot); }
      catch (error) { recordSutFailure(error); throw error; }
    },
    parseSutCapability(value: unknown): boolean {
      requireOpen();
      if (sutNative === null) throw new Error('SUT capability parser has no original module.');
      if (sutCapability !== null) throw new Error('SUT capability was parsed twice.');
      try {
        const complete = sutNative.sut.hostedSutCapabilityComplete(sutNative.sut.parseHostedSutCapabilityObservation(value));
        sutCapability = { source: JSON.stringify(value), complete };
        return complete;
      } catch (error) { recordSutFailure(error); throw error; }
    },
    parseSutLifecycle(value: unknown): boolean {
      requireOpen();
      if (sutNative === null) throw new Error('SUT lifecycle parser has no original module.');
      if (sutLifecycle !== null) throw new Error('SUT lifecycle was parsed twice.');
      try {
        const complete = sutNative.sut.hostedSutLifecycleComplete(sutNative.sut.parseHostedSutLifecycle(value));
        sutLifecycle = { source: JSON.stringify(value), complete };
        return complete;
      } catch (error) { recordSutFailure(error); throw error; }
    },
    parseSutCleanup(value: unknown): boolean {
      requireOpen();
      if (sutNative === null) throw new Error('SUT cleanup parser has no original module.');
      if (sutCleanup !== null) throw new Error('SUT cleanup was parsed twice.');
      try {
        const complete = sutNative.sut.hostedSutCleanupComplete(sutNative.sut.parseHostedSutCleanup(value));
        sutCleanup = { source: JSON.stringify(value), complete };
        return complete;
      } catch (error) { recordSutFailure(error); throw error; }
    },
    sandboxPolicyDigest(): `sha256:${string}` {
      requireOpen();
      if (sutNative === null) throw new Error('SUT sandbox policy has no original module.');
      try {
        sutPolicyDigest = sutNative.sutPolicy.CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST;
        return sutPolicyDigest;
      } catch (error) { recordSutFailure(error); throw error; }
    },
    checkerProgramBytes(): Uint8Array {
      requireOpen();
      const expected = path.join(facts.evidenceRoot, 'checker.mjs');
      if (import.meta.path !== expected) throw new Error('Trusted bootstrap executable is not the PRE checker artifact.');
      const bytes = snapshotByteView(readTrustedBootstrapEvidenceFile(facts.evidenceRoot, 'checker.mjs'),
        'Trusted bootstrap program bytes');
      if (programBytes !== null && !Buffer.from(programBytes).equals(bytes)) {
        throw new Error('Trusted bootstrap checker program changed within one execution.');
      }
      programBytes = bytes;
      return snapshotByteView(bytes, 'Trusted bootstrap program caller bytes');
    },
    gitBlob(root: 'base' | 'candidate', repositoryPath: string): string {
      requireOpen();
      const key = `${root}:${repositoryPath}`;
      if (blobs.has(key)) throw new Error('Trusted bootstrap Git blob observed twice.');
      const value = trustedBootstrapGitBlob(root === 'base' ? facts.trustedRoot : facts.candidateRoot,
        repositoryPath);
      blobs.set(key, value);
      return value;
    },
    assertExactIdentity(): void {
      requireOpen();
      assertTrustedBootstrapExactGitIdentity(facts);
    }
  });
  const publish = (prepared: Readonly<{
    receipt: Readonly<Record<string, unknown>>;
    diagnostic: Readonly<Record<string, unknown>> | null;
  }>): Readonly<Record<string, unknown>> => {
    requireOpen();
    if (!baseIssued || !candidateIssued || !baseFinalized || !candidateFinalized
        || baseRegistryBytes === null || candidateRegistryBytes === null || baseRegistry === null
        || changedPaths === null || programBytes === null) {
      throw new Error('Trusted bootstrap publication lacks an issued and finalized source census.');
    }
    const preparedFields = readVerificationDataRecord(prepared, 'Trusted bootstrap prepared publication');
    assertTrustedBootstrapExactKeys(preparedFields, ['receipt', 'diagnostic'],
      'trusted bootstrap prepared publication');
    const receiptFields = readVerificationDataRecord(preparedFields.receipt, 'Trusted bootstrap prepared receipt');
    assertTrustedBootstrapExactKeys(receiptFields,
      [...TRUSTED_BOOTSTRAP_CHECKER_RECEIPT_FIELDS, 'receiptDigest'], 'trusted bootstrap prepared receipt');
    const diagnosticFields = preparedFields.diagnostic === null ? null
      : readVerificationDataRecord(preparedFields.diagnostic, 'Trusted bootstrap prepared diagnostic');
    if (diagnosticFields !== null) assertTrustedBootstrapExactKeys(diagnosticFields, [
      'schema', 'baseSha', 'headSha', 'treeSha', 'jobResult', 'downloadOutcome',
      'auxiliaryStatus', 'auxiliaryReason', 'evidenceSetDigest', 'candidateReceiptDigest',
      'receiptDigest'
    ], 'trusted bootstrap prepared diagnostic');
    let capturedTextBytes = 0;
    const boundedScalar = (value: unknown): void => {
      if (typeof value === 'string') capturedTextBytes += Buffer.byteLength(value, 'utf8');
      else if (value !== null && typeof value !== 'boolean'
          && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('Trusted bootstrap prepared publication contains a non-scalar field.');
      }
      if (capturedTextBytes > 32 * 1024 * 1024) {
        throw new Error('Trusted bootstrap prepared publication exceeds its evidence byte bound.');
      }
    };
    const paths = receiptFields.baseUndecidablePaths;
    if (isProxy(paths) || !Array.isArray(paths) || paths.length > changedPaths.length) {
      throw new Error('Trusted bootstrap prepared path inventory exceeds the native changed-path census.');
    }
    for (let index = 0; index < paths.length; index += 1) {
      const element = Object.getOwnPropertyDescriptor(paths, String(index));
      if (!element || !Object.prototype.hasOwnProperty.call(element, 'value')
          || !element.enumerable || typeof element.value !== 'string') {
        throw new Error('Trusted bootstrap prepared path inventory contains a non-data path.');
      }
      boundedScalar(element.value);
    }
    for (const [key, value] of Object.entries(receiptFields)) {
      if (key !== 'baseUndecidablePaths') boundedScalar(value);
    }
    for (const value of Object.values(diagnosticFields ?? {})) boundedScalar(value);
    const preparedSnapshot = snapshotVerificationData(preparedFields, 'Trusted bootstrap prepared publication');
    assertTrustedBootstrapExactKeys(preparedSnapshot, ['receipt', 'diagnostic'],
      'trusted bootstrap prepared publication');
    const receipt = preparedSnapshot.receipt;
    const diagnostic = preparedSnapshot.diagnostic;
    const baseRegistryDigest = trustedBootstrapDigest(baseRegistryBytes);
    const candidateRegistryDigest = trustedBootstrapDigest(candidateRegistryBytes);
    if (baseRegistryDigest !== facts.registryDigest) throw new Error('Trusted bootstrap base registry drifted before publication.');
    const requiredBlobs = [
      'base:src/adapters/verification/platform/trust/runtime/closure-lock.ts',
      'base:.github/workflows/trusted-bootstrap.yml',
      'candidate:src/adapters/verification/platform/trust/runtime/closure-lock.ts',
      'candidate:.github/workflows/trusted-bootstrap.yml'
    ];
    if (blobs.size !== requiredBlobs.length || requiredBlobs.some(key => !blobs.has(key))) {
      throw new Error('Trusted bootstrap publication lacks its four exact Git blobs.');
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
    if (facts.phase === 'pre') {
      if (preRead || checkerAction === null || baseRuntimePaths === null || demand === null
          || !candidateRegistryAttempted
          || (demand.plan !== null && !candidateCompileAttempted)
          || (demand.plan === null && candidateCompileAttempted)) {
        throw new Error('Trusted bootstrap PRE publication skipped or mixed one original Action stage.');
      }
      const authority = deriveTrustedBootstrapAuthority({
        impactedPaths: demand.impactedPaths, candidateRegistryFailure,
        candidateRegistryDigestMatches: baseRegistryDigest === candidateRegistryDigest,
        candidateCompilationFailure,
        candidateCausalClosureMatches: candidateAction === null ? null
          : JSON.stringify(candidateAction.identity.modules) === JSON.stringify(baseRuntimePaths)
      });
      checkerActionKey = checkerAction.actionKey;
      checkerActionResultDigest = checkerAction.resultDigest;
      checkerClosureDigest = checkerAction.identity.closureDigest;
      candidateActionKey = candidateAction?.actionKey ?? null;
      candidateActionResultDigest = candidateAction?.resultDigest ?? null;
      candidateClosureDigest = candidateAction?.identity.closureDigest ?? null;
      candidateTrustRevision = candidateAction?.identity.trustRevision ?? null;
      candidateModuleCount = candidateAction?.identity.moduleCount ?? null;
      baseUndecidablePaths = demand.impactedPaths;
      authorityVerdict = authority.verdict;
      authorityReason = authority.reason;
      if (diagnostic !== null) throw new Error('Trusted bootstrap PRE cannot publish SUT diagnostics.');
    } else {
      if (!preRead || preReceipt === null || checkerAction !== null || demand !== null
          || candidateCompileAttempted || candidateRegistryAttempted) {
        throw new Error('Trusted bootstrap POST publication did not reuse one original PRE receipt.');
      }
      checkerActionKey = preReceipt.checkerActionKey;
      checkerActionResultDigest = preReceipt.checkerActionResultDigest;
      checkerClosureDigest = preReceipt.checkerClosureDigest;
      candidateActionKey = preReceipt.candidateActionKey;
      candidateActionResultDigest = preReceipt.candidateActionResultDigest;
      candidateClosureDigest = preReceipt.candidateClosureDigest;
      candidateTrustRevision = preReceipt.candidateTrustRevision;
      candidateModuleCount = preReceipt.candidateModuleCount;
      baseUndecidablePaths = preReceipt.baseUndecidablePaths;
      authorityVerdict = preReceipt.authorityVerdict;
      authorityReason = preReceipt.authorityReason;
      assertTrustedBootstrapExactKeys(diagnostic, [
        'schema', 'baseSha', 'headSha', 'treeSha', 'jobResult', 'downloadOutcome',
        'auxiliaryStatus', 'auxiliaryReason', 'evidenceSetDigest', 'candidateReceiptDigest',
        'receiptDigest'
      ], 'trusted bootstrap POST diagnostic');
      if (diagnostic.schema !== 'sec-trusted-bootstrap-sut-diagnostic-v1'
          || diagnostic.baseSha !== facts.baseSha || diagnostic.headSha !== facts.headSha
          || diagnostic.treeSha !== facts.treeSha || diagnostic.jobResult !== facts.sutJobResult
          || diagnostic.downloadOutcome !== facts.sutDownloadOutcome) {
        throw new Error('Trusted bootstrap POST diagnostic lacks its original source identity.');
      }
      if (facts.sutDownloadOutcome !== 'success') {
        if (diagnostic.auxiliaryStatus !== 'unavailable'
            || diagnostic.auxiliaryReason !== 'candidate-sut-artifact-unavailable'
            || diagnostic.evidenceSetDigest !== null
            || diagnostic.candidateReceiptDigest !== null
            || sutFiles.size !== 0) {
          throw new Error('Trusted bootstrap unavailable SUT diagnostic differs from native observations.');
        }
      } else if (diagnostic.auxiliaryStatus === 'passed'
          || diagnostic.auxiliaryStatus === 'failed') {
        if (sutFiles.size !== TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.length + 2
            || !sutFiles.has('SHA256SUMS') || !sutFiles.has('sut-receipt.json')
            || TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.some(name => !sutFiles.has(name))
            || sutCapability === null || sutLifecycle === null || sutCleanup === null
            || sutPolicyDigest === null) {
          throw new Error('Trusted bootstrap passing SUT diagnostic skips an original native observation.');
        }
        const sutReceipt: unknown = JSON.parse(Buffer.from(sutFiles.get('sut-receipt.json')!).toString('utf8'));
        if (sutReceipt === null || typeof sutReceipt !== 'object' || Array.isArray(sutReceipt)
            || JSON.stringify((sutReceipt as Record<string, unknown>).capability) !== sutCapability.source
            || JSON.stringify((sutReceipt as Record<string, unknown>).executionLifecycle) !== sutLifecycle.source
            || JSON.stringify((sutReceipt as Record<string, unknown>).cleanup) !== sutCleanup.source) {
          throw new Error('Trusted bootstrap SUT parser inputs differ from the captured artifact.');
        }
        const verified = evaluateTrustedBootstrapSutEvidence({ ...facts,
          jobResult: facts.sutJobResult!, files: sutFiles,
          capabilityComplete: sutCapability.complete, lifecycleComplete: sutLifecycle.complete,
          cleanupComplete: sutCleanup.complete, sandboxPolicyDigest: sutPolicyDigest });
        if (diagnostic.auxiliaryStatus !== verified.auxiliaryStatus
            || diagnostic.auxiliaryReason !== verified.auxiliaryReason
            || diagnostic.evidenceSetDigest !== verified.evidenceSetDigest
            || diagnostic.candidateReceiptDigest !== verified.candidateReceiptDigest) {
          throw new Error('Trusted bootstrap SUT diagnostic differs from captured native evidence.');
        }
      } else if (diagnostic.auxiliaryStatus !== 'invalid'
          || typeof diagnostic.auxiliaryReason !== 'string'
          || !diagnostic.auxiliaryReason.startsWith('candidate-sut-artifact-invalid:')
          || diagnostic.evidenceSetDigest !== null
          || diagnostic.candidateReceiptDigest !== null) {
        throw new Error('Trusted bootstrap invalid SUT diagnostic is not bounded.');
      } else {
        let observedFailure = sutFailure;
        if (observedFailure === null) {
          try {
            evaluateTrustedBootstrapSutEvidence({ ...facts, jobResult: facts.sutJobResult!, files: sutFiles,
              capabilityComplete: sutCapability?.complete ?? false,
              lifecycleComplete: sutLifecycle?.complete ?? false,
              cleanupComplete: sutCleanup?.complete ?? false,
              sandboxPolicyDigest: sutPolicyDigest ?? facts.registryDigest });
          } catch (error) { observedFailure = failureMessage(error); }
        }
        if (observedFailure === null
            || diagnostic.auxiliaryReason !== `candidate-sut-artifact-invalid:${observedFailure}`) {
          throw new Error('Trusted bootstrap invalid SUT diagnostic has no matching native failure.');
        }
      }
    }
    const auxiliaryStatus = facts.phase === 'pre' ? 'not-observed' : diagnostic!.auxiliaryStatus;
    const sutEvidenceDigest = facts.phase === 'pre' ? null : diagnostic!.evidenceSetDigest;
    const sutJobResult = facts.phase === 'pre' ? null : facts.sutJobResult;
    const sutDiagnosticDigest = facts.phase === 'pre' ? null
      : trustedBootstrapJsonDigest((({ receiptDigest: _digest, ...rest }) => rest)(diagnostic!));
    if (facts.phase === 'post' && diagnostic!.receiptDigest !== sutDiagnosticDigest) {
      throw new Error('Trusted bootstrap SUT diagnostic digest differs.');
    }
    const semantic = {
      schema: 'sec-trusted-bootstrap-checker-receipt-v1', phase: facts.phase,
      checkerBaseSha: facts.baseSha, baseTreeSha: facts.baseTreeSha,
      candidateHeadSha: facts.headSha, candidateTreeSha: facts.treeSha,
      candidateParentSha: facts.baseSha, registryDigest: baseRegistryDigest,
      checkerActionKey, checkerActionResultDigest, checkerClosureDigest,
      candidateActionKey, candidateActionResultDigest, candidateClosureDigest,
      candidateTrustRevision, candidateModuleCount,
      checkerProgramDigest: trustedBootstrapDigest(programBytes),
      checkerToolBlob: blobs.get(requiredBlobs[0]!), checkerWorkflowBlob: blobs.get(requiredBlobs[1]!),
      candidateToolBlob: blobs.get(requiredBlobs[2]!), candidateWorkflowBlob: blobs.get(requiredBlobs[3]!),
      authorityVerdict, authorityReason, baseUndecidablePaths,
      auxiliaryStatus, sutEvidenceDigest, sutJobResult, sutDiagnosticDigest
    };
    const expected = prepareTrustedBootstrapCheckerReceipt(semantic);
    assertTrustedBootstrapPreparedReceipt(receipt, expected);
    if (preReceipt !== null) assertTrustedBootstrapStableReceipt(preReceipt, expected);
    assertTrustedBootstrapExactGitIdentity(facts);
    const finalProgram = readTrustedBootstrapEvidenceFile(facts.evidenceRoot, 'checker.mjs');
    if (!Buffer.from(finalProgram).equals(programBytes)) {
      throw new Error('Trusted bootstrap program bytes changed before publication.');
    }
    consumed = true;
    if (diagnostic !== null) publishTrustedBootstrapJson(facts, 'sut-diagnostic', diagnostic);
    publishTrustedBootstrapJson(facts, 'receipt', expected);
    return expected;
  };
  return Object.freeze({ facts, ports, publish });
}
