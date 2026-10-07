import { expect, test } from 'bun:test';
import { sha256 } from '../../contracts/canonical.ts';
import {
  createOperationEffectGrantAuthority,
  OperationEffectGrantError,
  type IssuedOperationEffectGrant
} from './effect-grant.ts';
import {
  compileSemanticOperationIntent,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest,
  type SemanticOperationIntent,
  type SemanticOperationPlan
} from './semantic.ts';

const digest = (value: string): OperationDigest => sha256(value) as OperationDigest;

function intent(input: Readonly<{
  readonly operation?: string;
  readonly intent?: string;
  readonly decision?: string;
}> = {}): SemanticOperationIntent {
  return compileSemanticOperationIntent({
    operation: input.operation ?? 'development.commit',
    intentDigest: digest(input.intent ?? 'staged-candidate'),
    decisionDigest: digest(input.decision ?? 'candidate-admitted'),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 60_000 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'development.commit.git',
      contractDigest: digest('git-effect-contract'),
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['external-mutation', 'process-failure']
    }]
  });
}

function plan(
  operation: SemanticOperationIntent,
  issued: IssuedOperationEffectGrant,
  input: Readonly<{
    readonly authorityGrantDigest?: OperationDigest;
    readonly deadlineAtUnixMs?: number;
  }> = {}
): SemanticOperationPlan {
  return compileSemanticOperationPlan({
    operation: operation.identity.operation,
    intentDigest: operation.identity.intentDigest,
    decisionDigest: operation.identity.decisionDigest,
    aggregateBudgets: operation.execution.aggregateBudgets,
    requirements: operation.execution.requirements,
    deadlineAtUnixMs: input.deadlineAtUnixMs ?? issued.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: input.authorityGrantDigest ?? issued.authorityGrantDigest
    })
  });
}

