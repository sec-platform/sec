import { isNativeAborted } from '../contracts/native-abort.ts';

/** This use case chooses business continuations. Supplied capabilities retain
 * source interpretation, qualification, effect admission and settlement. */
export interface SourceProgramTransitionRequest {
  readonly purpose: 'inspect' | 'integrate';
  readonly candidateRoot: string;
  readonly baseSha: string;
  readonly headSha: string;
}

export interface SourceProgramTransitionControl {
  readonly deadlineAtUnixMs: number;
  readonly signal?: AbortSignal;
}

export type SourceProgramTransitionFacts<Facts> =
  | Readonly<{ kind: 'complete'; facts: Facts; acquisition: 'executed' | 'reused' | 'joined' }>
  | Readonly<{ kind: 'incomplete' | 'cancelled'; reason: string }>;

export type SourceProgramTransitionDecision<Adoption> =
  | Readonly<{ kind: 'accepted'; adoption: Adoption }>
  | Readonly<{ kind: 'needs-author'; needs: readonly string[]; blockers: readonly string[] }>
  | Readonly<{ kind: 'blocked'; blockers: readonly string[] }>;

export type SourceProgramTransitionVerification<Verification> =
  | Readonly<{ kind: 'satisfied'; verification: Verification }>
  | Readonly<{ kind: 'not-satisfied' | 'incomplete' | 'cancelled'; verification: Verification }>;

export interface SourceProgramTransitionInspectionPorts<Facts> {
  acquireFacts(request: SourceProgramTransitionRequest, control: SourceProgramTransitionControl): Promise<SourceProgramTransitionFacts<Facts>>;
}

export interface SourceProgramTransitionIntegrationPorts<Facts, Approval, Adoption, Verification, Accepted>
  extends SourceProgramTransitionInspectionPorts<Facts> {
  /** Must validate the original live issuer; a serialized shape is insufficient. */
  assertFactsQualified(facts: Facts, request: SourceProgramTransitionRequest): void;
  observeAuthor(facts: Facts, request: SourceProgramTransitionRequest, control: SourceProgramTransitionControl): Promise<Approval | null>;
  adopt(facts: Facts, approval: Approval | null): SourceProgramTransitionDecision<Adoption>;
  /** The execution owner may run independent checks while facts are produced.
   * Its final aggregate must join the exact source Action, never fabricate it. */
  runVerification(request: SourceProgramTransitionRequest, control: SourceProgramTransitionControl,
    source: Promise<SourceProgramTransitionFacts<Facts>>): Promise<SourceProgramTransitionVerification<Verification>>;
  reobserve(facts: Facts, approval: Approval | null, request: SourceProgramTransitionRequest,
    control: SourceProgramTransitionControl): Promise<void>;
  finalize(facts: Facts, adoption: Adoption, verification: Verification): Accepted;
}

export type SourceProgramTransitionPort =
  | 'acquireFacts' | 'assertFactsQualified' | 'observeAuthor' | 'adopt'
  | 'runVerification' | 'reobserve' | 'finalize';

/** The routes below are consumed by the use case and its read projection.
 * They are fixed business control, not a caller-programmable workflow engine. */
export const SOURCE_PROGRAM_TRANSITION_CONTROL = Object.freeze({
  entry: 'runSourceProgramTransition',
  source: 'src/application/source-program-transition.ts',
  design: 'docs/开发/测试发现与执行.md#source-transition-qualified-fact-flow',
  purposes: Object.freeze({
    inspect: Object.freeze(['acquireFacts'] as const),
    integrate: Object.freeze(['acquireFacts', 'runVerification'] as const)
  }),
  afterSource: Object.freeze({
    inspect: Object.freeze({ complete: 'observed', incomplete: 'incomplete', cancelled: 'cancelled' } as const),
    integrate: Object.freeze({ complete: 'assertFactsQualified', incomplete: 'incomplete', cancelled: 'cancelled' } as const)
  }),
  qualifiedFacts: Object.freeze(['assertFactsQualified', 'observeAuthor', 'adopt'] as const),
  afterAdoption: Object.freeze({ accepted: 'join-verification', 'needs-author': 'needs-author', blocked: 'blocked' } as const),
  afterVerification: Object.freeze({ satisfied: 'reobserve', 'not-satisfied': 'blocked', incomplete: 'incomplete', cancelled: 'cancelled' } as const),
  accepted: Object.freeze(['reobserve', 'finalize'] as const)
});

