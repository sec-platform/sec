import { failureMessage } from '../contracts/failure-inspection.ts';
import { settleResources, type ResourceSettlementFailure } from '../execution/resource-settlement.ts';
import type { CiVerificationActionPlanClosure, CiVerificationNormalizedOperation, VerificationActionKeyDigest, VerificationActionPlan } from '../execution/verification/action.ts';
import type { HostedActionExecutionTicket, HostedActionRawResult, HostedActionResolution, HostedSutCapabilityObservation, HostedSutCleanupObservation, HostedSutCommandPlan, HostedSutExecutionAuthorization, HostedSutInventory, HostedSutProcessLifecycle, HostedSutProcessObservation, HostedSutSandboxReceipt, PreparedTrustedBootstrapSutInputs } from '../execution/verification/hosted.ts';

export type HostedSutCapabilityResult = HostedSutCapabilityObservation & Readonly<{
  state: 'supported' | 'unsupported' | 'invalidated' | 'unknown';
}>;

/** One supervisor lifetime serves the entire probe/execution/teardown flow.
 * Each effect and retained resource still belongs to its actual native owner. */
export interface HostedSutPorts<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  ProviderOrigin extends object,
  ResolutionSchema extends string,
  TicketSchema extends string,
  AuthorizationSchema extends string,
  PhysicalSchema extends string,
  ProviderRevision extends string,
  ReceiptSchema extends string,
  RawResultSchema extends string,
  CommandSchema extends string,
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>,
  RetainedArchive extends Readonly<{ archiveDigest: VerificationActionKeyDigest }>
> {
  readonly platform: string;
  readonly bunExecutable: string;
  readonly unitNonce: string;
  readonly outputByteLimit: number;
  readonly capabilityMarker: string;
  readonly unsupportedDiagnostic: string;
  now(): Date;
  digest(value: unknown): VerificationActionKeyDigest;
  encodeData(value: unknown): string;
  parseResolution(source: string): HostedActionResolution<Environment, ResolutionSchema>;
  parseTicket(source: string): HostedActionExecutionTicket<ProviderOrigin, TicketSchema>;
  createAuthorization(input: Readonly<{
    resolutionDigest: VerificationActionKeyDigest; ticketDigest: VerificationActionKeyDigest;
    actionPlan: VerificationActionPlan; normalizedOperation: CiVerificationNormalizedOperation;
    candidateSha: string; candidateBytesDigest: VerificationActionKeyDigest;
    manifestPath: string; inventoryClosure: HostedSutInventory; producer: ProviderOrigin;
  }>): HostedSutExecutionAuthorization<AuthorizationSchema, Environment, PhysicalSchema, Policy, VerificationActionKeyDigest, ProviderOrigin, ProviderRevision>;
  candidateEnvironment(input: Readonly<{ normalizedOperation: CiVerificationNormalizedOperation; manifestPath: string }>): Readonly<Record<string, string>>;
  createCapabilityPlan(input: Readonly<{
    actionKey: VerificationActionKeyDigest; bunExecutable: string; unitNonce: string;
    executionAuthorization?: HostedSutExecutionAuthorization<AuthorizationSchema, Environment, PhysicalSchema, Policy, VerificationActionKeyDigest, ProviderOrigin, ProviderRevision>;
  }>): HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  createTeardownPlan(input: Readonly<{ actionKey: VerificationActionKeyDigest; unitName: string }>): HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  createExecutionPlan(input: Readonly<{
    actionKey: VerificationActionKeyDigest; candidateArchiveDigest: VerificationActionKeyDigest;
    bunExecutable: string; baseSha: string; headSha: string;
    normalizedArgv: readonly string[]; candidateEnvironment: Readonly<Record<string, string>>;
    executionAuthorization: HostedSutExecutionAuthorization<AuthorizationSchema, Environment, PhysicalSchema, Policy, VerificationActionKeyDigest, ProviderOrigin, ProviderRevision>;
  }>): HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  normalizedArgv(operation: CiVerificationNormalizedOperation): readonly string[];
  resolveAuthorizedOperation(input: Readonly<{ plan: VerificationActionPlan; authorizedClosure: CiVerificationActionPlanClosure }>): CiVerificationNormalizedOperation;
  run(plan: HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>, archive?: RetainedArchive): Promise<HostedSutProcessObservation<ProcessResult>>;
  unobservedProcess(code: number, diagnostic: string): HostedSutProcessObservation<ProcessResult>;
  lifecycleComplete(lifecycle: HostedSutProcessLifecycle): boolean;
  cleanupComplete(cleanup: HostedSutCleanupObservation): boolean;
  failureTail(value: string, fallback: string): string;
  resolveArchive(source: string): string;
  retainArchive(source: string, digest: VerificationActionKeyDigest): RetainedArchive;
  assertArchive(archive: RetainedArchive): VerificationActionKeyDigest;
  pathDigest(source: string): VerificationActionKeyDigest;
  closeArchive(archive: RetainedArchive): void;
  rootIsolation(environmentNames: readonly string[]): HostedSutSandboxReceipt<Policy, VerificationActionKeyDigest, ReceiptSchema>['rootIsolation'];
  finalizeReceipt(input: Omit<HostedSutSandboxReceipt<Policy, VerificationActionKeyDigest, ReceiptSchema>, 'schema' | 'policyDigest' | 'resources' | 'receiptDigest'>): HostedSutSandboxReceipt<Policy, VerificationActionKeyDigest, ReceiptSchema>;
  finalizeRawResult(input: Omit<HostedActionRawResult<Policy, VerificationActionKeyDigest, RawResultSchema, ReceiptSchema>, 'schema' | 'rawResultDigest'>): HostedActionRawResult<Policy, VerificationActionKeyDigest, RawResultSchema, ReceiptSchema>;
}

