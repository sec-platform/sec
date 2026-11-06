import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import type { RepositoryModuleMembership } from '../architecture/contract.ts';
import {
  compileSourceProgramImplementationDominance
} from './implementation-dominance.ts';
import {
  compileRepositorySourceProgramModel,
  compileSourceProgramOwnerIntentEvidence
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

function compileFacts(
  sources: Readonly<Record<string, string>>,
  moduleMembership: RepositoryModuleMembership
) {
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const model = compileRepositorySourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  return Object.freeze({
    model,
    ownerIntents: compileSourceProgramOwnerIntentEvidence(model, moduleMembership)
  });
}


test('equal public-operation declarations still require an exact evolution obligation', () => {
  const baseMembership = membership({
    'src/identity': 'identity-owner',
    'src/consumer': 'consumer-owner',
    'src/unbound': 'unbound-owner'
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
    'src/consumer/use.ts': "import { compareIdentity } from '../identity/primary.ts';\nexport const accepted = compareIdentity('a', 'a');\n",
    'src/unbound/primary.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/unbound/duplicate.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/unbound/use.ts': "import { compareIdentity } from './primary.ts';\nexport const heuristicAccepted = compareIdentity('a', 'a');\n"
  };
  const { model, ownerIntents } = compileFacts(sources, moduleMembership);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'identity',
    semanticIdentity: 'provider-operation:identity.compare:compareIdentity',
    disposition: 'owner-decision-required',
    removableUnitIds: []
  }));
  const unboundUnits = compilation.units.filter(({ kind, semanticIdentity }) => (
    kind === 'identity' && semanticIdentity.startsWith('unbound-responsibility:')
  ));
  expect(unboundUnits).toHaveLength(2);
  expect(unboundUnits.every(({ candidateEvidenceClass }) => candidateEvidenceClass === 'heuristic')).toBe(true);
  expect(unboundUnits.map(({ producerPaths }) => producerPaths[0]).sort()).toEqual([
    'src/unbound/duplicate.ts',
    'src/unbound/primary.ts'
  ]);
  expect(compilation.findings.filter(({ kind, semanticIdentity }) => (
    kind === 'identity' && semanticIdentity.startsWith('unbound-responsibility:')
  ))).toEqual([expect.objectContaining({
    disposition: 'unknown',
    removableUnitIds: []
  })]);
});