export interface SourceProgramTransitionStepObservation {
  readonly port: SourceProgramTransitionPort;
  readonly state: 'started' | 'completed' | 'failed';
}

export interface SourceProgramTransitionOutcome<Facts, Adoption, Verification, Accepted> {
  readonly status: 'observed' | 'accepted' | 'needs-author' | 'blocked' | 'incomplete' | 'cancelled' | 'failed';
  readonly source: SourceProgramTransitionFacts<Facts> | null;
  readonly decision: SourceProgramTransitionDecision<Adoption> | null;
  readonly verification: SourceProgramTransitionVerification<Verification> | null;
  readonly accepted: Accepted | null;
  readonly failures: readonly Readonly<{ port: SourceProgramTransitionPort; cause: unknown }>[];
  readonly steps: readonly SourceProgramTransitionStepObservation[];
}

function integrationPorts<Facts, Approval, Adoption, Verification, Accepted>(
  ports: SourceProgramTransitionInspectionPorts<Facts> | SourceProgramTransitionIntegrationPorts<Facts, Approval, Adoption, Verification, Accepted>
): SourceProgramTransitionIntegrationPorts<Facts, Approval, Adoption, Verification, Accepted> {
  for (const port of [...SOURCE_PROGRAM_TRANSITION_CONTROL.qualifiedFacts,
    SOURCE_PROGRAM_TRANSITION_CONTROL.purposes.integrate[1], ...SOURCE_PROGRAM_TRANSITION_CONTROL.accepted]) {
    if (!(port in ports) || typeof ports[port as keyof typeof ports] !== 'function') {
      throw new TypeError(`Source transition integration requires its ${port} owner`);
    }
  }
  return ports as SourceProgramTransitionIntegrationPorts<Facts, Approval, Adoption, Verification, Accepted>;
}

/** Complete cold-source business entry shared by inspection and integration.
 * Neither this coordinator nor its readable control structure grants authority. */
