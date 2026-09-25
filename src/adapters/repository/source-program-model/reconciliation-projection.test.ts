import { expect, test } from 'bun:test';

import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleMembershipSnapshot
} from '../architecture/contract.ts';
import type { SourceProgramUnknown } from './contract.ts';
import {
  compileSourceProgramArchitectureEvolutionReference,
  compileSourceProgramReconciliationProjection,
  type SourceProgramReconciliationProviderEvidence
} from './reconciliation-projection.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualSnapshot } from './workspace-source-snapshot.ts';

type DescriptorFixture = Readonly<{
  root: string;
  source: Readonly<Record<string, unknown>>;
}>;

function compileFixture(
  sources: Readonly<Record<string, string>>,
  descriptors: readonly DescriptorFixture[],
  unknowns: readonly SourceProgramUnknown[] = []
) {
  const orderedSources = Object.entries(sources).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const files = orderedSources.map(([repositoryPath, source]) => Object.freeze({
    path: repositoryPath,
    source,
    contentDigest: rawSha256(source)
  }));
  const descriptorSources = descriptors.map(({ root, source }) => Object.freeze({
    descriptorPath: `${root}/module.json`,
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [],
      operationObligations: [],
      causalRelations: [],
      preDependencyBootstrap: false,
      ...source
    })
  }));
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [
      ...files.map(({ path }) => path),
      ...descriptorSources.map(({ descriptorPath }) => descriptorPath)
    ],
    descriptorSources
  });
  const mutationDigest = rawSha256(JSON.stringify({
    files: files.map(({ path, contentDigest }) => ({ path, contentDigest })),
    descriptors: descriptorSources
  }));
  const workspaceSnapshot = compileVirtualSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('reconciliation-projection-base'),
        mutationDigest
      }
    },
    files,
    moduleMembership: membership
  });
  return Object.freeze({
    membership,
    compilation: compileVirtualRepositorySourceProgramCompilation({
      workspaceSnapshot,
      unknowns
    })
  });
}

function serviceDescriptor(
  symbolPath: string,
  symbolName: string,
  options: Readonly<{
    includeEffect?: boolean;
    includeTerminal?: boolean;
    includeReadback?: boolean;
    includeRecovery?: boolean;
    includeRetirement?: boolean;
  }> = {}
): DescriptorFixture {
  const relations: Record<string, unknown>[] = [{
    subject: 'example.service',
    relation: options.includeRetirement ? 'retires' : 'declares',
    symbol: { path: symbolPath, name: symbolName },
    operation: null
  }];
  if (options.includeEffect) relations.push({
    subject: 'example.service',
    relation: 'executes',
    symbol: { path: symbolPath, name: symbolName },
    operation: null
  });
  if (options.includeTerminal) relations.push({
    subject: 'example.service',
    relation: 'settles',
    symbol: { path: symbolPath, name: symbolName },
    operation: null
  });
  if (options.includeReadback) relations.push({
    subject: 'example.service',
    relation: 'reads-back',
    symbol: { path: symbolPath, name: symbolName },
    operation: null
  });
  if (options.includeRecovery) relations.push({
    subject: 'example.service',
    relation: 'recovers',
    symbol: { path: symbolPath, name: symbolName },
    operation: null
  });
  return Object.freeze({ root: 'src/example', source: { causalRelations: relations } });
}

function reconcile(
  before: ReturnType<typeof compileFixture>,
  after: ReturnType<typeof compileFixture>
) {
  return compileSourceProgramReconciliationProjection({
    before: before.compilation,
    after: after.compilation
  });
}

function architectureEvolution(
  before: ReturnType<typeof compileFixture>,
  after: ReturnType<typeof compileFixture>
) {
  return compileSourceProgramArchitectureEvolutionReference({
    reconciliation: reconcile(before, after)
  });
}

