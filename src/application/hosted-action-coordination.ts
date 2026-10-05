import type { VerificationActionKeyDigest } from '../execution/verification/action.ts';
import type {
  VerificationSessionHostedEnvelope, VerificationSessionHostedFacts,
  VerificationSessionHostedRequest
} from '../execution/verification/hosted.ts';
import {
  finalizeHostedSessionCommand, observeHostedSessionCommand,
  prepareHostedSessionFromFacts
} from './verification-session-hosted.ts';

/** Bootstrap binds each value to the original native/pure owner's return type. */
export interface HostedActionCoordinationValues {
  source: unknown;
  request: Readonly<{ expectedBaseSha: string }>;
  envelope: Readonly<{ actionPlanClosure: Readonly<{ actions: readonly Readonly<{
    action: Readonly<{ actionKey: VerificationActionKeyDigest }>
  }>[] }>; session: Readonly<{ baseSha: string }>;
    scopeAuthorization: Readonly<{ issuer: Readonly<{ principalId: string }> }> }>;
  proposal: Readonly<{ proposedActionKey: VerificationActionKeyDigest }>;
  parentPlan: Readonly<{ proposals: readonly HostedActionCoordinationValues['proposal'][];
    parentRunId: string; parentRunAttempt: number; parentDispatchPlanDigest: VerificationActionKeyDigest }>;
  providerEnvelope: Readonly<{ proposal: HostedActionCoordinationValues['proposal'];
    parentDispatchPlanPayloadDigest: VerificationActionKeyDigest }>;
  actionRequest: unknown;
  resolution: Readonly<{ actionPlan: Readonly<{ action: Readonly<{ actionKey: VerificationActionKeyDigest }> }>;
    executionEnvironment: Readonly<{ executionEnvironmentRevision: string }>;
    artifactInput: Readonly<{ headSha: string }>; actionKeyHex: string; resolutionDigest: VerificationActionKeyDigest }>;
  repositoryIdentity: Readonly<{ repository: string; repositoryId: number }>;
  parentActor: unknown;
  producer: Readonly<{ runId: string; runAttempt: number }>;
  marker: Readonly<{ actionKey: VerificationActionKeyDigest; markerDigest: VerificationActionKeyDigest;
    producer: HostedActionCoordinationValues['producer'] }>;
  start: Readonly<{ expired: boolean; payload: HostedActionCoordinationValues['marker'] | null }>;
  terminal: unknown;
  anchor: unknown;
  statusReadback: unknown;
  status: unknown;
  snapshot: Readonly<{ startObservations: readonly HostedActionCoordinationValues['start'][] }>;
  decision: Readonly<{ disposition: string; physicalExecutionAllowed: boolean }>;
  coordination: Readonly<{ disposition: string; dispatchActionKeys: readonly VerificationActionKeyDigest[] }>;
  inventory: Readonly<{ archiveDigest: VerificationActionKeyDigest; inventoryDigest: VerificationActionKeyDigest }>;
  sandbox: Readonly<{ state: string; diagnostic?: string | null }>;
  sandboxSelection: unknown;
  ticket: Readonly<{ actionKey: VerificationActionKeyDigest; ticketDigest: VerificationActionKeyDigest }>;
  artifactIndexSchema: string;
  evidenceIndex: unknown;
  evidenceProducer: unknown;
  evidence: unknown;
}

type ChildAuthority<V extends HostedActionCoordinationValues> = Readonly<{
  providerEnvelope: V['providerEnvelope']; envelope: V['envelope']; resolution: V['resolution'];
}>;
type ParentAuthority<V extends HostedActionCoordinationValues> = Readonly<{
  sessionRequest: V['request']; envelope: V['envelope']; parentPlan: V['parentPlan'];
  providerEnvelopes: readonly V['providerEnvelope'][];
}>;
type ParentPlan<V extends HostedActionCoordinationValues> = V['parentPlan'] & Readonly<{ proposals: readonly V['proposal'][] }>;
type ProviderIndex<V extends HostedActionCoordinationValues> = Readonly<{
  schema: V['artifactIndexSchema']; terminalObservations: readonly V['terminal'][];
  startObservations: readonly V['start'][]; terminalAnchorObservations: readonly V['anchor'][];
  providerStatusReadbacks: readonly V['statusReadback'][];
}>;
type Transaction<V extends HostedActionCoordinationValues> = Readonly<{
  disposition: string; reason: string | null; actionKey: VerificationActionKeyDigest;
  newlyCreatedByThisInvocation: boolean; snapshot: V['snapshot'] & Readonly<{
    startObservations: readonly (V['start'] & Readonly<{ payload: V['marker'] | null }>)[];
  }>; status: V['status'] | null;
}>;

