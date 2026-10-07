import type { VerificationActionKeyDigest } from '../execution/verification/action.ts';

/** Bounds expose only use-case observations; bootstrap retains every original
 * native value through its concrete ReturnType and indexed component types. */
export interface HostedActionTerminalValues {
  providerEnvelope: Readonly<{ proposal: unknown }>;
  envelope: unknown;
  actionRequest: unknown;
  resolution: Readonly<{ actionPlan: Readonly<{ action: Readonly<{ actionKey: VerificationActionKeyDigest }> }>;
    artifactInput: Readonly<{ headSha: string }> }>;
  ticket: Readonly<{ producer: unknown; startStatusId: number; preparedCandidateArtifactName: string;
    ticketDigest: VerificationActionKeyDigest }>;
  rawResult: unknown;
  producer: object;
  repositoryIdentity: object;
  snapshot: unknown;
  transaction: Readonly<{ disposition: string; status: unknown | null; reason: string | null }>;
  index: unknown;
  marker: Readonly<{ markerDigest: VerificationActionKeyDigest }>;
  start: Readonly<{ payload: unknown | null; archiveDigest: VerificationActionKeyDigest | null;
    originId: string; artifactName: string }>;
  status: Readonly<{ id: number; nodeId: string; state: string }>;
  terminal: Readonly<{ artifact: unknown | null; providerObservation: Readonly<{
    originId: string; artifactName: string; archiveDigest: VerificationActionKeyDigest | null; payload: unknown | null }> }>;
  anchor: Readonly<{ actionKey: VerificationActionKeyDigest; anchorDigest: VerificationActionKeyDigest }>;
  artifact: Readonly<{ result: Readonly<{ status: string }>; artifactDigest: string;
    actionPlan: Readonly<{ action: Readonly<{ actionKey: VerificationActionKeyDigest }> }> }>;
  inventory: unknown;
  decision: Readonly<{ disposition: string; terminalAnchorRepairAllowed: boolean;
    actionKey: VerificationActionKeyDigest; terminalPayloadDigest: VerificationActionKeyDigest | null;
    decisionDigest: VerificationActionKeyDigest }>;
}

type ChildAuthority<V extends HostedActionTerminalValues> = Readonly<{
  providerEnvelope: V['providerEnvelope']; envelope: V['envelope']; resolution: V['resolution'];
}>;
type ProviderIndex<V extends HostedActionTerminalValues> = V['index'] & Readonly<{
  startObservations: readonly (V['start'] & Readonly<{ payload: V['marker'] | null }>)[];
  terminalObservations: readonly (V['terminal'] & Readonly<{ artifact: V['artifact'] | null;
    providerObservation: Readonly<{ payload: Readonly<{ payloadDigest: VerificationActionKeyDigest;
      producer: V['producer'] }> | null }> }>)[];
  terminalAnchorObservations: readonly Readonly<{ expired: boolean; payload: V['anchor'] | null }>[];
  providerStatusReadbacks: readonly Readonly<{ statuses: readonly V['status'][] }>[];
}>;
type ProviderTransaction<V extends HostedActionTerminalValues> = V['transaction'] & Readonly<{
  snapshot: V['snapshot'] & Readonly<{
    terminalAnchorObservations: readonly Readonly<{ expired: boolean; payload: V['anchor'] | null }>[];
  }>;
}>;