export async function executeTrustedBootstrapSut<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>, ProviderOrigin extends object,
  ResolutionSchema extends string, TicketSchema extends string, AuthorizationSchema extends string,
  PhysicalSchema extends string, ProviderRevision extends string, ReceiptSchema extends string,
  RawResultSchema extends string, CommandSchema extends string,
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>,
  RetainedArchive extends Readonly<{ archiveDigest: VerificationActionKeyDigest }>
>(input: TrustedBootstrapSutInput, ports: HostedSutPorts<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive> & Readonly<{
  sandboxPolicyDigest: VerificationActionKeyDigest;
  prepareEvidenceRoot(): void;
  prepareBootstrap(input: TrustedBootstrapSutInput): PreparedTrustedBootstrapSutInputs;
  bootstrapEnvironment(input: TrustedBootstrapSutInput): Readonly<Record<string, string>>;
  createBootstrapPlan(input: Readonly<{ bootstrapDigest: VerificationActionKeyDigest;
    candidateArchiveDigest: VerificationActionKeyDigest; bunExecutable: string;
    baseSha: string; headSha: string; candidateEnvironment: Readonly<Record<string, string>>;
    unitNonce: string }>): HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  writeEvidenceMember(name: string, value: unknown): void;
  evidenceMemberByteDigest(name: string): string;
  writeEvidenceText(name: string, source: string): void;
  byteDigest(source: string): VerificationActionKeyDigest;
  retireBootstrapInputs(prepared: PreparedTrustedBootstrapSutInputs | undefined): void;
}>): Promise<Readonly<{ status: 'passed' | 'failed'; bootstrapDigest: VerificationActionKeyDigest;
  receiptDigest: VerificationActionKeyDigest }>> {
  input = JSON.parse(ports.encodeData(input)) as TrustedBootstrapSutInput;
  const expectedKeys = ['baseRoot', 'baseSha', 'candidateRoot', 'headSha', 'manifestPath', 'outputDirectory', 'treeSha'];
  if (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join('\n') !== expectedKeys.join('\n')
      || expectedKeys.some(key => typeof (input as unknown as Record<string, unknown>)[key] !== 'string')
      || ![input.baseSha, input.headSha, input.treeSha].every(sha => /^[0-9a-f]{40}$/u.test(sha))) {
    throw new Error('Trusted bootstrap SUT input identity is invalid.');
  }
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(input.manifestPath)) {
    throw new Error('Trusted bootstrap SUT manifest path is invalid.');
  }
  const capability = await probeHostedSutCapability<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive>({
    actionKey: ports.digest({ baseSha: input.baseSha, headSha: input.headSha,
      treeSha: input.treeSha, manifestPath: input.manifestPath,
      sandboxPolicyDigest: ports.sandboxPolicyDigest })
  }, ports);
  if (capability.state !== 'supported') {
    throw new Error(`Trusted bootstrap SUT cannot start: ${capability.diagnostic ?? capability.state}`);
  }
  let prepared: PreparedTrustedBootstrapSutInputs | undefined;
  let archive: RetainedArchive | undefined;
  let primary: ResourceSettlementFailure | undefined;
  let processFailures: readonly ResourceSettlementFailure[] = [];
  try {
    ports.prepareEvidenceRoot();
    prepared = ports.prepareBootstrap(input);
    const bootstrapDigest = ports.digest(Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-operation-v1',
      baseSha: input.baseSha, headSha: input.headSha, treeSha: input.treeSha,
      manifestPath: input.manifestPath, archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      dependencyMaterialization: prepared.dependencyMaterialization,
      dependencyArchiveProjection: prepared.dependencyArchiveProjection,
      sandboxPolicyDigest: ports.sandboxPolicyDigest
    }));
    const environment = ports.bootstrapEnvironment(input);
    archive = ports.retainArchive(prepared.preparedCandidateArchive, prepared.archiveDigest);
    const plan = ports.createBootstrapPlan({ bootstrapDigest,
      candidateArchiveDigest: archive.archiveDigest, bunExecutable: ports.bunExecutable,
      baseSha: input.baseSha, headSha: input.headSha,
      candidateEnvironment: environment, unitNonce: ports.unitNonce });
    const teardownPlan = ports.createTeardownPlan({ actionKey: bootstrapDigest, unitName: plan.unitName });
    const [execution, teardown, observationLost, rawProcessFailures] = await observeSutAttemptAndTeardown({
      execution: plan, teardown: teardownPlan, archive,
      run: (command, retained) => ports.run(command, retained),
      unobserved: (code, diagnostic) => ports.unobservedProcess(code, diagnostic)
    });
    processFailures = rawProcessFailures;
    let archiveStable = false;
    let archiveFailure: string | undefined;
    try {
      archiveStable = ports.assertArchive(archive) === prepared.archiveDigest
        && ports.pathDigest(prepared.preparedCandidateArchive) === prepared.archiveDigest;
    } catch (error) { archiveFailure = failureMessage(error); }
    let summary: Record<string, unknown> | undefined;
    try {
      const decoded: unknown = JSON.parse(execution.failureTail);
      if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
        summary = decoded as Record<string, unknown>;
      }
    } catch { /* Missing or malformed raw output cannot establish a passed summary. */ }
    const results = Array.isArray(summary?.results) ? summary.results.filter(
      (value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
    ) : [];
    const byLabel = new Map(results.filter(value => typeof value.label === 'string')
      .map(value => [value.label as string, value]));
    for (const [name, label] of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS) {
      ports.writeEvidenceMember(name, Object.freeze({
        schema: 'sec-trusted-bootstrap-sandbox-step-observation-v1', bootstrapDigest,
        sandboxPolicyDigest: ports.sandboxPolicyDigest, label,
        observation: byLabel.get(label) ?? null
      }));
    }
    const sumsSource = TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS.map(([name]) =>
      `${ports.evidenceMemberByteDigest(name)}  ${name}`).join('\n') + '\n';
    ports.writeEvidenceText('SHA256SUMS', sumsSource);
    const cleanup = directoryCleanup(teardown);
    const summaryIdentityPassed = summary?.schema === 'sec-trusted-bootstrap-sandbox-summary-v1'
      && summary.baseSha === input.baseSha && summary.headSha === input.headSha
      && summary.treeSha === input.treeSha && summary.parentSha === input.baseSha;
    const status = !observationLost && ports.lifecycleComplete(execution.lifecycle)
      && execution.code === 0 && !execution.outputTruncated
      && execution.stdoutBytesObserved <= ports.outputByteLimit
      && execution.stderrBytesObserved <= ports.outputByteLimit
      && ports.cleanupComplete(cleanup) && archiveStable
      && summaryIdentityPassed && summary?.status === 'passed' ? 'passed' as const : 'failed' as const;
    const semantic = Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-receipt-v3',
      baseSha: input.baseSha, headSha: input.headSha, treeSha: input.treeSha,
      parentSha: input.baseSha, auxiliaryStatus: status,
      evidenceSetDigest: ports.byteDigest(sumsSource), bootstrapDigest,
      sandboxPolicyDigest: ports.sandboxPolicyDigest, commandPlanDigest: plan.planDigest,
      archiveDigest: prepared.archiveDigest, archiveInventoryDigest: prepared.archiveInventoryDigest,
      executionOutputDigest: execution.rawOutputDigest, capability: capabilityReceipt(capability),
      executionLifecycle: execution.lifecycle, cleanup
    });
    const receiptDigest = ports.byteDigest(JSON.stringify(semantic));
    ports.writeEvidenceText('sut-receipt.json', JSON.stringify({ ...semantic, receiptDigest }, null, 2) + '\n');
    if (status !== 'passed' && processFailures.length === 0) {
      const diagnostic = typeof summary?.diagnostic === 'string' ? summary.diagnostic
        : archiveFailure ?? capability.diagnostic ?? execution.failureTail;
      throw new Error(boundedSutDiagnostic(diagnostic,
        'Trusted bootstrap candidate SUT failed inside the private sandbox.', ports.failureTail));
    }
    return Object.freeze({ status, bootstrapDigest, receiptDigest });
  } catch (error) {
    primary = { label: 'Trusted bootstrap SUT execution', error };
    throw error;
  } finally {
    const retained = archive;
    const inputs = prepared;
    const bodyFailure = primary;
    settleResources({ primary: processFailures[0] ?? primary, cleanup: [
      ...processFailures.slice(1).map(failure => ({ label: failure.label,
        settle: () => { throw failure.error; } })),
      ...(processFailures.length === 0 || bodyFailure === undefined ? [] : [{ label: bodyFailure.label,
        settle: () => { throw bodyFailure.error; } }]),
      ...(retained === undefined ? [] : [{ label: 'Trusted bootstrap retained archive closeout',
        settle: () => ports.closeArchive(retained) }]),
      { label: 'Trusted bootstrap prepared inputs retirement',
        settle: () => ports.retireBootstrapInputs(inputs) }
    ] });
  }
}

