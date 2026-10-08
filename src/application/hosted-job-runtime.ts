/** Selection is a closed transport shape. Only the original authenticated
 * provider observation and canonical per-job policy may admit the phase. */
export function selectHostedJobRuntimePhase(input: Readonly<{
  argv: readonly string[];
  authenticatedJobId: string;
  authenticatedPhase: string;
}>): string {
  const { argv } = input;
  if (argv.length !== 4 || argv[0] !== '--job' || argv[2] !== '--phase'
      || argv[1] !== input.authenticatedJobId || argv[3] !== input.authenticatedPhase) {
    throw new Error('Hosted launcher selectors differ from the authenticated job and active phase.');
  }
  return input.authenticatedPhase;
}

type SutResolution<Key extends string> = Readonly<{
  resolutionDigest: string;
  actionPlan: Readonly<{ action: Readonly<{ actionKey: Key }> }>;
  artifactInput: Readonly<{ headSha: string; candidateBytesDigest: string }>;
}>;

type SutTicket<Key extends string> = Readonly<{
  resolutionDigest: string;
  actionKey: Key;
  candidateSha: string;
  candidateBytesDigest: string;
}>;

/** Application decides whether a real SUT probe is a usable capability and
 * projects the original physical observation. The ports supply native facts. */
export async function runHostedSutPreflight<
  Key extends `sha256:${string}`,
  Resolution extends SutResolution<Key>,
  Invocation,
  Observation extends Readonly<{ state: string; diagnostic?: string | null }>
>(ports: Readonly<{
  readResolution(): Resolution;
  issueInvocation(actionKey: Key): Invocation;
  probe(input: Readonly<{ actionKey: Key }>, invocation: Invocation): Promise<Observation>;
  policyDigest: string;
}>) {
  const resolution = ports.readResolution();
  const actionKey = resolution.actionPlan.action.actionKey;
  const observation = await ports.probe({ actionKey }, ports.issueInvocation(actionKey));
  if (observation.state === 'unknown') {
    throw new Error(`Hosted Action sandbox capability is a retryable unknown machine observation: ${observation.diagnostic ?? 'no diagnostic'}`);
  }
  const { state, ...physicalObservation } = observation;
  return Object.freeze({ schema: 'sec-verification-action-sut-capability-v2' as const,
    status: state, actionKey, policyDigest: ports.policyDigest,
    observation: Object.freeze(physicalObservation) });
}

/** Resolution/ticket identity, preparation order, original SUT execution and
 * result publication are one application use case. Every effect is a narrow
 * injected owner operation; transport paths never grant admission. */
export async function runHostedSutExecution<
  Key extends `sha256:${string}`,
  Resolution extends SutResolution<Key>,
  Ticket extends SutTicket<Key>,
  Inventory,
  Prepared,
  Invocation,
  RawResult extends Readonly<{ rawResultDigest: string }>
>(input: Readonly<{ candidateArchive: string; outputPath: string }>, ports: Readonly<{
  readResolution(): Resolution;
  readTicket(): Ticket;
  issueInvocation(actionKey: Key): Invocation;
  materializeCandidate(source: Readonly<{
    resolution: Resolution; ticket: Ticket; candidateArchive: string;
  }>): Inventory;
  prepare(source: Readonly<{
    resolution: Resolution; ticket: Ticket; candidateArchive: string;
    archiveInventory: Inventory;
  }>): Prepared;
  run(prepared: Prepared, invocation: Invocation): Promise<RawResult>;
  writeResult(outputPath: string, result: RawResult): void;
}>): Promise<string> {
  const resolution = ports.readResolution();
  const ticket = ports.readTicket();
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const invocation = ports.issueInvocation(resolution.actionPlan.action.actionKey);
  const source = Object.freeze({ resolution, ticket, candidateArchive: input.candidateArchive });
  const archiveInventory = ports.materializeCandidate(source);
  const prepared = ports.prepare(Object.freeze({ ...source, archiveInventory }));
  const rawResult = await ports.run(prepared, invocation);
  ports.writeResult(input.outputPath, rawResult);
  return JSON.stringify({ rawResultDigest: rawResult.rawResultDigest, output: input.outputPath });
}
