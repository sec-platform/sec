import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  consumeSecOperationRequirementBindingContext,
  issueSecOperationRequirementBindingContext,
  SEC_OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE,
  type SecOperationRequirementBindingContext
} from './requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from './semantic.ts';

function digest(value: string): SecOperationDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function operation(
  provider: string,
  inputMaximum: number | null = 4_096
): SecBoundSemanticOperation {
  const requirementContractDigest = digest('typescript-project-check-contract');
  const plan = compileSecSemanticOperationPlan({
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
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('typecheck-effect-grant')
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: requirementContractDigest,
    providerIdentityDigest: digest(provider)
  })]);
}

test('foundation context binds one exact attempt requirement provider and narrowed ceiling', () => {
  const bound = operation('typescript-native-provider');
  const context = issueSecOperationRequirementBindingContext({
    operation: bound,
    requirementId: 'typescript.project-check',
    resourceCeilings: [
      { resource: 'processes', maximum: 1 },
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'output-bytes', maximum: 2_048 }
    ]
  });
  const projection = consumeSecOperationRequirementBindingContext(context);

  expect(projection.issuerRole).toBe(SEC_OPERATION_REQUIREMENT_BINDING_ISSUER_ROLE);
  expect(projection.operationIdentityDigest).toBe(bound.plan.identity.identityDigest);
  expect(projection.executionPlanDigest).toBe(bound.plan.execution.executionPlanDigest);
  expect(projection.boundAttemptDigest).toBe(bound.boundAttemptDigest);
  expect(projection.requirementId).toBe('typescript.project-check');
  expect(projection.providerBindingDigest).toBe(bound.bindings[0]!.bindingDigest);
  expect(projection.resourceCeilings).toEqual([
    { resource: 'duration-ms', maximum: 30_000 },
    { resource: 'output-bytes', maximum: 2_048 },
    { resource: 'processes', maximum: 1 }
  ]);
  expect(projection).not.toHaveProperty('argv');
  expect(projection).not.toHaveProperty('terminal');
});

test('structural copies serialization and caller flags cannot recreate the context', () => {
  const context = issueSecOperationRequirementBindingContext({
    operation: operation('typescript-native-provider'),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'processes', maximum: 1 }]
  });
  const structural = structuredClone(context) as SecOperationRequirementBindingContext;
  const serialized = JSON.parse(JSON.stringify(context)) as SecOperationRequirementBindingContext;

  expect(() => consumeSecOperationRequirementBindingContext(structural))
    .toThrow('operation-foundation-issued');
  expect(() => consumeSecOperationRequirementBindingContext(serialized))
    .toThrow('operation-foundation-issued');
  expect(() => consumeSecOperationRequirementBindingContext(
    true as unknown as SecOperationRequirementBindingContext
  )).toThrow('operation-foundation-issued');
});

test('context rejects foreign requirements and ceiling widening while identity follows attempts', () => {
  const first = operation('typescript-native-provider');
  expect(() => issueSecOperationRequirementBindingContext({
    operation: first,
    requirementId: 'git.ref-update',
    resourceCeilings: [{ resource: 'processes', maximum: 1 }]
  })).toThrow('not present in the exact operation');
  expect(() => issueSecOperationRequirementBindingContext({
    operation: first,
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'processes', maximum: 3 }]
  })).toThrow('not narrowed from its operation');

  const narrow = consumeSecOperationRequirementBindingContext(
    issueSecOperationRequirementBindingContext({
      operation: first,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
    })
  );
  expect(() => issueSecOperationRequirementBindingContext({
    operation: first,
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'duration-ms', maximum: 5_000 }]
  })).toThrow('already has a different issued resource-ceiling context');
  expect(() => consumeSecOperationRequirementBindingContext(
    issueSecOperationRequirementBindingContext({
      operation: first,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 10_000 }]
    })
  )).toThrow('already been consumed');
  const narrowerOperation = operation('typescript-native-provider');
  const narrower = consumeSecOperationRequirementBindingContext(
    issueSecOperationRequirementBindingContext({
      operation: narrowerOperation,
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'duration-ms', maximum: 5_000 }]
    })
  );
  const nextAttempt = consumeSecOperationRequirementBindingContext(
    issueSecOperationRequirementBindingContext({
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
  const explicitZero = consumeSecOperationRequirementBindingContext(
    issueSecOperationRequirementBindingContext({
      operation: operation('zero-input-provider', 0),
      requirementId: 'typescript.project-check',
      resourceCeilings: [{ resource: 'input-bytes', maximum: 0 }]
    })
  );
  expect(explicitZero.resourceCeilings).toEqual([
    { resource: 'input-bytes', maximum: 0 }
  ]);

  expect(() => issueSecOperationRequirementBindingContext({
    operation: operation('absent-input-provider', null),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{ resource: 'input-bytes', maximum: 0 }]
  })).toThrow('input-bytes is not narrowed from its operation');

  expect(() => issueSecOperationRequirementBindingContext({
    operation: operation('runtime-ledger-provider', 0),
    requirementId: 'typescript.project-check',
    resourceCeilings: [{
      resource: 'input-bytes',
      maximum: 0,
      consumed: 0
    } as never]
  })).toThrow('resource ceiling is not canonical');
});