export interface TrustedBootstrapSutInput {
  readonly baseRoot: string;
  readonly candidateRoot: string;
  readonly outputDirectory: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly manifestPath: string;
}

export const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_MEMBERS = Object.freeze([
  ['tcb-lock-pre.json', 'tcb-lock-pre'], ['imports.log', 'imports'],
  ['docs-doctor.log', 'docs-doctor'], ['typecheck.log', 'typecheck'],
  ['diff-check.log', 'diff-check'], ['focused-tests.log', 'focused-tests'],
  ['repository-audit.json', 'repository-audit'], ['affected-plan.json', 'affected-plan'],
  ['affected-tests.log', 'affected-tests'], ['tcb-lock-post.json', 'tcb-lock-post']
] as const);

const NOT_ATTEMPTED: HostedSutProcessLifecycle = Object.freeze({
  supervisorSpawned: false, supervisorClosed: false, supervisorCloseCode: null, supervisorSignal: null,
  namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: null,
  observationGap: null
});

function directoryCleanup(observed: HostedSutProcessObservation<Readonly<{ code: number; rawOutputDigest: string; failureTail: string }>>): HostedSutCleanupObservation {
  return Object.freeze({
    supervisorSpawned: observed.lifecycle.supervisorSpawned,
    supervisorClosed: observed.lifecycle.supervisorClosed,
    exitCode: observed.lifecycle.supervisorClosed === true &&
      observed.lifecycle.supervisorCloseCode !== null && observed.lifecycle.supervisorCloseCode >= 0
      ? observed.lifecycle.supervisorCloseCode : null,
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest
  });
}

