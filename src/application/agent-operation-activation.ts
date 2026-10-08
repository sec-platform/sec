/** Native values retain their original concrete contracts. These bounds expose
 * only the fields used by this use case's phase and ancestor decisions. */
export interface HostedActivationValues {
  request: Readonly<{ phase: 'prepare' | 'finalize'; pullRequestNumber: number;
    expectedBaseSha: string; expectedHeadSha: string; manifestPath: string;
    manifestDigest: `sha256:${string}`; preparationCommentId: number | null;
    requestOperationId: `sha256:${string}` }>;
  provider: Readonly<{ workflowSha: string }>;
  decision: Readonly<{ repository: string; exactMain: string }>;
  control: Readonly<{ manifestPath: string; manifestDigest: `sha256:${string}` }>;
  binding: unknown;
  pullRequest: Readonly<{ headRef: string }>;
  records: unknown;
  preparation: Readonly<{ request: HostedActivationValues['request']; trustedBaseSha: string;
    proposal: Readonly<{ headSha: string; headRef: string; manifestPath: string;
      manifestDigest: `sha256:${string}` }> }>;
  receipt: unknown;
  publication: Readonly<{ request: HostedActivationValues['request']; provider: HostedActivationValues['provider'] }>;
}

interface HostedActivationNativePorts<V extends HostedActivationValues> {
  repositoryRoot(value: string): string;
  readRequest(path: string): V['request'];
  provider(): V['provider'];
  assertCleanExactRoot(root: string, revision: string): void;
  workDecision(root: string): Promise<V['decision']>;
  assertRequestBindings(request: V['request'], provider: V['provider'], decision: V['decision'], root: string): void;
  readControl(root: string, revision: string, decision: V['decision']): V['control'];
  workBinding(decision: V['decision'], control: V['control'], phase: 'prepare' | 'finalize'): V['binding'];
  headRef(): string;
  pullRequest(decision: V['decision'], request: V['request'], headRef: string, root: string): V['pullRequest'];
  changedRecords(root: string, base: string, head: string): V['records'];
  changedPaths(records: V['records']): readonly string[];
  assertChangedRecords(control: V['control'], records: V['records']): void;
  observeOwners(root: string, decision: V['decision'], head: string, control: V['control'], paths: readonly string[]): void;
  assertPreparationSelection(control: V['control'], decision: V['decision']): void;
  assertPreparationProposal(records: V['records'], control: V['control'], base: string, head: string, root: string): void;
  createPreparation(input: Readonly<{ request: V['request']; provider: V['provider']; decision: V['decision'];
    control: V['control']; binding: V['binding']; pullRequest: V['pullRequest']; paths: readonly string[] }>): V['preparation'];
  createReceipt(input: Readonly<{ request: V['request']; preparation: V['preparation']; provider: V['provider'];
    decision: V['decision']; control: V['control']; pullRequest: V['pullRequest']; paths: readonly string[] }>): V['receipt'];
  publications(root: string, repository: string, pr: number): readonly Readonly<{
    publication: V['publication'] & Readonly<{ request: V['request']; provider: V['provider'] }>; commentId: number
  }>[];
  assertPublicationIdentities(publications: readonly Readonly<{ publication: V['publication']; commentId: number }>[]): void;
  selectPreparationAncestor(inventory: readonly Readonly<{
    publication: V['publication'] & Readonly<{ request: V['request']; provider: V['provider'] }>; commentId: number
  }>[], request: V['request'], control: V['control']): Readonly<{
    publication: V['publication'] & Readonly<{ request: V['request']; provider: V['provider'] }>; commentId: number
  }>;
  isAncestor(root: string, ancestor: string, descendant: string): boolean;
  assertProviderLive(root: string, repository: string, provider: V['provider']): void;
  artifactPayload(root: string, repository: string, publication: V['publication']): V['preparation'] | V['receipt'];
  preparationPayload(payload: V['preparation'] | V['receipt']): V['preparation'];
  assertFinalOperationBinding(decision: V['decision'], preparation: V['preparation'], control: V['control'], binding: V['binding']): void;
  gitTree(root: string, revision: string): string;
  assertProposalReadback(tree: string, records: V['records'], proposal: V['control'], final: V['control'], preparation: V['preparation']): void;
  rebindProvider(payload: V['preparation'] | V['receipt'], provider: V['provider']): V['preparation'] | V['receipt'];
  equal(left: unknown, right: unknown): boolean;
  payloadDigest(payload: V['preparation'] | V['receipt']): `sha256:${string}`;
  writePayload(path: string, payload: V['preparation'] | V['receipt']): void;
  artifactName(phase: 'prepare' | 'finalize', requestId: `sha256:${string}`): string;
  readPublicationPayload(path: string, request: V['request'], provider: V['provider']): V['preparation'] | V['receipt'];
  createPublication(request: V['request'], payload: V['preparation'] | V['receipt'], provider: V['provider'], artifactId: string, digest: `sha256:${string}`): V['publication'];
  publicationRepository(root: string, provider: V['provider']): string;
  assertArtifactMetadata(root: string, repository: string, publication: V['publication']): void;
  publishComment(root: string, repository: string, publication: V['publication']): Readonly<{ commentId: number; publication: V['publication'] }>;
  unavailable(reason: 'activation-stale' | 'activation-receipt-absent' | 'activation-provider-readback-conflict', detail: string): never;
}

