import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import type { RepositoryModuleMembership } from '../architecture/contract.ts';
import {
  compileSourceProgramImplementationCandidates,
  compileSourceProgramImplementationDominance
} from './implementation-dominance.ts';
import {
  compileRepositoryModel,
  compileOwnerIntentEvidence
} from './repository.ts';

function membership(ownerByRoot: Readonly<Record<string, string>>): RepositoryModuleMembership {
  const roots = Object.keys(ownerByRoot).sort((left, right) => right.length - left.length);
  const descriptors = Object.freeze(roots.map((root) => Object.freeze({
    moduleId: ownerByRoot[root]!,
    root,
    importGraph: 'runtime' as const,
    externalEntrypoints: Object.freeze([]),
    capabilityProviders: Object.freeze([]),
    operationObligations: Object.freeze([]),
    causalRelations: Object.freeze([]),
    preDependencyBootstrap: false
  })));
  return Object.freeze({
    descriptors,
    graphRoots: Object.freeze([...roots]),
    moduleRoots: Object.freeze([...roots]),
    moduleForPath: (path: string) => {
      const root = roots.find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
      const descriptor = root === undefined ? undefined : descriptors.find((entry) => entry.root === root);
      return descriptor ?? null;
    }
  });
}

function compile(
  sources: Readonly<Record<string, string>>,
  ownerByRoot: Readonly<Record<string, string>>
) {
  const { model, ownerIntents } = compileFacts(sources, ownerByRoot);
  return compileSourceProgramImplementationDominance({ model, ownerIntents });
}

function compileFacts(
  sources: Readonly<Record<string, string>>,
  ownerByRoot: Readonly<Record<string, string>>
) {
  const moduleMembership = membership(ownerByRoot);
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  return Object.freeze({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });
}

test('equal declaration bytes without an owner responsibility remain heuristic unknown', () => {
  const compilation = compile({
    'src/identity/primary.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/identity/duplicate.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/consumer/use.ts': "import { compareIdentity } from '../identity/primary.ts';\nexport const accepted = compareIdentity('a', 'a');\n"
  }, {
    'src/identity': 'identity-owner',
    'src/consumer': 'consumer-owner'
  });

  expect(compilation.findings).toHaveLength(1);
  expect(compilation.units.every(({ candidateEvidenceClass }) => candidateEvidenceClass === 'heuristic')).toBe(true);
  expect(compilation.findings[0]!.disposition).toBe('unknown');
  expect(compilation.findings[0]!.removableUnitIds).toEqual([]);
});

test('equal public-operation declarations still require an exact evolution obligation', () => {
  const baseMembership = membership({
    'src/identity': 'identity-owner',
    'src/consumer': 'consumer-owner'
  });
  const descriptors = baseMembership.descriptors.map((descriptor) => descriptor.moduleId !== 'identity-owner'
    ? descriptor
    : Object.freeze({
      ...descriptor,
      capabilityProviders: Object.freeze([Object.freeze({
        capability: 'identity.compare',
        operations: Object.freeze(['compareIdentity']),
        effectKinds: Object.freeze([]),
        ownerInternalOperations: Object.freeze([]),
        operationRoles: Object.freeze([])
      })])
    }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const sources = {
    'src/identity/primary.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/identity/duplicate.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/consumer/use.ts': "import { compareIdentity } from '../identity/primary.ts';\nexport const accepted = compareIdentity('a', 'a');\n"
  };
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });

  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'identity',
    semanticIdentity: 'provider-operation:identity.compare:compareIdentity',
    disposition: 'owner-decision-required',
    removableUnitIds: []
  }));
  expect(compilation.findings.some(({ disposition }) => disposition === 'unknown')).toBe(false);
});