function cleanupNotAttempted(digest: (value: unknown) => VerificationActionKeyDigest): HostedSutCleanupObservation {
  return Object.freeze({
    supervisorSpawned: false, supervisorClosed: false, exitCode: null,
    outputDigest: digest('directory-cleanup-not-attempted')
  });
}

function capabilityReceipt(capability: HostedSutCapabilityResult): HostedSutCapabilityObservation {
  const { state: ignoredState, ...receipt } = capability;
  void ignoredState;
  return Object.freeze(receipt);
}

function inventoryFromTicket<Producer extends object, Schema extends string>(ticket: HostedActionExecutionTicket<Producer, Schema>): HostedSutInventory {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}

function boundedSutDiagnostic(value: string, fallback: string, failureTail: (value: string, fallback: string) => string): string {
  const bounded = failureTail(value, fallback);
  const escaped = bounded.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
  );
  return failureTail(escaped, fallback);
}

/** A process attempt and its teardown share one application lifetime. An
 * unrenderable failure must not prevent the original teardown Effect. */
async function observeSutAttemptAndTeardown<CommandSchema extends string,
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; failureTail: string }>,
  RetainedArchive>(input: Readonly<{
  execution: HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  teardown: HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>;
  archive?: RetainedArchive;
  run(plan: HostedSutCommandPlan<CommandSchema, VerificationActionKeyDigest>, archive?: RetainedArchive): Promise<HostedSutProcessObservation<ProcessResult>>;
  unobserved(code: number, diagnostic: string): HostedSutProcessObservation<ProcessResult>;
}>): Promise<readonly [HostedSutProcessObservation<ProcessResult>, HostedSutProcessObservation<ProcessResult>, boolean, readonly ResourceSettlementFailure[]]> {
  const failures: ResourceSettlementFailure[] = [];
  const rawProcessFailures: ResourceSettlementFailure[] = [];
  let observed: HostedSutProcessObservation<ProcessResult> | undefined;
  let teardown: HostedSutProcessObservation<ProcessResult> | undefined;
  let executionObservationLost = false;
  try { observed = await input.run(input.execution, input.archive); }
  catch (error) {
    executionObservationLost = true;
    rawProcessFailures.push({ label: 'Hosted SUT original execution', error });
    try { observed = input.unobserved(1, failureMessage(error)); }
    catch (presentationError) {
      failures.push({ label: 'Hosted SUT original execution', error });
      failures.push({ label: 'Hosted SUT execution observation', error: presentationError });
    }
  }
  try { teardown = await input.run(input.teardown); }
  catch (error) {
    rawProcessFailures.push({ label: 'Hosted SUT original teardown', error });
    try { teardown = input.unobserved(1, failureMessage(error)); }
    catch (presentationError) {
      failures.push({ label: 'Hosted SUT original teardown', error });
      failures.push({ label: 'Hosted SUT teardown observation', error: presentationError });
    }
  }
  if (failures.length !== 0) {
    settleResources({ primary: failures[0], cleanup: failures.slice(1).map(failure => ({
      label: failure.label, settle: () => { throw failure.error; }
    })) });
  }
  if (observed === undefined || teardown === undefined) throw new Error('Hosted SUT attempt lost its process observations.');
  return Object.freeze([observed, teardown, executionObservationLost, Object.freeze(rawProcessFailures)] as const);
}