export interface HostedActionTerminalPorts<V extends HostedActionTerminalValues> {
  readProviderEnvelope(path: string): V['providerEnvelope'];
  readHostedEnvelope(path: string): V['envelope'];
  readResolution(path: string): V['resolution'];
  readExecutionTicket(path: string): V['ticket'];
  readRawResult(path: string): V['rawResult'];
  canonicalSource(value: unknown): string;
  parseActionRequest(source: string): V['actionRequest'];
  resolveAction(input: Readonly<{ request: V['actionRequest']; envelope: V['envelope'] }>): V['resolution'];
  coordinateChild(authority: ChildAuthority<V>): Promise<ProviderTransaction<V>>;
  producer(): V['producer'];
  repositoryIdentity(): V['repositoryIdentity'];
  providerIndex(snapshot: V['snapshot']): ProviderIndex<V>;
  reduceProvider(input: Readonly<{ resolution: V['resolution']; index: V['index'] }> & V['repositoryIdentity']): V['decision'];
  inventoryClosureFromTicket(ticket: V['ticket']): V['inventory'];
  rebuildTicket(input: Readonly<{ resolution: V['resolution']; marker: V['marker']; startObservation: V['start'];
    startStatus: V['status']; preparedCandidateArtifactName: string; preparedCandidateInventory: V['inventory'] }>): V['ticket'];
  assembleTerminal(input: Readonly<{ resolution: V['resolution']; ticket: V['ticket']; rawResult: V['rawResult'];
    expectedRawResultDigest: VerificationActionKeyDigest; producer: V['producer'] }>): V['artifact'];
  createAnchor(input: Readonly<{
    actionKey: VerificationActionKeyDigest; candidateSha: string; startStatusId: number; startStatusNodeId: string;
    startArtifactOriginId: string; startArtifactName: string; startArtifactArchiveDigest: VerificationActionKeyDigest;
    startMarkerDigest: VerificationActionKeyDigest; terminalArtifactOriginId: string; terminalArtifactName: string;
    terminalArtifactArchiveDigest: VerificationActionKeyDigest; terminalArtifactPayloadDigest: VerificationActionKeyDigest;
    terminalAssemblerOrigin: V['producer']; anchorPublisherOrigin: V['producer'];
  }>): V['anchor'];
  writeTerminal(path: string, artifact: V['artifact']): Promise<void>;
  writeAnchor(path: string, anchor: V['anchor']): Promise<void>;
  anchorTerminal(authority: ChildAuthority<V>, anchor: V['anchor']): Promise<ProviderTransaction<V>>;
  terminalArtifactName(actionKey: VerificationActionKeyDigest): string;
  terminalAnchorName(actionKey: VerificationActionKeyDigest): string;
}

export interface HostedActionTerminalInput {
  readonly providerEnvelopePath: string;
  readonly envelopePath: string;
  readonly resolutionPath: string;
}

function readChildAuthority<V extends HostedActionTerminalValues>(input: HostedActionTerminalInput,
  ports: HostedActionTerminalPorts<V>): ChildAuthority<V> {
  const providerEnvelope = ports.readProviderEnvelope(input.providerEnvelopePath);
  const envelope = ports.readHostedEnvelope(input.envelopePath);
  const resolution = ports.resolveAction({ request: ports.parseActionRequest(ports.canonicalSource(providerEnvelope.proposal)), envelope });
  const supplied = ports.readResolution(input.resolutionPath);
  if (ports.canonicalSource(supplied) !== ports.canonicalSource(resolution)) {
    throw new Error('caller Action resolution differs from the authenticated provider envelope.');
  }
  return Object.freeze({ providerEnvelope, envelope, resolution });
}

export async function assembleHostedActionTerminal<V extends HostedActionTerminalValues>(input: HostedActionTerminalInput & Readonly<{
  ticketPath: string; rawResultPath: string; expectedRawResultDigest: VerificationActionKeyDigest; outputPath: string;
}>, ports: HostedActionTerminalPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const ticket = ports.readExecutionTicket(input.ticketPath);
  const rawResult = ports.readRawResult(input.rawResultPath);
  const observed = await ports.coordinateChild(authority);
  if (observed.disposition !== 'observed') {
    throw new Error(`Hosted Action assembler provider observation returned ${observed.disposition}.`);
  }
  const producer = ports.producer();
  if (ports.canonicalSource(producer) !== ports.canonicalSource(ticket.producer)) {
    throw new Error('Hosted Action terminal assembler is not the original trusted claim run.');
  }
  const index = ports.providerIndex(observed.snapshot);
  const startObservation = index.startObservations[0];
  const startStatus = index.providerStatusReadbacks[0]?.statuses.find(entry => entry.id === ticket.startStatusId);
  if (index.startObservations.length !== 1 || startObservation === undefined || startStatus === undefined
    || index.terminalObservations.length !== 0 || index.terminalAnchorObservations.length !== 0
    || startObservation.payload === null) {
    throw new Error('Hosted Action assembler does not own the sole exact unresolved start ticket.');
  }
  const rebuiltTicket = ports.rebuildTicket({ resolution: authority.resolution, marker: startObservation.payload,
    startObservation, startStatus, preparedCandidateArtifactName: ticket.preparedCandidateArtifactName,
    preparedCandidateInventory: ports.inventoryClosureFromTicket(ticket) });
  if (rebuiltTicket.ticketDigest !== ticket.ticketDigest) {
    throw new Error('Hosted Action assembler ticket no longer matches provider readback.');
  }
  const artifact = ports.assembleTerminal({ resolution: authority.resolution, ticket, rawResult,
    expectedRawResultDigest: input.expectedRawResultDigest, producer });
  await ports.writeTerminal(input.outputPath, artifact);
  return Object.freeze({ status: artifact.result.status, actionKey: artifact.actionPlan.action.actionKey,
    artifactName: ports.terminalArtifactName(artifact.actionPlan.action.actionKey), artifactDigest: artifact.artifactDigest,
    output: input.outputPath });
}