test('declaration rename, move, and re-export changes are derived from owner relations and compiler references', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n',
    'src/example/facade.ts': "export { run } from './service.ts';\n",
    'src/consumer/use.ts': "import { run } from '../example/facade.ts';\nexport const value = run();\n"
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const renamed = compileFixture({
    'src/example/service.ts': 'export function execute(): string { return \'ok\'; }\n',
    'src/example/facade.ts': "export { execute } from './service.ts';\n",
    'src/consumer/use.ts': "import { execute } from '../example/facade.ts';\nexport const value = execute();\n"
  }, [serviceDescriptor('src/example/service.ts', 'execute')]);
  const moved = compileFixture({
    'src/example/operation.ts': 'export function run(): string { return \'ok\'; }\n',
    'src/example/facade.ts': "export { run } from './operation.ts';\n",
    'src/consumer/use.ts': "import { run } from '../example/facade.ts';\nexport const value = run();\n"
  }, [serviceDescriptor('src/example/operation.ts', 'run')]);
  const noFacade = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n',
    'src/consumer/use.ts': "import { run } from '../example/service.ts';\nconst value = run();\nvoid value;\n"
  }, [serviceDescriptor('src/example/service.ts', 'run')]);

  expect(reconcile(before, renamed).changes).toContainEqual(expect.objectContaining({
    kind: 'renamed',
    subjects: ['example.service']
  }));
  expect(reconcile(before, moved).changes).toContainEqual(expect.objectContaining({
    kind: 'moved',
    subjects: ['example.service']
  }));
  expect(reconcile(before, noFacade).changes).toContainEqual(expect.objectContaining({
    kind: 'reexported',
    subjects: ['example.service']
  }));

  const reference = architectureEvolution(before, moved);
  // The owner relation and every consumer moved together. A path change
  // alone is not an unresolved architecture obligation or effect grant.
  expect(reconcile(before, moved).unresolvedReasons).toEqual([]);
  expect(reference.status).toBe('ready');
  expect(reference.changes).toContainEqual(expect.objectContaining({
    kind: 'moved',
    sourcePath: 'src/example/service.ts',
    targetPath: 'src/example/operation.ts'
  }));
  expect(reference.retirementPaths).toContain('src/example/service.ts');
  expect(reference.changedPaths).toContain('src/example/operation.ts');
  expect(architectureEvolution(before, before).status).toBe('no-change');
});