export async function probeHostedSutCapability<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  ProviderOrigin extends object,
  ResolutionSchema extends string,
  TicketSchema extends string,
  AuthorizationSchema extends string,
  PhysicalSchema extends string,
  ProviderRevision extends string,
  ReceiptSchema extends string,
  RawResultSchema extends string,
  CommandSchema extends string,
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>,
  RetainedArchive extends Readonly<{ archiveDigest: VerificationActionKeyDigest }>
>(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionAuthorization?: HostedSutExecutionAuthorization<AuthorizationSchema, Environment, PhysicalSchema, Policy, VerificationActionKeyDigest, ProviderOrigin, ProviderRevision>;
}>, ports: HostedSutPorts<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive>): Promise<HostedSutCapabilityResult> {
  if (ports.platform !== 'linux') {
    const reason = 'Hosted SUT sandbox requires the native ubuntu-24.04 Linux runner.';
    return Object.freeze({
      state: 'unsupported', commandPlanDigest: null,
      lifecycle: Object.freeze({ ...NOT_ATTEMPTED, observationGap: 'unsupported-source' }),
      exitCode: null, markerObserved: false, outputDigest: ports.digest(reason),
      cleanup: cleanupNotAttempted(ports.digest), diagnostic: reason
    });
  }
  const plan = ports.createCapabilityPlan({
    actionKey: input.actionKey, bunExecutable: ports.bunExecutable, unitNonce: ports.unitNonce,
    executionAuthorization: input.executionAuthorization
  });
  const teardownPlan = ports.createTeardownPlan({ actionKey: input.actionKey, unitName: plan.unitName });
  const [observed, teardown] = await observeSutAttemptAndTeardown({
    execution: plan, teardown: teardownPlan,
    run: (command, archive: RetainedArchive | undefined) => ports.run(command, archive),
    unobserved: (code, diagnostic) => ports.unobservedProcess(code, diagnostic)
  });
  const cleanup = directoryCleanup(teardown);
  const selfTestPassed = ports.lifecycleComplete(observed.lifecycle) && observed.code === 0 &&
    !observed.outputTruncated && observed.failureTail.includes(ports.capabilityMarker);
  const supported = selfTestPassed && ports.cleanupComplete(cleanup);
  const failure = `${observed.failureTail}\n${teardown.failureTail}`.trim();
  const settled = observed.lifecycle.supervisorClosed === true && observed.lifecycle.candidateUnitSettled === true &&
    ports.cleanupComplete(cleanup);
  const unsupported = settled && /not found|no such file|operation not permitted|failed to connect to bus|unshare failed|unknown option/iu.test(failure);
  const unknown = observed.lifecycle.supervisorClosed !== true || cleanup.supervisorClosed !== true;
  return Object.freeze({
    state: supported ? 'supported' : unknown ? 'unknown' : unsupported ? 'unsupported' : 'invalidated',
    commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
    lifecycle: observed.lifecycle,
    exitCode: observed.lifecycle.supervisorClosed === true ? observed.code : null,
    markerObserved: observed.failureTail.includes(ports.capabilityMarker),
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
    cleanup,
    diagnostic: supported ? null : boundedSutDiagnostic([
      observed.lifecycle.observationGap === 'unsupported-source' ? ports.unsupportedDiagnostic : '',
      failure
    ].filter(Boolean).join('\n'), 'Hosted SUT capability or physical settlement was not observed.', ports.failureTail)
  });
}