function expectReason(action: () => unknown, reason: OperationEffectGrantError['reason']): void {
  try {
    action();
    throw new Error('expected Effect grant rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(OperationEffectGrantError);
    expect((error as OperationEffectGrantError).reason).toBe(reason);
  }
}

test('owner-issued Effect grant binds one exact semantic attempt and is consumed once', () => {
  const authority = createOperationEffectGrantAuthority({
    semanticOperation: 'development.commit',
    issuerIdentityDigest: digest('candidate-admission-owner')
  });
  const semanticIntent = intent();
  const currentEpochDigest = digest('repository-index-epoch');
  const issued = authority.issuer.issue({
    operation: semanticIntent,
    currentEpochDigest,
    deadlineAtUnixMs: Date.now() + 60_000
  });
  const semanticPlan = plan(semanticIntent, issued);
  const binding = authority.consumer.consume({
    grant: issued.grant,
    operation: semanticPlan,
    currentEpochDigest
  });

  expect(binding).toMatchObject({
    authorityGrantDigest: issued.authorityGrantDigest,
    operationIdentityDigest: semanticPlan.identity.identityDigest,
    executionPlanDigest: semanticPlan.execution.executionPlanDigest,
    attemptDigest: semanticPlan.attempt.attemptDigest,
    currentEpochDigest,
    deadlineAtUnixMs: issued.deadlineAtUnixMs
  });
  expect(binding.attemptBindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expectReason(() => authority.consumer.consume({
    grant: issued.grant,
    operation: semanticPlan,
    currentEpochDigest
  }), 'already-consumed');
});

test('grant serialization, cloning and another authority cannot reproduce Effect authority', () => {
  const authority = createOperationEffectGrantAuthority({
    semanticOperation: 'development.commit',
    issuerIdentityDigest: digest('candidate-admission-owner')
  });
  const foreignAuthority = createOperationEffectGrantAuthority({
    semanticOperation: 'development.commit',
    issuerIdentityDigest: digest('candidate-admission-owner')
  });
  const semanticIntent = intent();
  const currentEpochDigest = digest('repository-index-epoch');
  const issued = authority.issuer.issue({
    operation: semanticIntent,
    currentEpochDigest,
    deadlineAtUnixMs: Date.now() + 60_000
  });
  const semanticPlan = plan(semanticIntent, issued);
  const cloned = structuredClone(issued.grant);
  const parsed = JSON.parse(JSON.stringify(issued.grant));

  for (const grant of [cloned, parsed]) {
    expectReason(() => authority.consumer.consume({
      grant,
      operation: semanticPlan,
      currentEpochDigest
    }), 'foreign-grant');
  }
  expectReason(() => foreignAuthority.consumer.consume({
    grant: issued.grant,
    operation: semanticPlan,
    currentEpochDigest
  }), 'foreign-grant');
});

test('consumer rejects operation, intent, decision, epoch, deadline and attempt drift', () => {
  const make = () => {
    const authority = createOperationEffectGrantAuthority({
      semanticOperation: 'development.commit',
      issuerIdentityDigest: digest('candidate-admission-owner')
    });
    const semanticIntent = intent();
    const currentEpochDigest = digest('repository-index-epoch');
    const issued = authority.issuer.issue({
      operation: semanticIntent,
      currentEpochDigest,
      deadlineAtUnixMs: Date.now() + 60_000
    });
    return { authority, semanticIntent, currentEpochDigest, issued };
  };
  const cases = [
    {
      reason: 'operation-mismatch' as const,
      changed: intent({ operation: 'development.publish' })
    },
    {
      reason: 'intent-mismatch' as const,
      changed: intent({ intent: 'different-staged-candidate' })
    },
    {
      reason: 'decision-mismatch' as const,
      changed: intent({ decision: 'candidate-rejected' })
    }
  ];
  for (const candidate of cases) {
    const state = make();
    expectReason(() => state.authority.consumer.consume({
      grant: state.issued.grant,
      operation: plan(candidate.changed, state.issued),
      currentEpochDigest: state.currentEpochDigest
    }), candidate.reason);
  }

  const epoch = make();
  expectReason(() => epoch.authority.consumer.consume({
    grant: epoch.issued.grant,
    operation: plan(epoch.semanticIntent, epoch.issued),
    currentEpochDigest: digest('replaced-repository-index-epoch')
  }), 'epoch-mismatch');

  const deadline = make();
  expectReason(() => deadline.authority.consumer.consume({
    grant: deadline.issued.grant,
    operation: plan(deadline.semanticIntent, deadline.issued, {
      deadlineAtUnixMs: deadline.issued.deadlineAtUnixMs + 1
    }),
    currentEpochDigest: deadline.currentEpochDigest
  }), 'deadline-mismatch');

  const execution = make();
  const changedExecution = compileSemanticOperationIntent({
    operation: execution.semanticIntent.identity.operation,
    intentDigest: execution.semanticIntent.identity.intentDigest,
    decisionDigest: execution.semanticIntent.identity.decisionDigest,
    aggregateBudgets: [
      ...execution.semanticIntent.execution.aggregateBudgets,
      { resource: 'records', maximum: 1 }
    ],
    requirements: execution.semanticIntent.execution.requirements
  });
  expectReason(() => execution.authority.consumer.consume({
    grant: execution.issued.grant,
    operation: plan(changedExecution, execution.issued),
    currentEpochDigest: execution.currentEpochDigest
  }), 'execution-plan-mismatch');

  const attempt = make();
  expectReason(() => attempt.authority.consumer.consume({
    grant: attempt.issued.grant,
    operation: plan(attempt.semanticIntent, attempt.issued, {
      authorityGrantDigest: digest('foreign-authority-grant')
    }),
    currentEpochDigest: attempt.currentEpochDigest
  }), 'grant-attempt-mismatch');
});

test('expired grants are rejected before issue or consumption', async () => {
  const authority = createOperationEffectGrantAuthority({
    semanticOperation: 'development.commit',
    issuerIdentityDigest: digest('candidate-admission-owner')
  });
  const semanticIntent = intent();
  const currentEpochDigest = digest('repository-index-epoch');
  expectReason(() => authority.issuer.issue({
    operation: semanticIntent,
    currentEpochDigest,
    deadlineAtUnixMs: Date.now()
  }), 'expired');

  const issued = authority.issuer.issue({
    operation: semanticIntent,
    currentEpochDigest,
    deadlineAtUnixMs: Date.now() + 50
  });
  const semanticPlan = plan(semanticIntent, issued);
  await Bun.sleep(60);
  expectReason(() => authority.consumer.consume({
    grant: issued.grant,
    operation: semanticPlan,
    currentEpochDigest
  }), 'expired');
});