test('contract codecs crossing durable recovery boundaries require migration instead of deletion', () => {
  const moduleMembership = membership({
    'src/codec-a': 'codec-a-owner',
    'src/codec-b': 'codec-b-owner'
  });
  const sources = {
    'src/codec-a/codec.ts': 'export function decodeContract(value: string): unknown { return JSON.parse(value); }\n',
    'src/codec-b/codec.ts': 'export function decodeContract(value: string): unknown { return JSON.parse(value); }\n'
  };
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const descriptors = moduleMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'contract-codec',
      operations: Object.freeze(['decodeContract']),
      effectKinds: Object.freeze(['persistent-state' as const]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })]),
    operationObligations: Object.freeze([Object.freeze({
      operation: Object.freeze({
        kind: 'capability' as const,
        capability: 'contract-codec',
        operation: 'decodeContract'
      }),
      consumerSupport: Object.freeze({ consumers: Object.freeze([]) }),
      effect: Object.freeze({
        kinds: Object.freeze(['persistent-state' as const]),
        failureKinds: Object.freeze(['invalid-contract']),
        recovery: 'owner-intervention' as const
      }),
      evolution: Object.freeze({
        migration: 'one-shot-owner-migration' as const,
        retirement: 'replacement-obligations-satisfied' as const
      }),
      resources: Object.freeze({ aggregateBudgets: Object.freeze([]) }),
      futureSupport: Object.freeze({ condition: 'preserve-obligations' as const })
    })])
  }));
  const membershipWithObligations = Object.freeze({
    ...moduleMembership,
    descriptors
  });
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membershipWithObligations
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, membershipWithObligations)
  });

  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'transition-algebra',
    disposition: 'migration-required',
    removableUnitIds: []
  }));
  expect(compilation.units.every(({ frontiers }) => (
    frontiers.durable === 'present' && frontiers.recovery === 'present'
  ))).toBe(true);
});

test('the candidate compiler does not promote an exact declaration digest to semantic identity', () => {
  const { model, ownerIntents } = compileFacts({
    'src/one/equal.ts': 'export function same(left: string, right: string): boolean { return left === right; }\n',
    'src/two/equal.ts': 'export function same(left: string, right: string): boolean { return left === right; }\n',
    'src/use/value.ts': "import { same } from '../one/equal.ts';\nexport const result = same('a', 'a');\n"
  }, {
    'src/one': 'identity-owner',
    'src/two': 'identity-owner',
    'src/use': 'consumer-owner'
  });
  const candidates = compileSourceProgramImplementationCandidates({ model, ownerIntents });
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(candidates).toContainEqual(expect.objectContaining({
    kind: 'identity',
    evidenceClass: 'heuristic',
    observationClass: 'unknown'
  }));
  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'identity',
    disposition: 'unknown',
    removableUnitIds: []
  }));
});

test('capability effects belong to declaration spans rather than every export in the file', () => {
  const baseMembership = membership({ 'src/process': 'process-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'process.operations',
      operations: Object.freeze(['pureValue', 'runProcess']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })])
  }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const source = "import { spawnSync } from 'node:child_process';\nexport function pureValue(): number { return 1; }\nexport function runProcess(command: string) { return spawnSync(command); }\n";
  const files = [Object.freeze({
    path: 'src/process/operations.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });
  const pureUnit = compilation.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:pureValue'
  ));
  const processUnit = compilation.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:runProcess'
  ));

  expect(pureUnit?.frontiers).toEqual(expect.objectContaining({
    effect: 'closed',
    external: 'closed'
  }));
  expect(processUnit?.frontiers).toEqual(expect.objectContaining({
    effect: 'present',
    external: 'present'
  }));
});

test('exact call closure propagates capabilities while module initialization remains unknown', () => {
  const compileOperation = (source: string, operation: string) => {
    const baseMembership = membership({ 'src/process': 'process-owner' });
    const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
      ...descriptor,
      capabilityProviders: Object.freeze([Object.freeze({
        capability: 'process.operations',
        operations: Object.freeze([operation]),
        effectKinds: Object.freeze([]),
        ownerInternalOperations: Object.freeze([]),
        operationRoles: Object.freeze([])
      })])
    }));
    const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
    const files = [Object.freeze({
      path: 'src/process/operations.ts',
      source,
      contentDigest: rawSha256(source)
    })];
    const model = compileRepositoryModel({
      sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
      files,
      moduleMembership
    });
    return compileSourceProgramImplementationDominance({
      model,
      ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
    });
  };
  const delegated = compileOperation(
    "import { spawnSync } from 'node:child_process';\nfunction invoke(command: string) { return spawnSync(command); }\nexport function runProcess(command: string) { return invoke(command); }\n",
    'runProcess'
  );
  const moduleInitialization = compileOperation(
    "import { spawnSync } from 'node:child_process';\nconst startup = spawnSync('status');\nexport function pureValue(): number { return startup.status ?? 0; }\n",
    'pureValue'
  );

  expect(delegated.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:runProcess'
  ))?.frontiers).toEqual(expect.objectContaining({ effect: 'present', external: 'present' }));
  expect(moduleInitialization.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:pureValue'
  ))?.frontiers).toEqual(expect.objectContaining({ effect: 'unknown', unknown: 'present' }));
});