export function prepareHostedActionSut<
Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
Environment extends Readonly<{ executionEnvironmentRevision: string }>,
ProviderOrigin extends object,
ResolutionSchema extends string,
TicketSchema extends string,
AuthorizationSchema extends string,
PhysicalSchema extends string,
ProviderRevision extends string,
ReceiptSchema extends string,
RawResultSchema extends string,
CommandSchema extends string,
ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>,
RetainedArchive extends Readonly<{ archiveDigest: VerificationActionKeyDigest }>
>(input: Readonly<{
  resolution: HostedActionResolution<Environment, ResolutionSchema>;
  ticket: HostedActionExecutionTicket<ProviderOrigin, TicketSchema>;
  candidateArchive: string;
  archiveInventory: HostedSutInventory;
}>, ports: Pick<HostedSutPorts<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive>, 'parseResolution' | 'parseTicket' | 'encodeData' | 'createAuthorization' | 'candidateEnvironment'>) {
  const resolution = ports.parseResolution(
    ports.encodeData(input.resolution)
  );
  const ticket = ports.parseTicket(
    ports.encodeData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const ticketInventory = inventoryFromTicket(ticket);
  if (ports.encodeData(ticketInventory) !== ports.encodeData(input.archiveInventory)) {
    throw new Error('Hosted Action SUT archive inventory differs from the trusted execution ticket.');
  }
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action resolution lost its normalized operation.');
  }
  const executionAuthorization = ports.createAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: ticketInventory,
    producer: ticket.producer
  });
  const env = ports.candidateEnvironment({
    normalizedOperation,
    manifestPath: resolution.artifactInput.manifestPath
  });
  return Object.freeze({ resolution, ticket, ticketInventory, normalizedOperation, executionAuthorization, env,
    candidateArchive: input.candidateArchive, archiveInventory: input.archiveInventory });
}

export async function executeHostedActionSut<
  Policy extends Readonly<{ limits: object; substrate: string; namespaces: readonly string[]; isolatedUid: number; isolatedGid: number; network: string; inputMount: string; workspace: string; outputTransport: string }>,
  Environment extends Readonly<{ executionEnvironmentRevision: string }>,
  ProviderOrigin extends object,
  ResolutionSchema extends string,
  TicketSchema extends string,
  AuthorizationSchema extends string,
  PhysicalSchema extends string,
  ProviderRevision extends string,
  ReceiptSchema extends string,
  RawResultSchema extends string,
  CommandSchema extends string,
  ProcessResult extends Readonly<{ code: number; rawOutputDigest: string; stdout?: Uint8Array; failureTail: string }>,
  RetainedArchive extends Readonly<{ archiveDigest: VerificationActionKeyDigest }>
