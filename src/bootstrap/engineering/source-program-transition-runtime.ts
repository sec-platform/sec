import { repositoryAuditDeadline } from '../../adapters/repository/repository-audit/cli-contract.ts';
import { SourceProgramTransitionAdoptionBlockedError } from '../../adapters/repository/repository-audit/transition.ts';
import type { SourceProgramTestAuthorApproval } from '../../adapters/repository/source-program-model/test-disposition-decisions.ts';
import type {
  TrustedRuntimeSourceTransitionContext,
  TrustedRuntimeSourceTransitionUseCase
} from '../../adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import {
  SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT,
  sourceProgramAnalysisBinding
} from '../../adapters/verification/platform/action/contract/ci.ts';
import {
  assertTrustedRuntimeSourceProgramAction,
  assertTrustedRuntimeSourceProgramTransitionObservation,
  executeTrustedRuntimeContainerVerification,
  observeTrustedRuntimeSourceProgramTransition,
  produceTrustedRuntimeSourceProgramTransition,
  qualifySourceProgramTransitionAssessment,
  type SourceProgramTransitionQualification
} from '../../adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import {
  runSourceProgramTransition,
  type SourceProgramTransitionIntegrationPorts
} from '../../application/source-program-transition.ts';

type FirstFacts = Awaited<ReturnType<typeof produceTrustedRuntimeSourceProgramTransition>>;
type LegacyFacts = Awaited<ReturnType<typeof observeTrustedRuntimeSourceProgramTransition>>;
type Facts = FirstFacts | LegacyFacts;
type Verification = NonNullable<TrustedRuntimeSourceTransitionContext['previousVerification']>;
type Accepted = Readonly<{ qualification: SourceProgramTransitionQualification; verification: Verification }>;

/** One assembled use-case instance may retain its own completed live source
 * observation. This is not a persisted cache or a JSON restoration route. */