export interface HostedActionCoordinationPorts<V extends HostedActionCoordinationValues> {
  readTransport(path: string, label: string): V['source'];
  sourceText(source: V['source']): string;
  parseSessionRequest(source: V['source']): V['request'];
  parseEnvelope(value: unknown): V['envelope'];
  parseParentPlan(value: unknown): ParentPlan<V>;
  parseProviderEnvelope(value: unknown): V['providerEnvelope'];
  parseResolution(source: V['source']): V['resolution'];
  parseStartMarker(value: unknown): V['marker'];
  canonicalSource(value: unknown): string;
  parseActionRequest(source: string): V['actionRequest'];
  resolveAction(input: Readonly<{ request: V['actionRequest']; envelope: V['envelope'] }>): V['resolution'];
  createProposal(input: Readonly<{ sessionRequest: V['request']; proposedActionKey: VerificationActionKeyDigest }>): V['proposal'];
  createProviderEnvelope(input: Readonly<{ proposal: V['proposal']; parentPlan: V['parentPlan'];
    parentDispatchPlanArtifactId: string; parentDispatchPlanArchiveDigest: VerificationActionKeyDigest }>): V['providerEnvelope'];
  repositoryIdentity(): V['repositoryIdentity'];
  parentContext(): Readonly<{ runId: string; runAttempt: number; workflowSha: string; workflowRef: string; job: string }>;
  parentJobId(repository: string, runId: string, runAttempt: number): string;
  parentActor(repository: string): V['parentActor'];
  createParentPlan(input: Readonly<{ repositoryId: string; repository: string; parentRunId: string;
    parentRunAttempt: number; parentJobId: string; parentWorkflowRef: string; parentWorkflowSha: string;
    parentActor: V['parentActor']; proposals: readonly V['proposal'][] }>): ParentPlan<V>;
  parentPlanArtifactName(runId: string, runAttempt: number): string;
  parentPlanPayloadDigest(plan: V['parentPlan']): VerificationActionKeyDigest;
  transaction(authority: Pick<ChildAuthority<V>, 'providerEnvelope' | 'envelope'>,
    intent: Readonly<{ kind: 'coordinate-parent' | 'coordinate' | 'dispatch-child' }> |
      Readonly<{ kind: 'claim-start'; marker: V['marker'] }>): Promise<Transaction<V>>;
  providerIndex(snapshot: V['snapshot']): ProviderIndex<V>;
  artifactIndexSchema: V['artifactIndexSchema'];
  reduceProvider(input: Readonly<{ resolution: V['resolution']; index: ProviderIndex<V> }> & V['repositoryIdentity']): V['decision'];
  coordinate(input: Readonly<{ envelope: V['envelope']; observations: readonly V['terminal'][];
    startObservations: readonly V['start'][]; terminalAnchorObservations: readonly V['anchor'][];
    providerStatusReadbacks: readonly V['statusReadback'][] }>): V['coordination'];
  inspectArchive(input: Readonly<{ resolution: V['resolution']; preparedCandidateArchive: string;
    baseDependencyClosureDigest: VerificationActionKeyDigest; authenticatedGitClosureDigest: VerificationActionKeyDigest }>): V['inventory'];
  captureSandboxCapability(input: Readonly<{ selection: V['sandboxSelection']; actionKey: VerificationActionKeyDigest }>): Promise<V['sandbox']>;
  producer(): V['producer'];
  createStartMarker(input: Readonly<{ actionKey: VerificationActionKeyDigest; candidateSha: string;
    executionEnvironmentRevision: string; producer: V['producer'] }>): V['marker'];
  prepareMarker(marker: V['marker']): V['marker'];
  writePreparedMarker(path: string, marker: V['marker']): Promise<void>;
  startMarkerName(actionKey: VerificationActionKeyDigest): string;
  digest(value: unknown): VerificationActionKeyDigest;
  createTicket(input: Readonly<{ resolution: V['resolution']; marker: V['marker']; startObservation: V['start'];
    startStatus: V['status']; preparedCandidateArtifactName: string; preparedCandidateInventory: V['inventory'] }>): V['ticket'];
  prepareTicket(ticket: V['ticket']): V['ticket'];
  writePreparedTicket(path: string, ticket: V['ticket']): Promise<void>;
  prepareParentPlan(plan: V['parentPlan']): V['parentPlan'];
  writePreparedParentPlan(path: string, plan: V['parentPlan']): Promise<void>;
  writeResolution(path: string, resolution: V['resolution']): Promise<void>;
  writeArtifactIndex(path: string, index: ProviderIndex<V>): Promise<void>;
  readEvidenceIndex(source: V['source']): V['evidenceIndex'];
  evidenceObservations(index: V['evidenceIndex']): Readonly<{ observations: readonly V['terminal'][];
    startObservations: readonly V['start'][]; terminalAnchorObservations: readonly V['anchor'][];
    providerStatusReadbacks: readonly V['statusReadback'][] }>;
  evidenceProducer(input: Readonly<{ sourceTransport: 'github-actions'; workflowPath: string; workflowRef: string;
    workflowSha: string; runId: string; runAttempt: number; actorNodeId: string }>): V['evidenceProducer'];
  composeEvidence(input: Readonly<{ envelope: V['envelope']; observations: readonly V['terminal'][];
    startObservations: readonly V['start'][]; terminalAnchorObservations: readonly V['anchor'][];
    providerStatusReadbacks: readonly V['statusReadback'][]; producer: V['evidenceProducer'] }>):
    Readonly<{ evidence: V['evidence'] | null; coordination: V['coordination'] }>;
  prepareEvidence(evidence: V['evidence']): V['evidence'];
  writePreparedEvidence(path: string, evidence: V['evidence']): Promise<void>;
}