test('contract codecs crossing durable recovery boundaries require migration instead of deletion', () => {
  const moduleMembership = membership({
    'src/codec-a': 'codec-a-owner',
    'src/codec-b': 'codec-b-owner',
    'src/manual': 'manual-owner',
    'src/schema': 'schema-owner'
  });
  const sources = {
    'src/codec-a/codec.ts': 'export function decodeContract(value: string): unknown { return JSON.parse(value); }\n',
    'src/codec-b/codec.ts': 'export function decodeContract(value: string): unknown { return JSON.parse(value); }\n',
    'src/manual/decode.ts': 'export function decodePayload(value: string): unknown { return JSON.parse(value); }\n',
    'src/schema/decode.ts': 'const payloadSchema = { parse: (value: string): unknown => JSON.parse(value) };\nexport function decodePayload(value: string): unknown { return payloadSchema.parse(value); }\n'
  };
  const descriptors = moduleMembership.descriptors.map((descriptor) => {
    const heuristicCodec = descriptor.moduleId === 'manual-owner' || descriptor.moduleId === 'schema-owner';
    return Object.freeze({
      ...descriptor,
      capabilityProviders: Object.freeze([Object.freeze({
      capability: heuristicCodec ? 'payload.codec' : 'contract-codec',
      operations: Object.freeze([heuristicCodec ? 'decodePayload' : 'decodeContract']),
      effectKinds: Object.freeze(heuristicCodec ? [] : ['persistent-state' as const]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })]),
    operationObligations: Object.freeze(heuristicCodec ? [] : [Object.freeze({
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
    });
  });
  const membershipWithObligations = Object.freeze({
    ...moduleMembership,
    descriptors
  });
  const { model, ownerIntents } = compileFacts(sources, membershipWithObligations);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });

  expect(compilation.findings).toContainEqual(expect.objectContaining({
    kind: 'transition-algebra',
    semanticIdentity: 'operation:contract-codec:decodeContract',
    disposition: 'migration-required',
    removableUnitIds: []
  }));
  const durableCodecUnits = compilation.units.filter(({ kind, semanticIdentity }) => (
    kind === 'transition-algebra' && semanticIdentity === 'operation:contract-codec:decodeContract'
  ));
  expect(durableCodecUnits).toHaveLength(2);
  expect(durableCodecUnits.every(({ frontiers }) => (
    frontiers.durable === 'present' && frontiers.recovery === 'present'
  ))).toBe(true);
  const payloadCodecUnits = compilation.units.filter(({ kind, semanticIdentity }) => (
    kind === 'contract-codec' && semanticIdentity === 'owner-capability:payload.codec:decodePayload'
  ));
  expect(payloadCodecUnits).toHaveLength(2);
  expect(payloadCodecUnits.every(({ candidateEvidenceClass }) => candidateEvidenceClass === 'heuristic')).toBe(true);
  expect(compilation.findings.filter(({ kind, semanticIdentity }) => (
    kind === 'contract-codec' && semanticIdentity === 'owner-capability:payload.codec:decodePayload'
  ))).toEqual([expect.objectContaining({ disposition: 'unknown', removableUnitIds: [] })]);
});

test('declaration-scoped process effects distinguish direct and delegated calls from module initialization', () => {
  const baseMembership = membership({ 'src/process': 'process-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'process.operations',
      operations: Object.freeze(['pureValue', 'runProcess', 'delegatedProcess', 'initStatus']),
      effectKinds: Object.freeze([]),
      ownerInternalOperations: Object.freeze([]),
      operationRoles: Object.freeze([])
    })])
  }));
  const moduleMembership = Object.freeze({ ...baseMembership, descriptors });
  const source = "import { spawnSync } from 'node:child_process';\nexport function pureValue(): number { return 1; }\nexport function runProcess(command: string) { return spawnSync(command); }\n";
  const sources = {
    'src/process/operations.ts': source,
    'src/process/delegated.ts': "import { spawnSync } from 'node:child_process';\n"
      + 'function invoke(command: string) { return spawnSync(command); }\n'
      + 'export function delegatedProcess(command: string) { return invoke(command); }\n',
    'src/process/initialization.ts': "import { spawnSync } from 'node:child_process';\n"
      + "const startup = spawnSync('status');\n"
      + 'export function initStatus(): number { return startup.status ?? 0; }\n'
  };
  const { model, ownerIntents } = compileFacts(sources, moduleMembership);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });
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
  expect(compilation.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:delegatedProcess'
  ))?.frontiers).toEqual(expect.objectContaining({ effect: 'present', external: 'present' }));
  expect(compilation.units.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:process.operations:initStatus'
  ))?.frontiers).toEqual(expect.objectContaining({ effect: 'unknown', unknown: 'present' }));
});


test('a direct process wrapper remains protected by its external provider frontier', () => {
  const { model, ownerIntents } = compileFacts({
    'src/process/run.ts': "import { spawnSync } from 'node:child_process';\nexport function run(command: string) { return spawnSync(command); }\n"
  }, membership({ 'src/process': 'process-consumer' }));
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
  const { model, ownerIntents } = compileFacts(sources, membershipWithEffect);
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

test('planned delivery keeps independent owner, future-obligation and unresolved-runtime dispositions', () => {
  const baseMembership = membership({ 'src/planned': 'planned-owner' });
  const descriptors = baseMembership.descriptors.map((descriptor) => Object.freeze({
    ...descriptor,
    capabilityProviders: Object.freeze([Object.freeze({
      capability: 'planned.delivery',
      operations: Object.freeze(['deliver', 'requiredUnmaterializedDelivery', 'dynamicDelivery']),
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
  const sources = {
    'src/planned/deliver.ts': source,
    'src/planned/public.ts': '// Maintainer accepted this future operation in chat.\n'
      + 'export function requiredUnmaterializedDelivery(): string { return "unused"; }\n',
    'src/planned/dynamic.ts': 'export async function dynamicDelivery(target: string): Promise<unknown> { return import(target); }\n'
  };
  const { model, ownerIntents } = compileFacts(sources, moduleMembership);
  const compilation = compileSourceProgramImplementationDominance({ model, ownerIntents });
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
  const publicFinding = compilation.findings.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:planned.delivery:requiredUnmaterializedDelivery'
  ));
  expect(publicFinding).toEqual(expect.objectContaining({
    disposition: 'owner-decision-required',
    removableUnitIds: [],
    requiredUnmaterializedObligations: []
  }));

  const dynamicFinding = compilation.findings.find(({ semanticIdentity }) => (
    semanticIdentity === 'provider-operation:planned.delivery:dynamicDelivery'
  ));
  expect(dynamicFinding).toEqual(expect.objectContaining({
    disposition: 'unknown',
    removableUnitIds: [],
    requiredUnmaterializedObligations: []
  }));
});