export function createTrustedSourceProgramTransitionUseCase(): TrustedRuntimeSourceTransitionUseCase {
  let retained: Readonly<{ sessionRevision: string; actionPlanDigest: string; facts: Facts }> | null = null;
  return async (context) => {
    const { envelope } = context;
    const binding = sourceProgramAnalysisBinding(context.sourceProgramTransition);
    const assertFacts = (facts: Facts): void => {
      assertTrustedRuntimeSourceProgramTransitionObservation(facts.observation);
      if (facts.observation.sessionRevision !== envelope.session.sessionRevision
          || facts.assessment.baseSha !== envelope.session.baseSha
          || facts.assessment.headSha !== envelope.session.headSha
          || facts.assessment.baseTreeSha !== envelope.session.baseTreeSha
          || facts.assessment.headTreeSha !== envelope.session.headTreeSha) {
        throw new Error('Retained source facts belong to another exact Session or subject');
      }
      if ('sourceAction' in facts) assertTrustedRuntimeSourceProgramAction(facts.sourceAction, { envelope });
    };
    const ports: SourceProgramTransitionIntegrationPorts<Facts, SourceProgramTestAuthorApproval,
      SourceProgramTransitionQualification, Verification, Accepted> = {
      /** Source provider owns isolated reads/processes, deadline, cancellation and settlement.
       * This closure owns only one live observation reference; exact Session and Action
       * checks precede reuse. A restart has no live reference and must acquire again.
       * publishAttempt writes only the borrowed closeout attempt journal. */
      acquireFacts: async (_request, control) => {
        if (retained !== null && retained.sessionRevision === envelope.session.sessionRevision
            && retained.actionPlanDigest === envelope.actionPlanClosure.actionPlanDigest) {
          assertFacts(retained.facts);
          return Object.freeze({ kind: 'complete', acquisition: 'reused', facts: retained.facts });
        }
        const facts: Facts = context.previousVerification === null
          ? await produceTrustedRuntimeSourceProgramTransition({
              repositoryRoot: context.repositoryRoot, envelope, sourceProgramTransition: binding,
              deadlineAtUnixMs: control.deadlineAtUnixMs,
              ...(control.signal === undefined ? {} : { signal: control.signal })
            })
          : await observeTrustedRuntimeSourceProgramTransition({
              repositoryRoot: context.repositoryRoot, envelope,
              ...context.previousVerification, sourceProgramTransition: binding,
              deadlineAtUnixMs: control.deadlineAtUnixMs,
              ...(control.signal === undefined ? {} : { signal: control.signal })
            });
        assertFacts(facts);
        context.publishAttempt(facts.attemptEvidence);
        retained = Object.freeze({ sessionRevision: envelope.session.sessionRevision,
          actionPlanDigest: envelope.actionPlanClosure.actionPlanDigest, facts });
        return Object.freeze({ kind: 'complete', acquisition: 'executed', facts });
      },
      /** Pure live-issuer and exact-subject validation; no effects or restoration. */
      assertFactsQualified: (facts) => assertFacts(facts),
      /** Borrow the provider's current comment, actor and permission observation.
       * No source fact or persisted approval authorizes this network read. */
      observeAuthor: async () => (await context.observeAuthorApproval()) ?? null,
      /** Existing qualification owner interprets immutable facts with live approval.
       * Unresolved author obligations return Needs; unrelated blockers remain. */
      adopt: (facts, approval) => {
        try {
          const adoption = qualifySourceProgramTransitionAssessment({ ...facts,
            ...(approval === null ? {} : { approval }) });
          return Object.freeze({ kind: 'accepted', adoption });
        } catch (error) {
          if (!(error instanceof SourceProgramTransitionAdoptionBlockedError)) throw error;
          return error.authorInputRequired
            ? Object.freeze({ kind: 'needs-author',
                needs: Object.freeze(['Resolve the exact supersession owner decision; other blockers remain independent']),
                blockers: error.blockingReasons })
            : Object.freeze({ kind: 'blocked', blockers: error.blockingReasons });
        }
      },
      /** Existing verification Actions own their effects, budgets and settlement.
       * The current batch requires sourceAction before launch; historical exact
       * completed verification can be reused. publishVerification owns state write. */
      runVerification: async (_request, _control, source) => {
        if (context.previousVerification !== null) return Object.freeze({
          kind: 'satisfied', verification: context.previousVerification
        });
        // This existing batch provider needs the source Action handoff before
        // publication. The dependency is real and remains visible; its own
        // verification Actions keep their separate admitted resource budgets.
        const acquired = await source;
        if (acquired.kind !== 'complete' || !('sourceAction' in acquired.facts)) {
          throw new Error('Fresh verification requires the actual first-qualified source Action');
        }
        const verification = await executeTrustedRuntimeContainerVerification({
          repositoryRoot: context.repositoryRoot, envelope,
          actorNodeId: context.actorNodeId, requiredBlobs: context.requiredBlobs,
          sourceProgramTransition: binding, sourceAction: acquired.facts.sourceAction
        });
        context.publishVerification(verification);
        return Object.freeze({ kind: 'satisfied', verification });
      },
      /** Re-read author/permission and current PR subject before effect eligibility.
       * The provider owns network admission; drift invalidates this adoption. */
      reobserve: async (_facts, approval) => {
        const current = (await context.observeAuthorApproval()) ?? null;
        if (current?.approvalDigest !== approval?.approvalDigest
            || current?.providerObservationDigest !== approval?.providerObservationDigest) {
          throw new Error('Source transition author statement or current permission drifted');
        }
        await context.assertCurrentSubject();
      },
      /** Publish only the live qualified adoption through the borrowed state owner.
       * This value does not merge, grant permission, or certify main health. */
      finalize: (_facts, qualification, verification) => {
        context.publishAdoption(qualification);
        return Object.freeze({ qualification, verification });
      }
    };
    const result = await runSourceProgramTransition({ purpose: 'integrate',
      candidateRoot: SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT,
      baseSha: envelope.session.baseSha, headSha: envelope.session.headSha
    }, { deadlineAtUnixMs: repositoryAuditDeadline() }, ports);
    if (result.status === 'accepted' && result.accepted !== null) {
      return Object.freeze({ kind: 'accepted', ...result.accepted });
    }
    if (result.failures.length === 1) throw result.failures[0]!.cause;
    if (result.failures.length > 1) throw new AggregateError(result.failures.map(({ cause }) => cause),
      'Source transition owners failed');
    return Object.freeze({ kind: 'waiting', value: Object.freeze({
      status: result.status, sessionRevision: envelope.session.sessionRevision,
      source: result.source?.kind ?? 'not-produced',
      assessmentDigest: result.source?.kind === 'complete' ? result.source.facts.assessment.assessmentDigest : null,
      decision: result.decision, verification: result.verification?.kind ?? 'not-produced', steps: result.steps
    }) });
  };
}