export interface HostedActionParentInput {
  readonly requestPath: string; readonly envelopePath: string; readonly parentPlanPath: string;
  readonly parentArtifactId: string; readonly parentArtifactArchiveDigest: string;
}
export interface HostedActionChildInput {
  readonly providerEnvelopePath: string; readonly envelopePath: string; readonly resolutionPath?: string;
}
export interface HostedActionArchiveInput {
  readonly preparedCandidateArchive: string; readonly baseDependencyClosureDigest: VerificationActionKeyDigest;
  readonly authenticatedGitClosureDigest: VerificationActionKeyDigest;
}

function canonicalRead<V extends HostedActionCoordinationValues, T>(path: string, label: string,
  parse: (value: unknown) => T, ports: HostedActionCoordinationPorts<V>): T {
  const source = ports.readTransport(path, label);
  const value = parse(JSON.parse(ports.sourceText(source)) as unknown);
  if (ports.sourceText(source) !== `${ports.canonicalSource(value)}\n`) {
    throw new Error(`${label} is not one exact canonical JSON line.`);
  }
  return value;
}

function readParentAuthority<V extends HostedActionCoordinationValues>(input: HostedActionParentInput,
  ports: HostedActionCoordinationPorts<V>): ParentAuthority<V> {
  const sessionRequest = ports.parseSessionRequest(ports.readTransport(input.requestPath, 'parent Session request'));
  const envelope = ports.parseEnvelope(JSON.parse(ports.sourceText(ports.readTransport(input.envelopePath, 'parent Session envelope'))) as unknown);
  const parentPlan = canonicalRead(input.parentPlanPath, 'parent dispatch plan', ports.parseParentPlan, ports);
  const expectedProposals = envelope.actionPlanClosure.actions.map(member => ports.createProposal({
    sessionRequest, proposedActionKey: member.action.actionKey
  })).sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (ports.canonicalSource(parentPlan.proposals) !== ports.canonicalSource(expectedProposals)) {
    throw new Error('parent dispatch plan proposals differ from the exact hosted Action closure.');
  }
  if (!/^[1-9][0-9]*$/u.test(input.parentArtifactId) || !/^sha256:[0-9a-f]{64}$/u.test(input.parentArtifactArchiveDigest)) {
    throw new Error('parent dispatch plan artifact identity is invalid.');
  }
  const providerEnvelopes = parentPlan.proposals.map(proposal => ports.createProviderEnvelope({
    proposal, parentPlan, parentDispatchPlanArtifactId: input.parentArtifactId,
    parentDispatchPlanArchiveDigest: input.parentArtifactArchiveDigest as VerificationActionKeyDigest
  }));
  return Object.freeze({ sessionRequest, envelope, parentPlan, providerEnvelopes: Object.freeze(providerEnvelopes) });
}

function readChildAuthority<V extends HostedActionCoordinationValues>(input: HostedActionChildInput,
  ports: HostedActionCoordinationPorts<V>): ChildAuthority<V> {
  const providerEnvelope = canonicalRead(input.providerEnvelopePath, 'internal Action provider envelope', ports.parseProviderEnvelope, ports);
  const envelope = ports.parseEnvelope(JSON.parse(ports.sourceText(ports.readTransport(input.envelopePath, 'parent Session envelope'))) as unknown);
  const resolution = ports.resolveAction({ request: ports.parseActionRequest(ports.canonicalSource(providerEnvelope.proposal)), envelope });
  if (input.resolutionPath !== undefined) {
    const supplied = ports.parseResolution(ports.readTransport(input.resolutionPath, 'internal Action resolution'));
    if (ports.canonicalSource(supplied) !== ports.canonicalSource(resolution)) {
      throw new Error('caller Action resolution differs from the authenticated provider envelope.');
    }
  }
  return Object.freeze({ providerEnvelope, envelope, resolution });
}

async function observeAction<V extends HostedActionCoordinationValues>(authority: Pick<ChildAuthority<V>, 'providerEnvelope' | 'envelope'>,
  role: 'parent' | 'child', ports: HostedActionCoordinationPorts<V>) {
  const observation = await ports.transaction(authority, { kind: role === 'parent' ? 'coordinate-parent' : 'coordinate' });
  if (observation.disposition !== 'observed') {
    throw new Error(`hosted Action provider observation returned ${observation.disposition}.`);
  }
  const index = ports.providerIndex(observation.snapshot);
  const resolution = ports.resolveAction({ request: ports.parseActionRequest(ports.canonicalSource(authority.providerEnvelope.proposal)),
    envelope: authority.envelope });
  const decision = ports.reduceProvider({ resolution, ...ports.repositoryIdentity(), index });
  return Object.freeze({ observation, index, decision });
}