test('codec-shaped names remain unknown when the compiler cannot prove one grammar', () => {
  const moduleMembership = membership({
    'src/manual': 'manual-owner',
    'src/schema': 'schema-owner'
  });
  const descriptors = moduleMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'payload.codec',
      operations: Object.freeze(['decodePayload']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })])
  }));
  const membershipWithCodec = Object.freeze({ ...moduleMembership, descriptors });
  const sources = {
    'src/manual/decode.ts': 'export function decodePayload(value: string): unknown { return JSON.parse(value); }\n',
    'src/schema/decode.ts': 'const payloadSchema = { parse: (value: string): unknown => JSON.parse(value) };\nexport function decodePayload(value: string): unknown { return payloadSchema.parse(value); }\n'
  };
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membershipWithCodec
  });
  const ownerIntents = compileOwnerIntentEvidence(model, membershipWithCodec);
  const candidates = compileSourceProgramImplementationCandidates({ model, ownerIntents });
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(candidates.filter(({ kind }) => kind === 'contract-codec').every(({ evidenceClass }) => (
    evidenceClass === 'heuristic'
  ))).toBe(true);
  expect(compilation.findings.filter(({ kind }) => kind === 'contract-codec')).toEqual([
    expect.objectContaining({ disposition: 'unknown', removableUnitIds: [] })
  ]);
});

test('a direct process wrapper remains protected by its external provider frontier', () => {
  const { model, ownerIntents } = compileFacts({
    'src/process/run.ts': "import { spawnSync } from 'node:child_process';\nexport function run(command: string) { return spawnSync(command); }\n"
  }, { 'src/process': 'process-consumer' });
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });
  const externalUnits = compilation.units.filter(({ kind }) => kind === 'external-capability-candidate');

  expect(externalUnits).toHaveLength(1);
  expect(externalUnits[0]!.frontiers.external).toBe('present');
  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'external-capability-candidate',
    disposition: 'owner-decision-required',
    removableUnitIds: []
  }));
});

test('duplicate completion candidates without an owner readback fact cannot sign completion', () => {
  const moduleMembership = membership({
    'src/effect-a': 'effect-a-owner',
    'src/effect-b': 'effect-b-owner'
  });
  const descriptors = moduleMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'effect.publish',
      operations: Object.freeze(['publish']),
      effectKinds: Object.freeze(['persistent-state' as const]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })]),
    operationObligations: Object.freeze([Object.freeze({
      operation: Object.freeze({ kind: 'capability' as const, capability: 'effect.publish', operation: 'publish' }),
      consumerSupport: Object.freeze({ consumers: Object.freeze([]) }),
      effect: Object.freeze({
        kinds: Object.freeze(['persistent-state' as const]),
        failureKinds: Object.freeze(['write-failed']),
        recovery: 'owner-intervention' as const
      }),
      evolution: Object.freeze({
        migration: 'not-required' as const,
        retirement: 'replacement-obligations-satisfied' as const
      }),
      resources: Object.freeze({ aggregateBudgets: Object.freeze([]) }),
      futureSupport: Object.freeze({ condition: 'preserve-obligations' as const })
    })])
  }));
  const membershipWithEffect = Object.freeze({ ...moduleMembership, descriptors });
  const sources = {
    'src/effect-a/publish.ts': 'export function publish(): void {}\n',
    'src/effect-b/publish.ts': 'export function publish(): void {}\n'
  };
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membershipWithEffect
  });
  const ownerIntents = compileOwnerIntentEvidence(model, membershipWithEffect);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(compilation.units).toContainEqual(expect.objectContaining({
    kind: 'completion-proof',
    frontiers: expect.objectContaining({ readback: 'unknown' })
  }));
  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'completion-proof',
    disposition: 'unknown',
    removableUnitIds: []
  }));
});

test('similar transition operations with different recovery remain an owner migration', () => {
  const moduleMembership = membership({
    'src/transition-a': 'transition-a-owner',
    'src/transition-b': 'transition-b-owner'
  });
  const descriptors = moduleMembership.descriptors.map((descriptor, index) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'state.transition',
      operations: Object.freeze(['advance']),
      effectKinds: Object.freeze(['persistent-state' as const]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })]),
    operationObligations: Object.freeze([Object.freeze({
      operation: Object.freeze({ kind: 'capability' as const, capability: 'state.transition', operation: 'advance' }),
      consumerSupport: Object.freeze({ consumers: Object.freeze([]) }),
      effect: Object.freeze({
        kinds: Object.freeze(['persistent-state' as const]),
        failureKinds: Object.freeze(['transition-failed']),
        recovery: index === 0 ? 'rollback' as const : 'owner-intervention' as const
      }),
      evolution: Object.freeze({
        migration: 'one-shot-owner-migration' as const,
        retirement: 'replacement-obligations-satisfied' as const
      }),
      resources: Object.freeze({ aggregateBudgets: Object.freeze([]) }),
      futureSupport: Object.freeze({ condition: 'preserve-obligations' as const })
    })])
  }));
  const membershipWithTransitions = Object.freeze({ ...moduleMembership, descriptors });
  const sources = {
    'src/transition-a/advance.ts': 'export function advance(): void {}\n',
    'src/transition-b/advance.ts': 'export function advance(): void {}\n'
  };
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membershipWithTransitions
  });
  const ownerIntents = compileOwnerIntentEvidence(model, membershipWithTransitions);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'transition-algebra',
    disposition: 'migration-required',
    removableUnitIds: []
  }));
});