export async function prepareHostedActionTerminalAnchor<V extends HostedActionTerminalValues>(input: HostedActionTerminalInput & Readonly<{
  outputPath: string;
}>, ports: HostedActionTerminalPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const observed = await ports.coordinateChild(authority);
  if (observed.disposition !== 'observed') throw new Error(`hosted Action provider observation returned ${observed.disposition}.`);
  const index = ports.providerIndex(observed.snapshot);
  const decision = ports.reduceProvider({ resolution: authority.resolution, ...ports.repositoryIdentity(), index });
  if (decision.disposition !== 'repair-terminal-anchor' || !decision.terminalAnchorRepairAllowed) {
    throw new Error(`terminal anchor cannot be prepared from ${decision.disposition}.`);
  }
  const start = index.startObservations[0], terminal = index.terminalObservations[0];
  const status = index.providerStatusReadbacks[0]?.statuses.find(entry => entry.state === 'pending');
  if (start?.payload === null || start?.payload === undefined || start.archiveDigest === null
    || terminal?.artifact === null || terminal?.artifact === undefined
    || terminal.providerObservation.archiveDigest === null || terminal.providerObservation.payload === null || status === undefined) {
    throw new Error('terminal anchor lacks exact authenticated start and terminal bytes.');
  }
  const anchor = ports.createAnchor({ actionKey: authority.resolution.actionPlan.action.actionKey,
    candidateSha: authority.resolution.artifactInput.headSha, startStatusId: status.id, startStatusNodeId: status.nodeId,
    startArtifactOriginId: start.originId, startArtifactName: start.artifactName,
    startArtifactArchiveDigest: start.archiveDigest, startMarkerDigest: start.payload.markerDigest,
    terminalArtifactOriginId: terminal.providerObservation.originId, terminalArtifactName: terminal.providerObservation.artifactName,
    terminalArtifactArchiveDigest: terminal.providerObservation.archiveDigest,
    terminalArtifactPayloadDigest: terminal.providerObservation.payload.payloadDigest,
    terminalAssemblerOrigin: terminal.providerObservation.payload.producer, anchorPublisherOrigin: ports.producer() });
  await ports.writeAnchor(input.outputPath, anchor);
  return Object.freeze({ status: 'anchor-prepared' as const, actionKey: anchor.actionKey,
    anchorName: ports.terminalAnchorName(anchor.actionKey), anchorDigest: anchor.anchorDigest, output: input.outputPath });
}

export async function anchorHostedActionTerminal<V extends HostedActionTerminalValues>(input: HostedActionTerminalInput,
  ports: HostedActionTerminalPorts<V>) {
  const authority = readChildAuthority(input, ports);
  const before = await ports.coordinateChild(authority);
  const anchor = before.snapshot.terminalAnchorObservations[0];
  if (before.disposition !== 'observed' || before.snapshot.terminalAnchorObservations.length !== 1
    || anchor?.expired !== false || anchor.payload === null) {
    throw new Error('anchor-terminal requires one exact uploaded terminal anchor.');
  }
  const result = await ports.anchorTerminal(authority, anchor.payload);
  if ((result.disposition !== 'terminal-anchored' && result.disposition !== 'complete') || result.status === null) {
    throw new Error(`neutral terminal tombstone was not anchored: ${result.reason ?? result.disposition}.`);
  }
  const index = ports.providerIndex(result.snapshot);
  const decision = ports.reduceProvider({ resolution: authority.resolution, ...ports.repositoryIdentity(), index });
  if (decision.disposition !== 'terminal-anchored') throw new Error('neutral terminal tombstone did not read back as terminal-anchored.');
  return Object.freeze({ status: 'terminal-anchored' as const, actionKey: decision.actionKey,
    terminalPayloadDigest: decision.terminalPayloadDigest, decisionDigest: decision.decisionDigest });
}