test('export visibility retirement admits only an exact closed internal frontier', () => {
  const beforeInternal = compileFixture({
    'src/example/service.ts': [
      'export function helper(): string { return \'ok\'; }',
      'export function run(): string { return helper(); }',
      ''
    ].join('\n')
  }, [{ root: 'src/example', source: {} }]);
  const afterInternal = compileFixture({
    'src/example/service.ts': [
      'function helper(): string { return \'ok\'; }',
      'export function run(): string { return helper(); }',
      ''
    ].join('\n')
  }, [{ root: 'src/example', source: {} }]);
  const internal = reconcile(beforeInternal, afterInternal);
  expect(internal.changes).toContainEqual(expect.objectContaining({
    kind: 'modified',
    before: expect.objectContaining({ name: 'helper', exported: true }),
    after: expect.objectContaining({ name: 'helper', exported: false }),
    beforeConsumerPaths: ['src/example/service.ts'],
    afterConsumerPaths: ['src/example/service.ts']
  }));
  expect(internal.unresolvedReasons).toEqual([]);

  const beforeConsumer = compileFixture({
    'src/example/service.ts': 'export function helper(): string { return \'ok\'; }\n',
    'src/consumer/use.ts': "import { helper } from '../example/service.ts';\nexport const value = helper();\n"
  }, [
    { root: 'src/example', source: {} },
    { root: 'src/consumer', source: {} }
  ]);
  const afterConsumer = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [{ root: 'src/example', source: {} }]);
  expect(reconcile(beforeConsumer, afterConsumer).unresolvedReasons).toContainEqual(
    expect.objectContaining({ code: 'retirement-unresolved', subject: 'helper' })
  );

  const publicDescriptor = {
    root: 'src/example',
    source: { externalEntrypoints: ['src/example/service.ts'] }
  };
  const beforePublic = compileFixture({
    'src/example/service.ts': 'export function helper(): string { return \'ok\'; }\n'
  }, [publicDescriptor]);
  const afterPublic = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [publicDescriptor]);
  expect(reconcile(beforePublic, afterPublic).unresolvedReasons).toContainEqual(
    expect.objectContaining({ code: 'retirement-unresolved', subject: 'helper' })
  );

  const unresolved = Object.freeze({
    code: 'dynamic-module-unresolved',
    path: 'src/example/service.ts',
    detail: 'dynamic target is unresolved',
    span: null
  });
  const beforeUnknown = compileFixture({
    'src/example/service.ts': 'export function helper(): string { return \'ok\'; }\n'
  }, [{ root: 'src/example', source: {} }], [unresolved]);
  const afterUnknown = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [{ root: 'src/example', source: {} }], [unresolved]);
  expect(reconcile(beforeUnknown, afterUnknown).unresolvedReasons).toContainEqual(
    expect.objectContaining({ code: 'retirement-unresolved', subject: 'helper' })
  );

  const obligationDescriptor = {
    root: 'src/example',
    source: {
      capabilityProviders: [{
        capability: 'example.helper',
        operations: ['helper'],
        effectKinds: [],
        ownerInternalOperations: [],
        operationRoles: []
      }],
      operationObligations: [{
        operation: { kind: 'capability', capability: 'example.helper', operation: 'helper' },
        consumerSupport: { consumers: [] },
        effect: { kinds: [], failureKinds: [], recovery: 'not-applicable' },
        evolution: { migration: 'not-required', retirement: 'replacement-obligations-satisfied' },
        resources: { aggregateBudgets: [{ resource: 'duration-ms', maximum: 100 }] },
        futureSupport: { condition: 'semantic-superset-required' }
      }]
    }
  };
  const beforeObligation = compileFixture({
    'src/example/service.ts': 'export function helper(): string { return \'ok\'; }\n'
  }, [obligationDescriptor]);
  const afterObligation = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [obligationDescriptor]);
  expect(reconcile(beforeObligation, afterObligation).unresolvedReasons).toContainEqual(
    expect.objectContaining({ code: 'retirement-unresolved', subject: 'helper' })
  );
  const afterRemovedObligation = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [{ root: 'src/example', source: {} }]);
  expect(reconcile(beforeObligation, afterRemovedObligation).unresolvedReasons).toContainEqual(
    expect.objectContaining({ code: 'retirement-unresolved', subject: 'helper' })
  );

  const internalRelationDescriptor = {
    root: 'src/example',
    source: {
      causalRelations: [{
        subject: 'example.helper',
        relation: 'declares',
        symbol: { path: 'src/example/service.ts', name: 'helper' },
        operation: null
      }]
    }
  };
  const beforeInternalRelation = compileFixture({
    'src/example/service.ts': 'export function helper(): string { return \'ok\'; }\n'
  }, [internalRelationDescriptor]);
  const afterInternalRelation = compileFixture({
    'src/example/service.ts': 'function helper(): string { return \'ok\'; }\n'
  }, [internalRelationDescriptor]);
  expect(reconcile(beforeInternalRelation, afterInternalRelation).unresolvedReasons).toEqual([]);

  const beforeOverloads = compileFixture({
    'src/example/service.ts': [
      'export function helper(value: string): string;',
      'export function helper(value: number): number;',
      'export function helper(value: string | number): string | number { return value; }',
      ''
    ].join('\n')
  }, [{ root: 'src/example', source: {} }]);
  const afterOverloads = compileFixture({
    'src/example/service.ts': [
      'function helper(value: string): string;',
      'function helper(value: number): number;',
      'function helper(value: string | number): string | number { return value; }',
      ''
    ].join('\n')
  }, [{ root: 'src/example', source: {} }]);
  const overloads = reconcile(beforeOverloads, afterOverloads);
  expect(overloads.changes).not.toContainEqual(expect.objectContaining({
    kind: 'modified',
    before: expect.objectContaining({ name: 'helper', exported: true }),
    after: expect.objectContaining({ name: 'helper', exported: false })
  }));
  expect(overloads.unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'changed-declaration-owner-relation-unresolved',
    subject: 'helper'
  }));
});

test('duplicate owner and removed consumer frontiers fail closed', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n',
    'src/consumer/use.ts': "import { run } from '../example/service.ts';\nexport const value = run();\n"
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'better\'; }\n',
    'src/foreign/duplicate.ts': 'export function duplicate(): string { return \'other\'; }\n'
  }, [
    serviceDescriptor('src/example/service.ts', 'run'),
    {
      root: 'src/foreign',
      source: {
        causalRelations: [{
          subject: 'example.service',
          relation: 'declares',
          symbol: { path: 'src/foreign/duplicate.ts', name: 'duplicate' },
          operation: null
        }]
      }
    }
  ]);
  const projection = reconcile(before, after);

  expect(projection.status).toBe('unresolved');
  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'module-responsibility-duplicate-owner'
  );
  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'consumer-frontier-removed-without-retirement'
  );
  const reference = architectureEvolution(before, after);
  expect(reference.status).toBe('blocked');
  expect(reference.direction).toBe('blocked');
  expect(reference.blockers.map(({ code }) => code)).toContain('reconciliation-unresolved');
});

