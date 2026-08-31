import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SecRepositoryModuleMembership } from '../../system-architecture/repository-modules/contract.ts';
import {
  compileSourceProgramImplementationDominance,
  type SourceProgramImplementationCandidateObservation
} from './implementation-dominance.ts';
import {
  compileRepositorySourceProgramModel,
  compileSourceProgramOwnerIntentEvidence
} from './repository.ts';

function membership(ownerByRoot: Readonly<Record<string, string>>): SecRepositoryModuleMembership {
  const roots = Object.keys(ownerByRoot).sort((left, right) => right.length - left.length);
  const descriptors = Object.freeze(roots.map((root) => Object.freeze({
    moduleId: ownerByRoot[root]!,
    root,
    importGraph: 'runtime' as const,
    externalEntrypoints: Object.freeze([]),
    capabilityProviders: Object.freeze([]),
    operationObligations: Object.freeze([]),
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
  ownerByRoot: Readonly<Record<string, string>>,
  candidates: (declarations: ReadonlyMap<string, readonly string[]>) => readonly SourceProgramImplementationCandidateObservation[]
) {
  const moduleMembership = membership(ownerByRoot);
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
  const declarations = new Map<string, string[]>();
  for (const { name, observationId } of model.declarations) {
    const ids = declarations.get(name) ?? [];
    ids.push(observationId);
    declarations.set(name, ids);
  }
  return compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileSourceProgramOwnerIntentEvidence(model, moduleMembership),
    candidates: candidates(declarations)
  });
}

test('an exact-equivalent unconsumed comparator is dominated only after every protected frontier closes', () => {
  const compilation = compile({
    'src/identity/primary.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/identity/duplicate.ts': 'export function compareIdentity(left: string, right: string): boolean { return left === right; }\n',
    'src/consumer/use.ts': "import { compareIdentity } from '../identity/primary.ts';\nexport const accepted = compareIdentity('a', 'a');\n"
  }, {
    'src/identity': 'identity-owner',
    'src/consumer': 'consumer-owner'
  }, (declarations) => [{
    kind: 'identity-comparator',
    semanticIdentity: 'identity-equivalence',
    declarationObservationIds: declarations.get('compareIdentity')!,
    observationClass: 'observed'
  }]);

  // The TypeScript graph resolves one same-name import target, so the other
  // exact implementation remains an orphan candidate rather than being
  // deleted from a filename or naming heuristic.
  expect(compilation.findings).toHaveLength(1);
  expect(compilation.findings[0]!.disposition).toBe('dominated');
  expect(compilation.findings[0]!.removableUnitIds.length).toBeGreaterThan(0);
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
      ownerInternalOperations: Object.freeze([])
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
  const model = compileRepositorySourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership: membershipWithObligations
  });
  const ids = model.declarations.filter(({ name }) => name === 'decodeContract')
    .map(({ observationId }) => observationId);
  const compilation = compileSourceProgramImplementationDominance({
    model,
    ownerIntents: compileSourceProgramOwnerIntentEvidence(model, membershipWithObligations),
    candidates: [{
      kind: 'contract-codec',
      semanticIdentity: 'durable-contract',
      declarationObservationIds: ids,
      observationClass: 'observed'
    }]
  });

  expect(compilation.findings).toEqual([
    expect.objectContaining({
      disposition: 'migration-required',
      removableUnitIds: []
    })
  ]);
  expect(compilation.units.every(({ frontiers }) => (
    frontiers.durable === 'present' && frontiers.recovery === 'present'
  ))).toBe(true);
});

test('candidate tools cannot turn unresolved ownership into removal authority', () => {
  const compilation = compile({
    'src/unowned/codec.ts': 'export function decode(value: string): unknown { return JSON.parse(value); }\n'
  }, {}, (declarations) => [{
    kind: 'contract-codec',
    semanticIdentity: 'unbound-contract',
    declarationObservationIds: declarations.get('decode')!,
    observationClass: 'observed'
  }]);

  expect(compilation.findings).toEqual([
    expect.objectContaining({ disposition: 'unknown', removableUnitIds: [] })
  ]);
});