export async function prepareHostedActionParentPlan<V extends HostedActionCoordinationValues>(input: Readonly<{
  requestPath: string; envelopePath: string; outputPath: string;
}>, ports: HostedActionCoordinationPorts<V>) {
  const sessionRequest = ports.parseSessionRequest(ports.readTransport(input.requestPath, 'hosted Session request'));
  const envelope = ports.parseEnvelope(JSON.parse(ports.sourceText(ports.readTransport(input.envelopePath, 'hosted Session envelope'))) as unknown);
  const repositoryIdentity = ports.repositoryIdentity();
  const context = ports.parentContext();
  if (!/^[1-9][0-9]*$/u.test(context.runId) || !/^[0-9a-f]{40}$/u.test(context.workflowSha)
      || context.workflowSha !== sessionRequest.expectedBaseSha
      || context.workflowRef !== `${repositoryIdentity.repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`
      || context.job !== 'coordinate-verification-session') {
    throw new Error('parent dispatch plan is not running in the exact trusted Session coordinator.');
  }
  const proposals = envelope.actionPlanClosure.actions.map(member => ports.createProposal({ sessionRequest,
    proposedActionKey: member.action.actionKey }));
  for (const proposal of proposals) ports.resolveAction({ request: ports.parseActionRequest(ports.canonicalSource(proposal)), envelope });
  const parentPlan = ports.createParentPlan({ repositoryId: String(repositoryIdentity.repositoryId), repository: repositoryIdentity.repository,
    parentRunId: context.runId, parentRunAttempt: context.runAttempt,
    parentJobId: ports.parentJobId(repositoryIdentity.repository, context.runId, context.runAttempt),
    parentWorkflowRef: context.workflowRef, parentWorkflowSha: context.workflowSha,
    parentActor: ports.parentActor(repositoryIdentity.repository), proposals });
  await ports.writePreparedParentPlan(input.outputPath, ports.prepareParentPlan(parentPlan));
  return Object.freeze({ status: 'prepared', artifactName: ports.parentPlanArtifactName(parentPlan.parentRunId, parentPlan.parentRunAttempt),
    payloadDigest: ports.parentPlanPayloadDigest(parentPlan), parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest,
    proposalCount: parentPlan.proposals.length, output: input.outputPath });
}

export async function verifyHostedActionParentPlan<V extends HostedActionCoordinationValues>(input: HostedActionParentInput,
  ports: HostedActionCoordinationPorts<V>) {
  const authority = readParentAuthority(input, ports);
  const first = authority.providerEnvelopes[0];
  if (first === undefined) throw new Error('parent dispatch plan has no Action proposal.');
  const observed = await observeAction({ providerEnvelope: first, envelope: authority.envelope }, 'parent', ports);
  return Object.freeze({ status: 'verified', parentDispatchPlanDigest: authority.parentPlan.parentDispatchPlanDigest,
    parentArtifactPayloadDigest: first.parentDispatchPlanPayloadDigest, firstActionDisposition: observed.decision.disposition });
}

async function observeParentIndex<V extends HostedActionCoordinationValues>(authority: ParentAuthority<V>,
  ports: HostedActionCoordinationPorts<V>): Promise<ProviderIndex<V>> {
  const terminalObservations: V['terminal'][] = [], startObservations: V['start'][] = [];
  const terminalAnchorObservations: V['anchor'][] = [], providerStatusReadbacks: V['statusReadback'][] = [];
  for (const providerEnvelope of authority.providerEnvelopes) {
    const observed = await observeAction({ providerEnvelope, envelope: authority.envelope }, 'parent', ports);
    terminalObservations.push(...observed.index.terminalObservations);
    startObservations.push(...observed.index.startObservations);
    terminalAnchorObservations.push(...observed.index.terminalAnchorObservations);
    providerStatusReadbacks.push(...observed.index.providerStatusReadbacks);
  }
  return Object.freeze({ schema: ports.artifactIndexSchema,
    terminalObservations: Object.freeze(terminalObservations), startObservations: Object.freeze(startObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations), providerStatusReadbacks: Object.freeze(providerStatusReadbacks) });
}

