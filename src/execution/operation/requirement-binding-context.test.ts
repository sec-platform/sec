import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  consumeOperationRequirementBindingContext,
  issueOperationRequirementBindingContext,
  OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE,
  type OperationRequirementBindingContext
} from './requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from './semantic.ts';

function digest(value: string): OperationDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function operation(
  provider: string,
  inputMaximum: number | null = 4_096
): BoundSemanticOperation {
  const requirementContractDigest = digest('typescript-project-check-contract');
  const plan = compileSemanticOperationPlan({
    operation: 'typecheck.project-check',
    intentDigest: digest('exact-project-input'),
    decisionDigest: digest('typecheck-decision'),
    deadlineAtUnixMs: Date.now() + 60_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 60_000 },
      ...(inputMaximum === null
        ? []
        : [{ resource: 'input-bytes' as const, maximum: inputMaximum }]),
      { resource: 'output-bytes', maximum: 8_192 },
      { resource: 'processes', maximum: 2 }
    ],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: requirementContractDigest,
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable', 'resource.exhausted']
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: digest('typecheck-effect-grant')
    })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: requirementContractDigest,
    providerIdentityDigest: digest(provider)
  })]);
}

test('foundation context binds one exact attempt requirement provider and narrowed ceiling', () => {
  const bound = operation('typescript-native-provider');
  const context = issueOperationRequirementBindingContext({
    operation: bound,
    requirementId: 'typescript.project-check',
    resourceCeilings: [
      { resource: 'processes', maximum: 1 },
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'output-bytes', maximum: 2_048 }
    ]
  });
  const projection = consumeOperationRequirementBindingContext(context);

  expect(projection.issuerRole).toBe(OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE);
  expect(projection.operationIdentityDigest).toBe(bound.plan.identity.identityDigest);
  expect(projection.executionPlanDigest).toBe(bound.plan.execution.executionPlanDigest);
  expect(projection.boundAttemptDigest).toBe(bound.boundAttemptDigest);
  expect(projection.requirementId).toBe('typescript.project-check');
  expect(projection.providerBindingDigest).toBe(bound.bindings[0]!.bindingDigest);
  expect(projection.absoluteDeadlineAtUnixMs).toBe(bound.plan.attempt.deadlineAtUnixMs);
  expect(projection.resourceCeilings).toEqual([
    { resource: 'duration-ms', maximum: 30_000 },
    { resource: 'output-bytes', maximum: 2_048 },
    { resource: 'processes', maximum: 1 }
  ]);
  expect(projection).not.toHaveProperty('argv');
  expect(projection).not.toHaveProperty('terminal');
});

test('foundation context binds a fixed child deadline and rejects attempt widening', () => {
  const narrowedOperation = operation('child-deadline-provider');
  const childDeadlineAtUnixMs = narrowedOperation.plan.attempt.deadlineAtUnixMs - 10_000;
  const narrowed = consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: narrowedOperation,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 30_000 }],
      absoluteDeadlineAtUnixMs: childDeadlineAtUnixMs
    })
  );
  expect(narrowed.absoluteDeadlineAtUnixMs).toBe(childDeadlineAtUnixMs);

  const widenedOperation = operation('widened-child-deadline-provider');
  expect(() => issueOperationRequirementBindingContext({
    operation: widenedOperation,
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'duration-ms', maximum: 30_000 }],
    absoluteDeadlineAtUnixMs: widenedOperation.plan.attempt.deadlineAtUnixMs + 1
  })).toThrow('absolute deadline is not narrowed from its attempt');
});

test('structural copies serialization and caller flags cannot recreate the context', () => {
  const context = issueOperationRequirementBindingContext({
    operation: operation('typescript-native-provider'),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'processes', maximum: 1 }]
  });
  const structural = structuredClone(context) as OperationRequirementBindingContext;
  const serialized = JSON.parse(JSON.stringify(context)) as OperationRequirementBindingContext;

  expect(() => consumeOperationRequirementBindingContext(structural))
    .toThrow('operation-foundation-issued');
  expect(() => consumeOperationRequirementBindingContext(serialized))
    .toThrow('operation-foundation-issued');
  expect(() => consumeOperationRequirementBindingContext(
    true as unknown as OperationRequirementBindingContext
  )).toThrow('operation-foundation-issued');
});

test('context rejects foreign requirements and ceiling widening while identity follows attempts', () => {
  const first = operation('typescript-native-provider');
  expect(() => issueOperationRequirementBindingContext({
    operation: first,
    requirementId: 'git.ref-update',
    resourceCeilings: [{ resource: 'processes', maximum: 1 }]
  })).toThrow('not present in the exact operation');
  expect(() => issueOperationRequirementBindingContext({
    operation: first,
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'processes', maximum: 3 }]
  })).toThrow('not narrowed from its operation');

  const narrow = consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: first,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
    })
  );
  expect(() => issueOperationRequirementBindingContext({
    operation: first,
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'duration-ms', maximum: 5_000 }]
  })).toThrow('already has a different issued resource-ceiling context');
  expect(() => consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: first,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
    })
  )).toThrow('already been consumed');
  const narrowerOperation = operation('typescript-native-provider');
  const narrower = consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: narrowerOperation,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 5_000 }]
    })
  );
  const nextAttempt = consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: operation('typescript-native-provider'),
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
    })
  );

  expect(narrow.resourceCeilingIdentityDigest).not.toBe(narrower.resourceCeilingIdentityDigest);
  expect(narrow.operationIdentityDigest).toBe(nextAttempt.operationIdentityDigest);
  expect(narrow.executionPlanDigest).toBe(nextAttempt.executionPlanDigest);
  expect(narrow.boundAttemptDigest).not.toBe(nextAttempt.boundAttemptDigest);
  expect(narrow.contextDigest).not.toBe(nextAttempt.contextDigest);
});

test('requirement binding narrows an explicitly declared zero input ceiling and never creates one', () => {
  const explicitZero = consumeOperationRequirementBindingContext(
    issueOperationRequirementBindingContext({
      operation: operation('zero-input-provider', 0),
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'input-bytes', maximum: 0 }]
    })
  );
  expect(explicitZero.resourceCeilings).toEqual([
    { resource: 'input-bytes', maximum: 0 }
  ]);

  expect(() => issueOperationRequirementBindingContext({
    operation: operation('absent-input-provider', null),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'input-bytes', maximum: 0 }]
  })).toThrow('input-bytes is not narrowed from its operation');

  expect(() => issueOperationRequirementBindingContext({
    operation: operation('runtime-ledger-provider', 0),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{
      resource: 'input-bytes',
      maximum: 0,
      consumed: 0
    } as never]
  })).toThrow('resource ceiling is not canonical');
});