test('consumer-zero cannot orphan an owner-authorized obligation that is not materialized', () => {
  const baseMembership = membership({ 'src/planned': 'planned-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'planned.delivery',
      operations: Object.freeze(['deliver']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })]),
    operationObligations: Object.freeze([Object.freeze({
      operation: Object.freeze({
        kind: 'capability' as const,
        capability: 'planned.delivery',
        operation: 'deliver'
      }),
      consumerSupport: Object.freeze({ consumers: Object.freeze([]) }),
      effect: Object.freeze({
        kinds: Object.freeze([]),
        failureKinds: Object.freeze([]),
        recovery: 'not-applicable' as const
      }),
      evolution: Object.freeze({
        migration: 'not-required' as const,
        retirement: 'replacement-obligations-satisfied' as const
      }),
      resources: Object.freeze({
        aggregateBudgets: Object.freeze([Object.freeze({
          resource: 'duration-ms' as const,
          maximum: 100
        })])
      }),
      futureSupport: Object.freeze({ condition: 'semantic-superset-required' as const })
    })])
  }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const source = 'export function deliver(): string { return "pending"; }\n';
  const files = [Object.freeze({
    path: 'src/planned/deliver.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });
  const finding = compilation.findings.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:planned.delivery:deliver'
  ));

  expect(finding).toEqual(expect.objectContaining({
    disposition: 'required-unmaterialized',
    canonicalOwner: 'planned-owner',
    removableUnitIds: [],
    requiredUnmaterializedObligations: [expect.objectContaining({
      targetOwner: 'planned-owner',
      acceptance: expect.objectContaining({
        resources: expect.objectContaining({
          aggregateBudgets: [expect.objectContaining({ resource: 'duration-ms', maximum: 100 })]
        })
      }),
      responsibilities: expect.objectContaining({
        evolution: expect.objectContaining({ retirement: 'replacement-obligations-satisfied' })
      }),
      replacementDag: [
        expect.objectContaining({ node: 'target-closure', dependsOn: [] }),
        expect.objectContaining({ node: 'obligation-acceptance', dependsOn: ['target-closure'] }),
        expect.objectContaining({ node: 'source-retirement', dependsOn: ['obligation-acceptance'] })
      ]
    })]
  }));
});

test('a public capability without an evolution obligation requires an owner decision', () => {
  const baseMembership = membership({ 'src/planned': 'planned-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'planned.delivery',
      operations: Object.freeze(['requiredUnmaterializedDelivery']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })])
  }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const source = '// Maintainer accepted this future operation in chat.\nexport function requiredUnmaterializedDelivery(): string { return "unused"; }\n';
  const files = [Object.freeze({
    path: 'src/planned/deliver.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });
  const finding = compilation.findings.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:planned.delivery:requiredUnmaterializedDelivery'
  ));

  expect(finding).toEqual(expect.objectContaining({
    disposition: 'owner-decision-required',
    removableUnitIds: [],
    requiredUnmaterializedObligations: []
  }));
});

test('unresolved runtime closure remains unknown without an owner-issued obligation', () => {
  const baseMembership = membership({ 'src/planned': 'planned-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'planned.delivery',
      operations: Object.freeze(['deliver']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })])
  }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const source = 'export async function deliver(target: string): Promise<unknown> { return import(target); }\n';
  const files = [Object.freeze({
    path: 'src/planned/deliver.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileRepositoryModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileOwnerIntentEvidence(model, moduleMembership)
  });
  const finding = compilation.findings.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:planned.delivery:deliver'
  ));

  expect(finding).toEqual(expect.objectContaining({
    disposition: 'unknown',
    removableUnitIds: [],
    requiredUnmaterializedObligations: []
  }));
});