export async function coordinateHostedActionSession<V extends HostedActionCoordinationValues>(input: HostedActionParentInput & Readonly<{
  artifactIndexPath: string; dispatch: boolean;
}>, ports: HostedActionCoordinationPorts<V>) {
  const authority = readParentAuthority(input, ports);
  const artifactIndex = await observeParentIndex(authority, ports);
  const coordination = ports.coordinate({ envelope: authority.envelope, observations: artifactIndex.terminalObservations,
    startObservations: artifactIndex.startObservations, terminalAnchorObservations: artifactIndex.terminalAnchorObservations,
    providerStatusReadbacks: artifactIndex.providerStatusReadbacks });
  let dispatched = 0;
  if (input.dispatch && coordination.disposition === 'dispatch') {
    const envelopesByKey = new Map(authority.providerEnvelopes.map(envelope => [envelope.proposal.proposedActionKey, envelope]));
    for (const actionKey of coordination.dispatchActionKeys) {
      const providerEnvelope = envelopesByKey.get(actionKey);
      if (providerEnvelope === undefined) throw new Error('coordinator selected an Action outside the authenticated parent plan.');
      const result = await ports.transaction({ providerEnvelope, envelope: authority.envelope }, { kind: 'dispatch-child' });
      if (result.disposition !== 'dispatched') throw new Error(`internal Action wake-up was not accepted: ${result.reason ?? result.disposition}.`);
      dispatched += 1;
    }
  }
  await ports.writeArtifactIndex(input.artifactIndexPath, artifactIndex);
  return Object.freeze({ ...coordination, dispatched, artifactIndex: input.artifactIndexPath });
}

export async function observeHostedAction<V extends HostedActionCoordinationValues>(input: HostedActionChildInput & Readonly<{
  artifactIndexPath: string;
}>, ports: HostedActionCoordinationPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const observed = await observeAction(authority, 'child', ports);
  await ports.writeArtifactIndex(input.artifactIndexPath, observed.index);
  return Object.freeze({ ...observed.decision, artifactIndex: input.artifactIndexPath });
}

export async function prepareHostedActionStartMarker<V extends HostedActionCoordinationValues>(input:
  HostedActionChildInput & HostedActionArchiveInput & Readonly<{ outputPath: string; capabilitySelection: V['sandboxSelection'] }>, ports: HostedActionCoordinationPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const inventory = ports.inspectArchive({ resolution: authority.resolution, preparedCandidateArchive: input.preparedCandidateArchive,
    baseDependencyClosureDigest: input.baseDependencyClosureDigest, authenticatedGitClosureDigest: input.authenticatedGitClosureDigest });
  const sandbox = await ports.captureSandboxCapability({ selection: input.capabilitySelection,
    actionKey: authority.resolution.actionPlan.action.actionKey });
  return publishHostedActionStartMarker(input.outputPath, authority, inventory, sandbox, ports);
}

async function publishHostedActionStartMarker<V extends HostedActionCoordinationValues>(outputPath: string,
  authority: ChildAuthority<V>, inventory: V['inventory'], sandbox: V['sandbox'], ports: HostedActionCoordinationPorts<V>) {
  if (sandbox.state === 'unknown') throw new Error(`Hosted Action sandbox pre-start capability is an ambiguous machine observation: ${sandbox.diagnostic ?? 'no diagnostic'}`);
  const observed = await observeAction(authority, 'child', ports);
  if (observed.decision.disposition !== 'start-allowed' || !observed.decision.physicalExecutionAllowed) {
    throw new Error(`start marker cannot be prepared from ${observed.decision.disposition}.`);
  }
  const marker = ports.createStartMarker({ actionKey: authority.resolution.actionPlan.action.actionKey,
    candidateSha: authority.resolution.artifactInput.headSha,
    executionEnvironmentRevision: authority.resolution.executionEnvironment.executionEnvironmentRevision,
    producer: ports.producer() });
  await ports.writePreparedMarker(outputPath, ports.prepareMarker(marker));
  return Object.freeze({ status: 'marker-prepared', actionKey: marker.actionKey, markerName: ports.startMarkerName(marker.actionKey),
    markerDigest: marker.markerDigest, archiveDigest: inventory.archiveDigest, archiveInventoryDigest: inventory.inventoryDigest,
    sandboxCapabilityState: sandbox.state, sandboxCapabilityDigest: ports.digest(sandbox), output: outputPath });
}