/** Pure projections may stay synchronous; observations and effects can borrow
 * the original asynchronous scope. Every use below joins the selected port. */
export type HostedActivationPorts<V extends HostedActivationValues> = {
  [K in keyof HostedActivationNativePorts<V>]: K extends 'unavailable'
    ? HostedActivationNativePorts<V>[K]
    : HostedActivationNativePorts<V>[K] extends (...args: infer A) => infer R
      ? (...args: A) => Awaited<R> | Promise<Awaited<R>>
      : never;
};

async function materializeOrReuse<V extends HostedActivationValues>(root: string, repository: string,
  request: V['request'], outputPath: string, value: V['preparation'] | V['receipt'], ports: HostedActivationPorts<V>) {
  const publications = await ports.publications(root, repository, request.pullRequestNumber);
  await ports.assertPublicationIdentities(publications);
  const matching = publications.filter(({ publication }) => publication.request.requestOperationId === request.requestOperationId);
  if (matching.length > 1) ports.unavailable('activation-provider-readback-conflict', request.requestOperationId);
  if (matching.length === 1) {
    const existing = matching[0]!;
    await ports.assertProviderLive(root, repository, existing.publication.provider);
    const payload = await ports.artifactPayload(root, repository, existing.publication);
    const expected = await ports.rebindProvider(value, existing.publication.provider);
    if (!await ports.equal(payload, expected)) ports.unavailable('activation-provider-readback-conflict', request.requestOperationId);
    return Object.freeze({ disposition: 'existing' as const, commentId: existing.commentId, payloadDigest: await ports.payloadDigest(payload) });
  }
  await ports.writePayload(outputPath, value);
  return Object.freeze({ disposition: 'created' as const, commentId: null, payloadDigest: await ports.payloadDigest(value) });
}

async function maximalPreparation<V extends HostedActivationValues>(root: string,
  repository: string, request: V['request'], control: V['control'], ports: HostedActivationPorts<V>) {
  const publications = await ports.publications(root, repository, request.pullRequestNumber);
  await ports.assertPublicationIdentities(publications);
  const selected = await ports.selectPreparationAncestor(publications, request, control);
  await ports.assertProviderLive(root, repository, selected.publication.provider);
  const preparation = await ports.preparationPayload(await ports.artifactPayload(root, repository, selected.publication));
  return Object.freeze({ commentId: selected.commentId, preparation });
}