>(input: ReturnType<typeof prepareHostedActionSut<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive>>, ports: HostedSutPorts<Policy, Environment, ProviderOrigin, ResolutionSchema, TicketSchema, AuthorizationSchema, PhysicalSchema, ProviderRevision, ReceiptSchema, RawResultSchema, CommandSchema, ProcessResult, RetainedArchive>): Promise<HostedActionRawResult<Policy, VerificationActionKeyDigest, RawResultSchema, ReceiptSchema>> {
  const { resolution, normalizedOperation, executionAuthorization, env } = input;
  const now = ports.now;
  const startedAt = now();
  const actionKey = resolution.actionPlan.action.actionKey;
  const runSandboxProcess = ports.run;
  const capability = await probeHostedSutCapability({ actionKey, executionAuthorization }, ports);
  if (capability.state !== 'supported') {
    const finishedAt = now();
    const emptyDigest = ports.digest('not-executed');
    const receipt = ports.finalizeReceipt({
      actionKey,
      capability: capabilityReceipt(capability),
      commandPlanDigest: null,
      authenticatedArchive: Object.freeze({
        archiveDigest: input.archiveInventory.archiveDigest,
        inventoryDigest: input.archiveInventory.inventoryDigest,
        dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
        gitBundleDigest: input.archiveInventory.gitBundleDigest,
        entryCount: input.archiveInventory.entryCount,
        totalFileBytes: input.archiveInventory.totalFileBytes
      }),
      rootIsolation: ports.rootIsolation(Object.keys(env)),
      execution: Object.freeze({
        lifecycle: NOT_ATTEMPTED, unitName: null, exitCode: null,
        authenticatedInputDigest: null,
        postExecutionInputDigest: null,
        postExecutionReadbackErrorDigest: null,
        stdoutStderrDigest: capability.outputDigest,
        stdoutDigest: emptyDigest,
        stderrDigest: capability.outputDigest,
        stdoutBytesObserved: 0,
        stderrBytesObserved: 0,
        outputTruncated: false,
        boundedFailureTailDigest: ports.digest(capability.diagnostic ?? '')
      }),
      cleanup: cleanupNotAttempted(ports.digest),
      diagnostic: capability.diagnostic
    });
    return ports.finalizeRawResult({
      executionAuthorizationDigest: executionAuthorization.authorizationDigest,
      command: null,
      sandboxReceipt: receipt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    });
  }

  const candidateArchive = ports.resolveArchive(input.candidateArchive);
  const retainedArchive = ports.retainArchive(
    candidateArchive,
    input.archiveInventory.archiveDigest
  );
  let primary: ResourceSettlementFailure | undefined;
  try {
  const preExecutionArchiveDigest = retainedArchive.archiveDigest;
  const commandPlan = ports.createExecutionPlan({
    actionKey,
    candidateArchiveDigest: retainedArchive.archiveDigest,
    bunExecutable: ports.bunExecutable,
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: ports.normalizedArgv(normalizedOperation),
    candidateEnvironment: env,
    executionAuthorization
  });
  const authorizedOperation = ports.resolveAuthorizedOperation({
    plan: resolution.actionPlan,
    authorizedClosure: resolution.actionPlanClosure
  });
  if (authorizedOperation.semanticDigest !== normalizedOperation.semanticDigest) {
    throw new Error('Hosted SUT executor received a substituted normalized operation.');
  }
  const teardownPlan = ports.createTeardownPlan({ actionKey, unitName: commandPlan.unitName });
  const [physical, teardown, executionObservationLost] = await observeSutAttemptAndTeardown({
    execution: commandPlan, teardown: teardownPlan, archive: retainedArchive,
    run: (command, archive) => runSandboxProcess(command, archive),
    unobserved: (code, diagnostic) => ports.unobservedProcess(code, diagnostic)
  });
  const exitCode = physical.code;
  const observedPhysical = physical as HostedSutProcessObservation<ProcessResult> | null;
  if (observedPhysical === null || exitCode !== observedPhysical.code) {
    throw new Error('Hosted Action facade lost its one physical process observation.');
  }
  const processResult = observedPhysical;
  const cleanup = directoryCleanup(teardown);
  const lifecycleComplete = ports.lifecycleComplete(processResult.lifecycle);
  const cleanupComplete = ports.cleanupComplete(cleanup);
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = ports.assertArchive(retainedArchive);
    if (ports.pathDigest(candidateArchive) !== retainedArchive.archiveDigest) {
      throw new Error('Hosted SUT archive pathname no longer names the retained authenticated bytes.');
    }
  } catch (error) {
    archiveReadbackDiagnostic = failureMessage(error);
  }
  const archiveStable = postExecutionArchiveDigest === preExecutionArchiveDigest;
  const sandboxInvalidated = executionObservationLost || !lifecycleComplete ||
    processResult.outputTruncated ||
    processResult.stdoutBytesObserved > ports.outputByteLimit ||
    processResult.stderrBytesObserved > ports.outputByteLimit ||
    !cleanupComplete || !archiveStable;
  const finishedAt = now();
  const diagnostic = sandboxInvalidated
    ? boundedSutDiagnostic([
        executionObservationLost ? 'Hosted SUT physical process observation was lost.' : '',
        processResult.outputTruncated ? 'Hosted SUT physical process output was truncated.' : '',
        processResult.stdoutBytesObserved > ports.outputByteLimit
          ? 'Hosted SUT stdout exceeded its observed byte bound.' : '',
        processResult.stderrBytesObserved > ports.outputByteLimit
          ? 'Hosted SUT stderr exceeded its observed byte bound.' : '',
        lifecycleComplete ? '' : 'Hosted SUT namespace, candidate start, or candidate-unit settlement was not observed.',
        cleanupComplete ? '' : `Hosted SUT directory cleanup failed: ${teardown.failureTail}`,
        archiveStable ? '' : `Hosted SUT authenticated archive readback failed: ${archiveReadbackDiagnostic ?? 'digest changed'}`
      ].filter(Boolean).join('\n'), 'Hosted SUT sandbox was invalidated.', ports.failureTail)
    : processResult.code === 0 ? null
      : boundedSutDiagnostic(processResult.failureTail, `${normalizedOperation.gateId} failed.`, ports.failureTail);
  const receipt = ports.finalizeReceipt({
    actionKey,
    capability: capabilityReceipt(capability),
    commandPlanDigest: commandPlan.physicalCommandProjectionDigest,
    authenticatedArchive: Object.freeze({
      archiveDigest: input.archiveInventory.archiveDigest,
      inventoryDigest: input.archiveInventory.inventoryDigest,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
      gitBundleDigest: input.archiveInventory.gitBundleDigest,
      entryCount: input.archiveInventory.entryCount,
      totalFileBytes: input.archiveInventory.totalFileBytes
    }),
    rootIsolation: ports.rootIsolation(Object.keys(env)),
    execution: Object.freeze({
      lifecycle: processResult.lifecycle,
      unitName: commandPlan.unitName,
      exitCode: processResult.code,
      authenticatedInputDigest: preExecutionArchiveDigest,
      postExecutionInputDigest: postExecutionArchiveDigest,
      postExecutionReadbackErrorDigest: archiveReadbackDiagnostic === null
        ? null : ports.digest(archiveReadbackDiagnostic),
      stdoutStderrDigest: processResult.rawOutputDigest as VerificationActionKeyDigest,
      stdoutDigest: processResult.stdoutDigest,
      stderrDigest: processResult.stderrDigest,
      stdoutBytesObserved: processResult.stdoutBytesObserved,
      stderrBytesObserved: processResult.stderrBytesObserved,
      outputTruncated: processResult.outputTruncated,
      boundedFailureTailDigest: ports.digest(processResult.failureTail)
    }),
    cleanup,
    diagnostic
  });
  return ports.finalizeRawResult({
    executionAuthorizationDigest: executionAuthorization.authorizationDigest,
    command: Object.freeze({
      commandPlanDigest: commandPlan.physicalCommandProjectionDigest!,
      executionAuthorizationDigest: commandPlan.executionAuthorizationDigest!,
      physicalCommandProjectionDigest: commandPlan.physicalCommandProjectionDigest!
    }),
    sandboxReceipt: receipt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString()
  });
  } catch (error) {
    primary = { label: 'Hosted SUT execution', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'Hosted SUT retained archive closeout',
      settle: () => ports.closeArchive(retainedArchive) }] });
  }
}