export async function claimHostedActionStart<V extends HostedActionCoordinationValues>(input:
  HostedActionChildInput & HostedActionArchiveInput & Readonly<{ outputPath: string }>, ports: HostedActionCoordinationPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const before = await ports.transaction(authority, { kind: 'coordinate' });
  const markerObservation = before.snapshot.startObservations[0];
  if (before.disposition !== 'observed' || before.snapshot.startObservations.length !== 1
      || markerObservation?.expired !== false || markerObservation.payload === null) {
    throw new Error('claim-start requires one exact uploaded immutable start marker.');
  }
  const marker = ports.parseStartMarker(markerObservation.payload);
  const claimed = await ports.transaction(authority, { kind: 'claim-start', marker });
  if (claimed.disposition !== 'started' || !claimed.newlyCreatedByThisInvocation || claimed.status === null) {
    return Object.freeze({ status: 'joined', actionKey: claimed.actionKey, issued: false, ticketDigest: null, output: null, reason: claimed.reason });
  }
  const startObservation = claimed.snapshot.startObservations[0];
  if (claimed.snapshot.startObservations.length !== 1 || startObservation === undefined || startObservation.payload === null) {
    throw new Error('claim-start readback lost the exact start marker.');
  }
  const inventory = ports.inspectArchive({ resolution: authority.resolution, preparedCandidateArchive: input.preparedCandidateArchive,
    baseDependencyClosureDigest: input.baseDependencyClosureDigest, authenticatedGitClosureDigest: input.authenticatedGitClosureDigest });
  const ticket = ports.createTicket({ resolution: authority.resolution, marker, startObservation,
    startStatus: claimed.status, preparedCandidateArtifactName: `sec-verification-action-prepared-v2-${marker.actionKey.slice(7)}-run-${marker.producer.runId}`
      + `-attempt-${marker.producer.runAttempt}`, preparedCandidateInventory: inventory });
  await ports.writePreparedTicket(input.outputPath, ports.prepareTicket(ticket));
  return Object.freeze({ status: 'ticket-issued', actionKey: ticket.actionKey, issued: true, ticketDigest: ticket.ticketDigest, output: input.outputPath });
}

export async function resolveHostedAction<V extends HostedActionCoordinationValues>(input: Readonly<{
  providerEnvelopePath: string; envelopePath: string; outputPath: string;
}>, ports: HostedActionCoordinationPorts<V>) {
  const providerEnvelope = ports.parseProviderEnvelope(JSON.parse(ports.sourceText(ports.readTransport(input.providerEnvelopePath, 'hosted Action provider envelope'))) as unknown);
  const request = ports.parseActionRequest(ports.canonicalSource(providerEnvelope.proposal));
  const envelope = ports.parseEnvelope(JSON.parse(ports.sourceText(ports.readTransport(input.envelopePath, 'hosted Session envelope'))) as unknown);
  const resolution = ports.resolveAction({ request, envelope });
  await ports.writeResolution(input.outputPath, resolution);
  return Object.freeze({ status: 'resolved', actionKey: resolution.actionPlan.action.actionKey,
    actionKeyHex: resolution.actionKeyHex, resolutionDigest: resolution.resolutionDigest, output: input.outputPath });
}

export async function composeHostedActionEvidence<V extends HostedActionCoordinationValues>(input: HostedActionParentInput & Readonly<{
  artifactIndexPath: string; outputPath: string;
}>, ports: HostedActionCoordinationPorts<V>) {
  const authority = readParentAuthority(input, ports);
  const envelope = authority.envelope;
  const suppliedIndex = ports.readEvidenceIndex(ports.readTransport(input.artifactIndexPath, 'hosted Action artifact index'));
  const index = await observeParentIndex(authority, ports);
  const observations = Object.freeze({ observations: index.terminalObservations, startObservations: index.startObservations,
    terminalAnchorObservations: index.terminalAnchorObservations, providerStatusReadbacks: index.providerStatusReadbacks });
  if (ports.canonicalSource(ports.evidenceObservations(suppliedIndex)) !== ports.canonicalSource(observations)) {
    throw new Error('supplied evidence index differs from the exact authenticated parent member observations.');
  }
  const context = ports.parentContext();
  const producer = ports.evidenceProducer({ sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`, workflowSha: envelope.session.baseSha,
    runId: context.runId, runAttempt: context.runAttempt, actorNodeId: envelope.scopeAuthorization.issuer.principalId });
  const composed = ports.composeEvidence({ envelope, ...observations, producer });
  if (composed.evidence !== null) await ports.writePreparedEvidence(input.outputPath, ports.prepareEvidence(composed.evidence));
  return Object.freeze({ ...composed.coordination, evidenceWritten: composed.evidence !== null,
    output: composed.evidence === null ? null : input.outputPath });
}

/** The policy owns the windows; the native wait preserves the original job deadline. */
export interface HostedActionSessionCoordinationPorts<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs, Evidence,
  Artifact extends Readonly<{ artifactDigest: string }>, Producer> {
  readonly repository: string;
  readonly budget: Readonly<{ reviewMaximumAttempts: number; reviewPollIntervalMs: number;
    actionMaximumAttempts: number; actionPollIntervalMs: number }>;
  materializeRequest(encoded: string, path: string): VerificationSessionHostedRequest<RequestSchema>
    | Promise<VerificationSessionHostedRequest<RequestSchema>>;
  readSessionRequest(path: string): VerificationSessionHostedRequest<RequestSchema>;
  compilerIdentity(request: VerificationSessionHostedRequest<RequestSchema>): Promise<Readonly<{
    actorNodeId: string; runId: string; runAttempt: number;
  }>>;
  readonly observation: Parameters<typeof observeHostedSessionCommand<RequestSchema, EnvelopeSchema,
    Manifest, Transition, SourceProvider, DependencyBlobs>>[1];
  readFacts(path: string): VerificationSessionHostedFacts;
  writeEnvelope(path: string, envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>): void | Promise<void>;
  readEnvelope(path: string): VerificationSessionHostedEnvelope<EnvelopeSchema>;
  readonly finalization: Parameters<typeof finalizeHostedSessionCommand<VerificationSessionHostedEnvelope<EnvelopeSchema>,
    Evidence, Artifact, Producer>>[1];
  wait(intervalMs: number): Promise<void>;
}

interface HostedActionSessionPaths {
  readonly requestPath: string; readonly factsPath: string; readonly envelopePath: string;
}

function assertCoordinationBudget(budget: HostedActionSessionCoordinationPorts<string, string, unknown, unknown,
  unknown, unknown, unknown, Readonly<{ artifactDigest: string }>, unknown>['budget']): void {
  for (const value of [budget.reviewMaximumAttempts, budget.reviewPollIntervalMs,
    budget.actionMaximumAttempts, budget.actionPollIntervalMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Hosted coordination requires its bounded original policy windows.');
  }
}

async function observeCoordinationSession<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs, Evidence,
  Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionSessionPaths,
  request: VerificationSessionHostedRequest<RequestSchema>, ports: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer>) {
  const identity = await ports.compilerIdentity(request);
  return observeHostedSessionCommand({ request, repository: ports.repository,
    originalHumanNodeId: identity.actorNodeId, sourceRunId: identity.runId, sourceRunAttempt: identity.runAttempt,
    sourceRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}`, output: input.factsPath }, ports.observation);
}