test('architecture evolution refuses caller-constructed reconciliation objects', () => {
  const fixture = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const issued = reconcile(fixture, fixture);
  expect(() => compileSourceProgramArchitectureEvolutionReference({
    reconciliation: { ...issued }
  })).toThrow('compiler-issued reconciliation projection');
});

test('architecture evolution consumes canonical owner and file cycle evidence', () => {
  const descriptors = [
    Object.freeze({ root: 'src/a', source: Object.freeze({}) }),
    Object.freeze({ root: 'src/b', source: Object.freeze({}) })
  ];
  const acyclic = compileFixture({
    'src/a/index.ts': "import { valueB } from '../b/index.ts';\nexport const valueA = valueB;\n",
    'src/b/index.ts': 'export const valueB = 1;\n'
  }, descriptors);
  const ownerCycle = compileFixture({
    'src/a/index.ts': "import { valueB } from '../b/index.ts';\nexport const valueA = valueB;\n",
    'src/b/index.ts': "import { valueA } from '../a/index.ts';\nexport const valueB = valueA;\n"
  }, descriptors);
  const ownerReference = architectureEvolution(acyclic, ownerCycle);
  expect(ownerReference.status).toBe('blocked');
  expect(ownerReference.blockers.map(({ code }) => code)).toContain(
    'architecture-cycle-added'
  );
  expect(ownerReference.graphDelta.addedOwnerCycleRelations.length).toBeGreaterThan(0);
  expect(ownerReference.graphDelta.addedCyclicEdgeWitnesses.length).toBeGreaterThan(0);

  const fileAcyclic = compileFixture({
    'src/example/first.ts': "import { second } from './second.ts';\nexport const first = second;\n",
    'src/example/second.ts': 'export const second = 1;\n'
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  const fileCycle = compileFixture({
    'src/example/first.ts': "import { second } from './second.ts';\nexport const first = second;\n",
    'src/example/second.ts': "import { first } from './first.ts';\nexport const second = first;\n"
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  const fileReference = architectureEvolution(fileAcyclic, fileCycle);
  expect(fileReference.status).toBe('blocked');
  expect(fileReference.graphDelta.addedFileCycleRelations.length).toBeGreaterThan(0);

  const splitReference = architectureEvolution(ownerCycle, acyclic);
  expect(splitReference.blockers.map(({ code }) => code)).not.toContain(
    'architecture-cycle-added'
  );
  expect(splitReference.direction).toBe('improving');

  const feedbackDescriptors = ['a', 'b', 'c'].map((owner) => Object.freeze({
    root: `src/${owner}`,
    source: Object.freeze({})
  }));
  const feedbackBefore = compileFixture({
    'src/a/index.ts': "import { valueC } from '../c/index.ts';\nexport const valueA = valueC;\n",
    'src/b/index.ts': "import { valueC } from '../c/index.ts';\nexport const valueB = valueC;\n",
    'src/c/index.ts': "import { valueB } from '../b/index.ts';\nexport const valueC = valueB;\n"
  }, feedbackDescriptors);
  const feedbackAfter = compileFixture({
    'src/a/index.ts': 'export const valueA = 1;\n',
    'src/b/index.ts': "import { valueC } from '../c/index.ts';\nexport const valueB = valueC;\n",
    'src/c/index.ts': "import { valueB } from '../b/index.ts';\nexport const valueC = valueB;\n"
  }, feedbackDescriptors);
  const feedbackReference = architectureEvolution(feedbackBefore, feedbackAfter);
  expect(feedbackReference.graphDelta.addedOwnerCycleRelations).toEqual([]);
  expect(feedbackReference.graphDelta.addedCyclicEdgeWitnesses).toEqual([]);
  expect(feedbackReference.blockers.map(({ code }) => code)).not.toContain(
    'architecture-cycle-expanded'
  );
  expect(feedbackReference.direction).toBe('improving');

  const equivalentSpecifier = compileFixture({
    'src/a/index.ts': 'export const valueA = 1;\n',
    'src/b/index.ts': "import { valueC } from '../c/index';\nexport const valueB = valueC;\n",
    'src/c/index.ts': "import { valueB } from '../b/index.ts';\nexport const valueC = valueB;\n"
  }, feedbackDescriptors);
  const equivalentSpecifierReference = architectureEvolution(feedbackAfter, equivalentSpecifier);
  expect(equivalentSpecifierReference.graphDelta.addedCyclicEdgeWitnesses.length)
    .toBeGreaterThan(0);
  expect(equivalentSpecifierReference.graphDelta.expandedCyclicStructuralEdges).toEqual([]);
  expect(equivalentSpecifierReference.blockers.map(({ code }) => code)).not.toContain(
    'architecture-cycle-expanded'
  );
});

test('effectful changes require terminal and readback relations', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run', {
    includeEffect: true,
    includeTerminal: true,
    includeReadback: true
  })]);
  const after = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'changed\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run', { includeEffect: true })]);
  const projection = reconcile(before, after);

  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'effect-terminal-unresolved'
  );
  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'effect-readback-unresolved'
  );
  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'effect-test-observation-unresolved'
  );
});