export async function runSourceProgramTransition<Facts, Approval = never, Adoption = never, Verification = never, Accepted = never>(
  request: SourceProgramTransitionRequest,
  control: SourceProgramTransitionControl,
  ports: SourceProgramTransitionInspectionPorts<Facts> | SourceProgramTransitionIntegrationPorts<Facts, Approval, Adoption, Verification, Accepted>
): Promise<SourceProgramTransitionOutcome<Facts, Adoption, Verification, Accepted>> {
  const captured = Object.freeze({ purpose: request.purpose, candidateRoot: request.candidateRoot,
    baseSha: request.baseSha, headSha: request.headSha });
  const admitted = Object.freeze({ deadlineAtUnixMs: control.deadlineAtUnixMs, signal: control.signal });
  if (captured.purpose !== 'inspect' && captured.purpose !== 'integrate') {
    throw new TypeError('Source transition requires an explicit inspection or integration purpose');
  }
  const steps: SourceProgramTransitionStepObservation[] = [];
  const failures: Array<Readonly<{ port: SourceProgramTransitionPort; cause: unknown }>> = [];
  let source: SourceProgramTransitionFacts<Facts> | null = null;
  let decision: SourceProgramTransitionDecision<Adoption> | null = null;
  let verification: SourceProgramTransitionVerification<Verification> | null = null;
  const finish = (status: SourceProgramTransitionOutcome<Facts, Adoption, Verification, Accepted>['status'], accepted: Accepted | null = null) => Object.freeze({
    status, source, decision, verification, accepted,
    failures: Object.freeze([...failures]), steps: Object.freeze([...steps])
  });
  const invoke = async <Value>(port: SourceProgramTransitionPort, operation: () => Value | Promise<Value>): Promise<Value> => {
    steps.push(Object.freeze({ port, state: 'started' }));
    try {
      const value = await operation();
      steps.push(Object.freeze({ port, state: 'completed' }));
      return value;
    } catch (cause) {
      failures.push(Object.freeze({ port, cause }));
      steps.push(Object.freeze({ port, state: 'failed' }));
      throw cause;
    }
  };
  if (isNativeAborted(admitted.signal)) return finish('cancelled');
  const integrated = captured.purpose === 'integrate' ? integrationPorts(ports) : null;
  const sourcePort = SOURCE_PROGRAM_TRANSITION_CONTROL.purposes[captured.purpose][0];
  const sourceTask = invoke(sourcePort, () => ports[sourcePort](captured, admitted));
  // Start independent work through its existing owner. Always join its actual
  // terminal, including when source acquisition or adoption fails.
  const verificationPort = SOURCE_PROGRAM_TRANSITION_CONTROL.purposes.integrate[1];
  const verificationTask = integrated === null ? null
    : invoke(verificationPort, () => integrated[verificationPort](captured, admitted, sourceTask));
  // Observe both rejections immediately; an owner remains responsible for its
  // resource settlement before resolving or rejecting the supplied promise.
  const joined = Promise.allSettled([sourceTask, ...(verificationTask === null ? [] : [verificationTask])]);
  let proposedStatus: SourceProgramTransitionOutcome<Facts, Adoption, Verification, Accepted>['status'] = 'failed';
  let approval: Approval | null = null;
  try {
    source = await sourceTask;
    const route = SOURCE_PROGRAM_TRANSITION_CONTROL.afterSource[captured.purpose][source.kind];
    if (route !== 'assertFactsQualified') {
      proposedStatus = route;
    } else if (integrated !== null && source.kind === 'complete') {
      const facts = source.facts;
      const [qualify, observe, adopt] = SOURCE_PROGRAM_TRANSITION_CONTROL.qualifiedFacts;
      await invoke(qualify, () => integrated[qualify](facts, captured));
      approval = await invoke(observe, () => integrated[observe](facts, captured, admitted));
      decision = await invoke(adopt, () => integrated[adopt](facts, approval));
      const next = SOURCE_PROGRAM_TRANSITION_CONTROL.afterAdoption[decision.kind];
      proposedStatus = next === 'join-verification' ? 'accepted' : next;
    }
  } catch {
    // The exact cause is retained above; another independently running owner
    // must still reach its actual terminal before this use case returns.
    proposedStatus = 'failed';
  }
  const settled = await joined;
  if (verificationTask !== null && settled[1]?.status === 'fulfilled') {
    verification = settled[1].value as SourceProgramTransitionVerification<Verification>;
    const route = SOURCE_PROGRAM_TRANSITION_CONTROL.afterVerification[verification.kind];
    if (route !== 'reobserve') proposedStatus = route;
  }
  if (failures.length > 0) return finish('failed');
  if (proposedStatus !== 'accepted' || integrated === null || source?.kind !== 'complete'
      || decision?.kind !== 'accepted' || verification?.kind !== 'satisfied') return finish(proposedStatus);
  const facts = source.facts;
  const adoption = decision.adoption;
  const verified = verification.verification;
  try {
    const [reobserve, finalize] = SOURCE_PROGRAM_TRANSITION_CONTROL.accepted;
    await invoke(reobserve, () => integrated[reobserve](facts, approval, captured, admitted));
    const accepted = await invoke(finalize, () => integrated[finalize](facts, adoption, verified));
    return finish('accepted', accepted);
  } catch {
    return finish('failed');
  }
}