async function prepareCoordinationEnvelope<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs, Evidence,
  Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionSessionPaths,
  request: VerificationSessionHostedRequest<RequestSchema>, ports: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer>) {
  const prepared = await prepareHostedSessionFromFacts({ request, facts: ports.readFacts(input.factsPath) }, ports.observation);
  if (prepared.status !== 'prepared') throw new Error(`prepare-hosted fresh Review barrier is ${prepared.status}.`);
  await ports.writeEnvelope(input.envelopePath, prepared.envelope);
}

async function awaitCoordinationReview<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs, Evidence,
  Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionSessionPaths,
  request: VerificationSessionHostedRequest<RequestSchema>, session: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer>) {
  let observed = false;
  for (let attempt = 0; attempt < session.budget.reviewMaximumAttempts; attempt += 1) {
    const result = await observeCoordinationSession(input, request, session);
    if (result.status === 'observed') { observed = true; break; }
    if (result.status !== 'WAITING_REVIEW') throw new Error(`Unknown observe-hosted status: ${result.status}`);
    if (attempt + 1 < session.budget.reviewMaximumAttempts) await session.wait(session.budget.reviewPollIntervalMs);
  }
  if (!observed) throw new Error('Review did not become stable within the bounded coordinator window.');
}

/** The real parent-plan upload is the barrier between preparation and completion. */
export async function prepareHostedActionCoordinationSession<V extends HostedActionCoordinationValues,
  RequestSchema extends string, EnvelopeSchema extends string, Manifest, Transition, SourceProvider, DependencyBlobs,
  Evidence, Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionSessionPaths & Readonly<{
    sessionRequestBase64: string; parentPlanPath: string;
  }>, coordination: HostedActionCoordinationPorts<V>, session: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer>) {
  assertCoordinationBudget(session.budget);
  const request = await session.materializeRequest(input.sessionRequestBase64, input.requestPath);
  await awaitCoordinationReview(input, request, session);
  await prepareCoordinationEnvelope(input, request, session);
  return prepareHostedActionParentPlan({ requestPath: input.requestPath, envelopePath: input.envelopePath,
    outputPath: input.parentPlanPath }, coordination);
}

/** Consume the actual upload identity, then refresh authorization before the sole terminal artifact. */
export async function completeHostedActionCoordinationSession<V extends HostedActionCoordinationValues,
  RequestSchema extends string, EnvelopeSchema extends string, Manifest, Transition, SourceProvider, DependencyBlobs,
  Evidence, Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionParentInput & Readonly<{
    factsPath: string; artifactIndexPath: string; evidencePath: string; artifactPath: string;
  }>, coordination: HostedActionCoordinationPorts<V>, session: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer>) {
  assertCoordinationBudget(session.budget);
  await verifyHostedActionParentPlan(input, coordination);
  let complete = false;
  for (let attempt = 0; attempt < session.budget.actionMaximumAttempts; attempt += 1) {
    const result = await coordinateHostedActionSession({ ...input, dispatch: true }, coordination);
    if (result.disposition === 'complete') { complete = true; break; }
    if (result.disposition !== 'dispatch' && result.disposition !== 'waiting') {
      throw new Error(`Hosted Action coordination cannot continue from ${result.disposition}.`);
    }
    if (attempt + 1 < session.budget.actionMaximumAttempts) await session.wait(session.budget.actionPollIntervalMs);
  }
  if (!complete) throw new Error('Hosted Action DAG did not terminate within the bounded coordinator window.');
  const request = session.readSessionRequest(input.requestPath);
  const fresh = await observeCoordinationSession(input, request, session);
  if (fresh.status !== 'observed') throw new Error('Review drifted before Evidence composition.');
  await prepareCoordinationEnvelope(input, request, session);
  const final = await coordinateHostedActionSession({ ...input, dispatch: false }, coordination);
  if (final.disposition !== 'complete') throw new Error('Action state drifted before Evidence composition.');
  const composed = await composeHostedActionEvidence({ ...input, outputPath: input.evidencePath }, coordination);
  if (!composed.evidenceWritten || composed.output === null || composed.disposition !== 'complete') {
    throw new Error('Fresh canonical Action terminals did not produce complete Evidence.');
  }
  return finalizeHostedSessionCommand({ envelope: session.readEnvelope(input.envelopePath), evidencePath: input.evidencePath,
    previousArtifactPath: undefined, output: input.artifactPath }, session.finalization);
}