test('a retirement relation cannot self-authorize declaration removal', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n',
    'src/consumer/use.ts': "import { run } from '../example/service.ts';\nconst value = run();\nvoid value;\n"
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/retirement.ts': 'export function retire(): void {}\n'
  }, [serviceDescriptor('src/example/retirement.ts', 'retire', { includeRetirement: true })]);
  const projection = reconcile(before, after);

  expect(projection.status).toBe('unresolved');
  expect(projection.unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'retirement-unresolved',
    subject: 'example.service'
  }));
  expect(projection.frontiers).toContainEqual(expect.objectContaining({
    subject: 'example.service',
    afterPhases: ['retirement'],
    afterConsumerPaths: []
  }));
});

test('unknowns on changed paths remain unresolved and candidate tools stay non-authoritative', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'changed\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')], [Object.freeze({
    code: 'synthetic-unknown',
    path: 'src/example/service.ts',
    detail: 'compiler relation unavailable',
    span: null
  })]);
  const projection = reconcile(before, after);

  expect(projection.status).toBe('unresolved');
  expect(projection.unresolvedReasons.map(({ code }) => code)).toContain(
    'changed-path-source-program-unknown'
  );
  expect(projection.providerEvidence).toEqual([]);
});

test('pre-existing unknowns outside the changed declaration do not block an exact local edit', () => {
  const before = compileFixture({
    'src/example/service.ts': [
      "export function run(): string { return 'ok'; }",
      'export function inspect(value: Record<string, string>, key: string): string {',
      "  return value[key] ?? '';",
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/service.ts': [
      "export function run(): string { return 'changed'; }",
      'export function inspect(value: Record<string, string>, key: string): string {',
      "  return value[key] ?? '';",
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const projection = reconcile(before, after);

  expect(projection.unresolvedReasons.map(({ code }) => code)).not.toContain(
    'changed-path-source-program-unknown'
  );
  expect(projection.status).toBe('resolved');
});

test('computed values block changed declarations and their consumer frontier', () => {
  const before = compileFixture({
    'src/example/service.ts': [
      'export function run(values: Record<string, unknown>, key: string): string {',
      '  const selected = values[key];',
      '  void selected;',
      "  const marker = 'before';",
      '  return marker;',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const stableFlowAfter = compileFixture({
    'src/example/service.ts': [
      'export function run(values: Record<string, unknown>, key: string): string {',
      '  const selected = values[key];',
      '  void selected;',
      "  const marker = 'after';",
      '  return marker;',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);

  expect(reconcile(before, stableFlowAfter).unresolvedReasons).toContainEqual(
    expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    })
  );
  const escapedBodies = [
    '  return (selected as () => string)();',
    '  return String(selected);',
    '  const escaped = { selected };\n  return String(escaped.selected);',
    '  const read = () => selected;\n  return String(read());'
  ];
  for (const body of escapedBodies) {
    const escaped = compileFixture({
      'src/example/service.ts': [
        'export function run(values: Record<string, unknown>, key: string): string {',
        '  const selected = values[key];',
        body,
        '}',
        ''
      ].join('\n')
    }, [serviceDescriptor('src/example/service.ts', 'run')]);
    expect(reconcile(before, escaped).unresolvedReasons).toContainEqual(expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    }));
  }
  const invocation = compileFixture({
    'src/example/service.ts': [
      'export function run(values: Record<string, () => string>, key: string): string {',
      '  return values[key]();',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  expect(reconcile(before, invocation).unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'changed-path-source-program-unknown',
    subject: 'computed-property-unresolved'
  }));

  const consumerBefore = compileFixture({
    'src/example/service.ts': [
      'export function select(values: Record<string, unknown>, key: string): unknown {',
      '  return values[key];',
      '}',
      'export function run(values: Record<string, unknown>): string {',
      "  return String(select(values, 'name'));",
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const consumerAfter = compileFixture({
    'src/example/service.ts': [
      'export function select(values: Record<string, unknown>, key: string): unknown {',
      '  return values[key];',
      '}',
      'export function run(values: Record<string, unknown>): string {',
      "  return (select(values, 'name') as () => string)();",
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  expect(reconcile(consumerBefore, consumerAfter).unresolvedReasons).toContainEqual(
    expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    })
  );

  const transitiveConsumerBefore = compileFixture({
    'src/example/select.ts': [
      'export function select(values: Record<string, unknown>, key: string): unknown {',
      '  return values[key];',
      '}',
      ''
    ].join('\n'),
    'src/example/forward.ts': [
      "import { select } from './select.ts';",
      'export function forward(values: Record<string, unknown>): unknown {',
      "  return select(values, 'name');",
      '}',
      ''
    ].join('\n'),
    'src/example/use.ts': [
      "import { forward } from './forward.ts';",
      'export function run(values: Record<string, unknown>): string {',
      '  return String(forward(values));',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/use.ts', 'run')]);
  const transitiveConsumerAfter = compileFixture({
    'src/example/select.ts': [
      'export function select(values: Record<string, unknown>, key: string): unknown {',
      '  return values[key];',
      '}',
      ''
    ].join('\n'),
    'src/example/forward.ts': [
      "import { select } from './select.ts';",
      'export function forward(values: Record<string, unknown>): unknown {',
      "  return select(values, 'name');",
      '}',
      ''
    ].join('\n'),
    'src/example/use.ts': [
      "import { forward } from './forward.ts';",
      'export function run(values: Record<string, unknown>): string {',
      '  return (forward(values) as () => string)();',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/use.ts', 'run')]);
  expect(reconcile(transitiveConsumerBefore, transitiveConsumerAfter).unresolvedReasons)
    .toContainEqual(expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    }));

  const moduleInitializerBefore = compileFixture({
    'src/example/service.ts': [
      'declare const registry: Record<string, () => void>;',
      'declare const key: string;',
      'registry[key]();',
      "console.log('before');",
      ''
    ].join('\n')
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  const moduleInitializerAfter = compileFixture({
    'src/example/service.ts': [
      'declare const registry: Record<string, () => void>;',
      'declare const key: string;',
      'registry[key]();',
      "console.log('after');",
      ''
    ].join('\n')
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  expect(reconcile(moduleInitializerBefore, moduleInitializerAfter).unresolvedReasons)
    .toContainEqual(expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    }));

  const dependencyBefore = compileFixture({
    'src/example/registry.ts': 'export const registry: Record<string, unknown> = {};\n',
    'src/example/select.ts': [
      "import { registry } from './registry.ts';",
      'export function select(key: string): unknown {',
      '  return registry[key];',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/select.ts', 'select')]);
  const dependencyAfter = compileFixture({
    'src/example/registry.ts': "export const registry: Record<string, unknown> = { name: 'changed' };\n",
    'src/example/select.ts': [
      "import { registry } from './registry.ts';",
      'export function select(key: string): unknown {',
      '  return registry[key];',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/select.ts', 'select')]);
  expect(reconcile(dependencyBefore, dependencyAfter).unresolvedReasons)
    .toContainEqual(expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    }));

  const moduleDependencyBefore = compileFixture({
    'src/example/registry.ts': 'export const registry: Record<string, () => void> = {};\n',
    'src/example/use.ts': [
      "import { registry } from './registry.ts';",
      'declare const key: string;',
      'registry[key]();',
      ''
    ].join('\n')
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  const moduleDependencyAfter = compileFixture({
    'src/example/registry.ts': 'export const registry: Record<string, () => void> = { changed() {} };\n',
    'src/example/use.ts': [
      "import { registry } from './registry.ts';",
      'declare const key: string;',
      'registry[key]();',
      ''
    ].join('\n')
  }, [Object.freeze({ root: 'src/example', source: Object.freeze({}) })]);
  expect(reconcile(moduleDependencyBefore, moduleDependencyAfter).unresolvedReasons)
    .toContainEqual(expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    }));

  const computedBinding = compileFixture({
    'src/example/service.ts': [
      'export function run(values: Record<string, unknown>, key: string): string {',
      '  const { [key]: selected } = values;',
      '  return String(selected);',
      '}',
      ''
    ].join('\n')
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  expect(reconcile(before, computedBinding).unresolvedReasons).toContainEqual(
    expect.objectContaining({
      code: 'changed-path-source-program-unknown',
      subject: 'computed-property-unresolved'
    })
  );
});

test('malformed candidate-provider evidence is typed unresolved and cannot authorize reconciliation', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'changed\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const projection = compileSourceProgramReconciliationProjection({
    before: before.compilation,
    after: after.compilation,
    providerEvidence: [Object.freeze({
      provider: 'static-analysis.unused',
      status: 'observed',
      providerRevision: null,
      configDigest: null,
      inputDigest: null,
      candidateDigest: null
    })]
  });

  expect(projection.status).toBe('unresolved');
  expect(projection.unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'candidate-provider-evidence-invalid',
    subject: 'static-analysis.unused'
  }));

  for (const provider of ['static-analysis.dependencies', 'knip']) {
    const unavailableShadow = compileSourceProgramReconciliationProjection({
      before: before.compilation,
      after: after.compilation,
      providerEvidence: [Object.freeze({
        provider,
        status: 'unresolved',
        providerRevision: null,
        configDigest: null,
        inputDigest: null,
        candidateDigest: null
      })]
    });
    expect(unavailableShadow.unresolvedReasons).toContainEqual(expect.objectContaining({
      code: 'candidate-provider-evidence-unresolved',
      subject: provider
    }));
    expect(unavailableShadow.status).toBe('unresolved');
  }

  for (const status of ['absent', 'unexpected']) {
    const invalidRuntimeStatus = compileSourceProgramReconciliationProjection({
      before: before.compilation,
      after: after.compilation,
      providerEvidence: [Object.freeze({
        provider: `static-analysis.${status}`,
        status,
        providerRevision: null,
        configDigest: null,
        inputDigest: null,
        candidateDigest: null
      }) as unknown as SourceProgramReconciliationProviderEvidence]
    });
    expect(invalidRuntimeStatus.providerEvidence).toEqual([]);
    expect(invalidRuntimeStatus.unresolvedReasons).toContainEqual(expect.objectContaining({
      code: 'candidate-provider-evidence-invalid',
      subject: `static-analysis.${status}`
    }));
  }

  const observed = Object.freeze({
    provider: 'static-analysis.dependencies',
    status: 'observed' as const,
    providerRevision: '1.0.0',
    configDigest: rawSha256('provider-config'),
    inputDigest: rawSha256('provider-input'),
    candidateDigest: rawSha256('provider-candidates')
  });
  const duplicateProvider = compileSourceProgramReconciliationProjection({
    before: before.compilation,
    after: after.compilation,
    providerEvidence: [observed, observed]
  });
  expect(duplicateProvider.providerEvidence).toEqual([]);
  expect(duplicateProvider.unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'candidate-provider-evidence-invalid',
    subject: 'static-analysis.dependencies'
  }));
});

test('equivalent compiler snapshots produce byte-equivalent reconciliation projections', () => {
  const before = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'ok\'; }\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const firstAfter = compileFixture({
    'src/example/service.ts': 'export function run(): string { return \'changed\'; }\n',
    'src/example/helper.ts': 'export const helper = true;\n'
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const secondAfter = compileFixture(Object.fromEntries(Object.entries({
    'src/example/service.ts': 'export function run(): string { return \'changed\'; }\n',
    'src/example/helper.ts': 'export const helper = true;\n'
  }).reverse()), [serviceDescriptor('src/example/service.ts', 'run')]);

  expect(reconcile(before, firstAfter).projectionDigest)
    .toBe(reconcile(before, secondAfter).projectionDigest);
});

test('Git LF and Windows checkout line endings have one semantic reconciliation identity', () => {
  const source = [
    '// header keeps the declaration away from byte zero',
    'export function run(): string {',
    "  return 'ok';",
    '}',
    "const key = 'stable';",
    'export const table = { [key]: true };',
    "export const value = run();",
    ''
  ].join('\n');
  const windowsSource = source.replaceAll('\n', '\r\n');
  const before = compileFixture({
    'src/example/service.ts': source
  }, [serviceDescriptor('src/example/service.ts', 'run')]);
  const after = compileFixture({
    'src/example/service.ts': windowsSource
  }, [serviceDescriptor('src/example/service.ts', 'run')]);

  const projection = reconcile(before, after);
  expect(projection.changes).toEqual([]);
  expect(projection.status).toBe('resolved');
  expect(projection.unresolvedReasons).toEqual([]);
  expect(after.compilation.semanticSourceDigests).toEqual(
    before.compilation.semanticSourceDigests
  );
  const declaration = after.compilation.model.declarations.find(({ name }) => name === 'run');
  expect(declaration?.span.start).toBe(windowsSource.indexOf('export function run'));
  expect(declaration?.span.end).toBe(windowsSource.indexOf('\r\nconst key'));
});

test('cross-revision matching retains duplicate declaration names at their exact semantic addresses', () => {
  const descriptor = Object.freeze({ root: 'src/example', source: Object.freeze({}) });
  const before = compileFixture({
    'src/example/first.ts': 'export const value = 1;\n',
    'src/example/second.ts': 'export const value = 2;\n',
    'src/example/marker.ts': 'export const marker = false;\n'
  }, [descriptor]);
  const after = compileFixture({
    'src/example/first.ts': 'export const value = 1;\n',
    'src/example/second.ts': 'export const value = 2;\n',
    'src/example/marker.ts': 'export const marker = true;\n'
  }, [descriptor]);
  const projection = reconcile(before, after);

  expect(projection.changes.filter(({ before, after: current }) => (
    before?.name === 'value' || current?.name === 'value'
  ))).toEqual([]);
  expect(projection.changes).toContainEqual(expect.objectContaining({
    kind: 'modified',
    before: expect.objectContaining({ path: 'src/example/marker.ts', name: 'marker' }),
    after: expect.objectContaining({ path: 'src/example/marker.ts', name: 'marker' })
  }));
});

test('cross-revision matching retains overload groups before classifying real changes', () => {
  const descriptor = Object.freeze({ root: 'src/example', source: Object.freeze({}) });
  const overloads = [
    'export function run(value: string): string;',
    'export function run(value: number): number;',
    'export function run(value: string | number): string | number { return value; }'
  ].join('\n');
  const before = compileFixture({
    'src/example/service.ts': `${overloads}\n`,
    'src/example/marker.ts': 'export const marker = false;\n'
  }, [descriptor]);
  const after = compileFixture({
    'src/example/service.ts': `${overloads}\n`,
    'src/example/marker.ts': 'export const marker = true;\n'
  }, [descriptor]);
  const projection = reconcile(before, after);

  expect(projection.changes.filter(({ before: prior, after: current }) => (
    prior?.path === 'src/example/service.ts' || current?.path === 'src/example/service.ts'
  ))).toEqual([]);
});

test('pure declaration moves remain owned by one unchanged module responsibility', () => {
  const descriptor = Object.freeze({ root: 'src/example', source: Object.freeze({}) });
  const before = compileFixture({
    'src/example/old.ts': 'export interface Plan { readonly resolved: boolean; }\n'
  }, [descriptor]);
  const after = compileFixture({
    'src/example/contract.ts': 'export interface Plan { readonly resolved: boolean; }\n'
  }, [descriptor]);
  const projection = reconcile(before, after);

  expect(projection.status).toBe('resolved');
  expect(projection.changes).toContainEqual(expect.objectContaining({ kind: 'moved' }));
});