export async function produceHostedAgentOperationActivation<V extends HostedActivationValues>(input: Readonly<{
  runtimeRoot: string; candidateRoot: string; requestPath: string; outputPath: string;
}>, ports: HostedActivationPorts<V>) {
  const runtimeRoot = await ports.repositoryRoot(input.runtimeRoot);
  const candidateRoot = await ports.repositoryRoot(input.candidateRoot);
  const request = await ports.readRequest(input.requestPath);
  const provider = await ports.provider();
  await ports.assertCleanExactRoot(runtimeRoot, provider.workflowSha);
  await ports.assertCleanExactRoot(candidateRoot, request.expectedHeadSha);
  const decision = await ports.workDecision(runtimeRoot);
  await ports.assertRequestBindings(request, provider, decision, candidateRoot);
  const control = await ports.readControl(candidateRoot, request.expectedHeadSha, decision);
  if (request.manifestPath !== control.manifestPath || request.manifestDigest !== control.manifestDigest) {
    ports.unavailable('activation-stale', 'request-manifest-binding-drift');
  }
  const binding = await ports.workBinding(decision, control, request.phase);
  const pullRequest = await ports.pullRequest(decision, request, await ports.headRef(), candidateRoot);
  const records = await ports.changedRecords(candidateRoot, request.expectedBaseSha, request.expectedHeadSha);
  const paths = await ports.changedPaths(records);
  await ports.assertChangedRecords(control, records);
  await ports.observeOwners(candidateRoot, decision, request.expectedHeadSha, control, paths);
  let value: V['preparation'] | V['receipt'];
  if (request.phase === 'prepare') {
    await ports.assertPreparationSelection(control, decision);
    await ports.assertPreparationProposal(records, control, request.expectedBaseSha, request.expectedHeadSha, candidateRoot);
    value = await ports.createPreparation({ request, provider, decision, control, binding, pullRequest, paths });
  } else {
    if (request.preparationCommentId === null) ports.unavailable('activation-stale', 'preparation-comment-id-missing');
    const maximal = await maximalPreparation(runtimeRoot, decision.repository, request, control, ports);
    if (request.preparationCommentId !== maximal.commentId) {
      ports.unavailable('activation-stale', 'caller-selected-PRE-is-not-unique-maximal-ancestor');
    }
    const preparation = maximal.preparation;
    if (!await ports.isAncestor(candidateRoot, preparation.proposal.headSha, request.expectedHeadSha)
      || preparation.request.pullRequestNumber !== request.pullRequestNumber
      || preparation.trustedBaseSha !== decision.exactMain || preparation.proposal.headRef !== pullRequest.headRef
      || preparation.proposal.manifestPath !== control.manifestPath || preparation.proposal.manifestDigest !== control.manifestDigest) {
      ports.unavailable('activation-stale', 'PRE-FINAL-stable-binding-drift');
    }
    await ports.assertFinalOperationBinding(decision, preparation, control, binding);
    const proposalTree = await ports.gitTree(candidateRoot, preparation.proposal.headSha);
    const proposalRecords = await ports.changedRecords(candidateRoot, decision.exactMain, preparation.proposal.headSha);
    const proposalControl = await ports.readControl(candidateRoot, preparation.proposal.headSha, decision);
    await ports.assertPreparationSelection(proposalControl, decision);
    await ports.assertPreparationProposal(proposalRecords, proposalControl, decision.exactMain, preparation.proposal.headSha, candidateRoot);
    await ports.assertProposalReadback(proposalTree, proposalRecords, proposalControl, control, preparation);
    value = await ports.createReceipt({ request, preparation, provider, decision, control, pullRequest, paths });
  }
  const publication = await materializeOrReuse(runtimeRoot, decision.repository, request, input.outputPath, value, ports);
  return Object.freeze({ ...publication, phase: request.phase, requestOperationId: request.requestOperationId,
    artifactName: await ports.artifactName(request.phase, request.requestOperationId) });
}

export async function publishHostedAgentOperationActivation<V extends HostedActivationValues>(input: Readonly<{
  runtimeRoot: string; requestPath: string; payloadPath: string; artifactId: string; artifactDigest: `sha256:${string}`;
}>, ports: HostedActivationPorts<V>): Promise<Readonly<{ commentId: number; publication: V['publication'] }>> {
  const runtimeRoot = await ports.repositoryRoot(input.runtimeRoot);
  const request = await ports.readRequest(input.requestPath);
  const provider = await ports.provider();
  await ports.assertCleanExactRoot(runtimeRoot, provider.workflowSha);
  const payload = await ports.readPublicationPayload(input.payloadPath, request, provider);
  const publication = await ports.createPublication(request, payload, provider, input.artifactId, input.artifactDigest);
  const repository = await ports.publicationRepository(runtimeRoot, provider);
  await ports.assertArtifactMetadata(runtimeRoot, repository, publication);
  return await ports.publishComment(runtimeRoot, repository, publication);
}