/** These native ports retain the genuine resolution and fixed candidate/base roots. */
export interface HostedActionCandidatePreparationPorts<V extends HostedActionCoordinationValues> {
  /** The original producer owns candidate/dependency checks inside this one scope. */
  prepareCandidateArchive(input: Readonly<{ resolution: V['resolution']; outputDirectory: string }>): Promise<HostedActionArchiveInput>;
  inspectPreparedCandidateArchive(input: Readonly<{ resolution: V['resolution']; prepared: HostedActionArchiveInput }>): V['inventory'];
}

/** Publish the marker only after the original producer issues its archive and both closure digests. */
export async function prepareHostedActionClaim<V extends HostedActionCoordinationValues>(input: HostedActionChildInput & Readonly<{
  capabilitySelection: V['sandboxSelection']; archiveOutputDirectory: string; markerOutputPath: string;
}>, ports: HostedActionCoordinationPorts<V> & HostedActionCandidatePreparationPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const sandbox = await ports.captureSandboxCapability({ selection: input.capabilitySelection,
    actionKey: authority.resolution.actionPlan.action.actionKey });
  if (sandbox.state !== 'supported') {
    throw new Error(`Hosted Action candidate preparation requires supported preflight capability: ${sandbox.state}.`);
  }
  // Candidate and dependency checks remain in the original producer, before
  // archive effects. Preserve its exact return object through consumption;
  // copying only path/digest fields cannot carry its preparation identity.
  const prepared = await ports.prepareCandidateArchive({ resolution: authority.resolution, outputDirectory: input.archiveOutputDirectory });
  const inventory = ports.inspectPreparedCandidateArchive({ resolution: authority.resolution, prepared });
  const marker = await publishHostedActionStartMarker(input.markerOutputPath, authority, inventory, sandbox, ports);
  return Object.freeze({ ...marker, preparedCandidateArchive: prepared.preparedCandidateArchive,
    baseDependencyClosureDigest: prepared.baseDependencyClosureDigest,
    authenticatedGitClosureDigest: prepared.authenticatedGitClosureDigest });
}

/** Original Action transport supplies the request; native identity retains its parent and human cause. */
export async function resolveHostedActionCoordinationSession<V extends HostedActionCoordinationValues,
  RequestSchema extends string, EnvelopeSchema extends string, Manifest, Transition, SourceProvider, DependencyBlobs,
  Evidence, Artifact extends Readonly<{ artifactDigest: string }>, Producer>(input: HostedActionSessionPaths & Readonly<{
    actionEnvelopeBase64: string; providerEnvelopePath: string; resolutionPath: string; artifactIndexPath: string;
  }>, coordination: HostedActionCoordinationPorts<V>, session: HostedActionSessionCoordinationPorts<RequestSchema,
    EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs, Evidence, Artifact, Producer> & Readonly<{
      materializeActionRequest(encoded: string, providerEnvelopePath: string, requestPath: string):
        VerificationSessionHostedRequest<RequestSchema> | Promise<VerificationSessionHostedRequest<RequestSchema>>;
    }>) {
  assertCoordinationBudget(session.budget);
  const request = await session.materializeActionRequest(input.actionEnvelopeBase64, input.providerEnvelopePath, input.requestPath);
  await awaitCoordinationReview(input, request, session);
  await prepareCoordinationEnvelope(input, request, session);
  const resolution = await resolveHostedAction({ providerEnvelopePath: input.providerEnvelopePath,
    envelopePath: input.envelopePath, outputPath: input.resolutionPath }, coordination);
  const provider = await observeHostedAction({ providerEnvelopePath: input.providerEnvelopePath,
    envelopePath: input.envelopePath, resolutionPath: input.resolutionPath, artifactIndexPath: input.artifactIndexPath }, coordination);
  return Object.freeze({ resolution, provider });
}
