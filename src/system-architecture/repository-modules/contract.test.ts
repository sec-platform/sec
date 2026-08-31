import { expect, test } from 'bun:test';

import { compilerRoot } from '../../workspace/runtime/paths.ts';
import {
  assertSecRepositoryModuleArchitectureBoundaries,
  assertSecRepositoryModuleImportBoundaries,
  assertSecRepositoryModuleSourceProgramBoundaries,
  collectSecRepositoryModuleBoundaryViolations,
  collectSecRepositoryModuleSourceProgramViolations,
  compileSecRepositoryModuleArchitectureProjection,
  compileSecRepositoryModuleGraph,
  compileSecRepositoryModuleMembership,
  compileSecRepositoryModuleTopologyProjection,
  parseSecModuleDescriptor
} from './contract.ts';

function repositoryModuleTestDescriptor(
  root: string
): ReturnType<typeof parseSecModuleDescriptor> {
  return parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: []
  }, `${root}/sec.module.json`);
}

test('repository module descriptors resolve unique physical roots and external entrypoints', () => {
  const membership = compileSecRepositoryModuleMembership(compilerRoot);

  expect(new Set(membership.descriptors.map(({ moduleId }) => moduleId)).size)
    .toBe(membership.descriptors.length);
  for (const descriptor of membership.descriptors) {
    expect(membership.moduleForPath(descriptor.root)?.moduleId, descriptor.root)
      .toBe(descriptor.moduleId);
    for (const entrypoint of descriptor.externalEntrypoints) {
      expect(membership.moduleForPath(entrypoint)?.moduleId, entrypoint)
        .toBe(descriptor.moduleId);
    }
  }
});

test('repository module descriptor parser rejects unknown fields and invalid paths', () => {
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: []
  } as const;
  const descriptorPath = 'src/example/sec.module.json';

  expect(parseSecModuleDescriptor(descriptor, descriptorPath).root).toBe('src/example');
  expect(() => parseSecModuleDescriptor({ ...descriptor, architectureRole: 'query' }, descriptorPath))
    .toThrow('architectureRole');
  expect(() => parseSecModuleDescriptor({ ...descriptor, architectureRole: 'service' }, descriptorPath))
    .toThrow('architectureRole');
  expect(() => parseSecModuleDescriptor({ ...descriptor, covered: true }, descriptorPath))
    .toThrow('unknown field');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    authorityRefs: ['system-architecture']
  }, descriptorPath)).toThrow('unknown field');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    externalEntrypoints: ['src/development/runner/cli.ts', 'src/development/runner/cli.ts']
  }, descriptorPath))
    .toThrow('entries must be unique');
  expect(() => parseSecModuleDescriptor(descriptor, '../sec.module.json'))
    .toThrow('descriptorPath');
});

test('repository module operation obligations are strict and bind declared public identities', () => {
  const obligation = {
    operation: {
      kind: 'capability',
      capability: 'example-operation',
      operation: 'execute'
    },
    consumerSupport: { consumers: ['consumer'] },
    effect: {
      kinds: ['process'],
      failureKinds: ['process-unavailable'],
      recovery: 'idempotent-retry'
    },
    evolution: {
      migration: 'not-required',
      retirement: 'replacement-obligations-satisfied'
    },
    resources: {
      aggregateBudgets: [{ resource: 'duration-ms', maximum: 1_000 }]
    },
    futureSupport: { condition: 'semantic-superset-required' }
  } as const;
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{ capability: 'example-operation', operations: ['execute'] }],
    operationObligations: [obligation]
  } as const;

  expect(parseSecModuleDescriptor(descriptor, 'src/provider/sec.module.json')
    .operationObligations).toEqual([obligation]);
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    operationObligations: [{ ...obligation, resources: undefined }]
  }, 'src/provider/sec.module.json')).toThrow('resources: expected an object');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      evolution: { retirement: 'replacement-obligations-satisfied' }
    }]
  }, 'src/provider/sec.module.json')).toThrow('expected exact keys');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      resources: { aggregateBudgets: [] }
    }]
  }, 'src/provider/sec.module.json')).toThrow('expected between 1 and 16 entries');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    operationObligations: [{
      ...obligation,
      operation: { ...obligation.operation, operation: 'undeclared' }
    }]
  }, 'src/provider/sec.module.json')).toThrow('must bind one declared capability provider operation');
});

test('repository module compiler prevents production from importing test authority', () => {
  const files = [
    'platform/example/index.ts',
    'platform/example/test/provider.ts'
  ];
  const sources = new Map([
    ['platform/example/index.ts', "export { provider } from './test/provider.ts';"],
    ['platform/example/test/provider.ts', 'export const provider = true;']
  ]);

  expect(() => compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  })).toThrow('production repository module imports test-only module');
});

test('repository module compiler does not infer visibility from directory names', () => {
  const files = [
    'src/consumer/index.ts',
    'src/provider/runtime/effect.ts'
  ];
  const sources = new Map([
    ['src/consumer/index.ts', "export { effect } from '../provider/runtime/effect.ts';"],
    ['src/provider/runtime/effect.ts', 'export const effect = true;']
  ]);
  const graph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  });
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');

  expect(() => assertSecRepositoryModuleImportBoundaries(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src/consumer', 'src/provider'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  })).not.toThrow();
});

test('edit-loop topology and full semantic architecture share one exact owner graph', () => {
  const files = ['src/alpha/runtime.ts', 'src/beta/runtime.ts'];
  const sources = new Map([
    ['src/alpha/runtime.ts', "import { beta } from '../beta/runtime.ts'; export const alpha = beta;"],
    ['src/beta/runtime.ts', "import { alpha } from '../alpha/runtime.ts'; export const beta = alpha;"]
  ]);
  const alpha = repositoryModuleTestDescriptor('src/alpha');
  const beta = repositoryModuleTestDescriptor('src/beta');
  const membership = {
    descriptors: [alpha, beta],
    graphRoots: ['src'],
    moduleRoots: ['src/alpha', 'src/beta'],
    moduleForPath: (file: string) => file.startsWith('src/alpha/') ? alpha : beta
  };
  const graph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  });
  const topology = compileSecRepositoryModuleTopologyProjection(graph, membership);
  const architecture = compileSecRepositoryModuleArchitectureProjection(graph, membership, {
    files: files.map((path) => ({
      path,
      moduleId: membership.moduleForPath(path).moduleId,
      surface: 'production' as const,
      semanticKind: 'executable' as const,
      semanticObservationClass: 'observed' as const
    })),
    entrypoints: [],
    entrypointClosures: [],
    capabilities: []
  });

  expect(topology.ownerEdges).toEqual(architecture.ownerEdges);
  expect(topology.strongComponents).toEqual(architecture.strongComponents);
  expect(topology.feedbackCuts).toEqual(architecture.feedbackCuts);
  expect(topology.strongComponents).toHaveLength(1);
  expect(topology.feedbackCuts).toHaveLength(1);
});

test('cross-owner aggregate facades are TypeScript facts rather than index filename policy', () => {
  const files = [
    'src/consumer/use.ts',
    'src/provider/public.ts',
    'src/provider/contract.ts',
    'src/provider/runtime/effect.ts'
  ];
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const membership = {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file: string) => file.startsWith('src/consumer/') ? consumer : provider
  };

  const publicGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export type { Contract } from '../provider/contract.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(publicGraph, membership)).not.toThrow();

  const aggregateGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export type { Contract } from '../provider/public.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : file === 'src/provider/public.ts'
          ? 'export type { Contract } from \'./contract.ts\';'
          : 'export const effect = true;'
  });
  const sourceProgramFacts = {
    files: files.map((path) => ({
      path,
      moduleId: path.startsWith('src/consumer/') ? consumer.moduleId : provider.moduleId,
      surface: 'production' as const,
      semanticKind: path === 'src/provider/public.ts'
        ? 'pure-reexport' as const
        : path === 'src/provider/runtime/effect.ts' || path === 'src/consumer/use.ts'
          ? 'executable' as const
          : 'declaration-owner' as const,
      semanticObservationClass: 'derived' as const
    })),
    entrypoints: [],
    entrypointClosures: [],
    capabilities: []
  };
  const aggregateProjection = compileSecRepositoryModuleArchitectureProjection(
    aggregateGraph,
    membership,
    sourceProgramFacts
  );
  expect(aggregateProjection.aggregateFacadePaths).toEqual(['src/provider/public.ts']);
  expect(() => assertSecRepositoryModuleArchitectureBoundaries(
    aggregateGraph,
    membership,
    sourceProgramFacts
  ))
    .toThrow('[cross-package-aggregate-surface]');

  const implementationGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/use.ts'
      ? "export { effect } from '../provider/runtime/effect.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  const implementationProjection = compileSecRepositoryModuleArchitectureProjection(
    implementationGraph,
    membership,
    sourceProgramFacts
  );
  expect(implementationProjection.aggregateFacadePaths).toEqual([]);
  expect(implementationProjection.violations).toEqual([]);
});

test('pre-dependency entrypoints cannot import an unavailable package', () => {
  const descriptor = parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/bootstrap/cli.ts'],
    preDependencyBootstrap: true
  }, 'src/bootstrap/sec.module.json');
  const graph = compileSecRepositoryModuleGraph({
    files: ['src/bootstrap/cli.ts'],
    readSource: () => "import 'unmaterialized-package';"
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(graph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).toThrow('[pre-dependency-bootstrap-unavailable-package]');

  const postBootstrapGraph = compileSecRepositoryModuleGraph({
    files: ['src/bootstrap/cli.ts'],
    readSource: () => "void import('materialized-after-bootstrap');"
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(postBootstrapGraph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).not.toThrow();
});

test('repository module admission rejects retired src/apps and src/modules roots', () => {
  for (const retiredRoot of ['src/apps', 'src/modules']) {
    expect(() => compileSecRepositoryModuleGraph({
      files: [`${retiredRoot}/legacy.ts`],
      readSource: () => 'export {};'
    })).toThrow('retired repository root');

    expect(() => parseSecModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: []
    }, `${retiredRoot}/sec.module.json`)).toThrow('retired repository root');
  }
});

test('repository module boundary compiler does not turn internal path spelling into policy', () => {
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const graph = compileSecRepositoryModuleGraph({
    files: [
      'src/consumer/index.ts',
      'src/provider/index.ts',
      'src/provider/internal/private.ts',
      'src/provider/operation.ts'
    ],
    readSource: (file) => file === 'src/consumer/index.ts'
      ? [
        "import '../provider/internal/private.ts';",
        "import '../provider/operation.ts';"
      ].join('\n')
      : 'export {};'
  });
  const violations = collectSecRepositoryModuleBoundaryViolations(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: [consumer.root, provider.root],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  });

  expect(violations).toEqual([]);
});

test('repository module dependency cycles exclude test observation edges', () => {
  const first = repositoryModuleTestDescriptor('src/first');
  const second = repositoryModuleTestDescriptor('src/second');
  const tests = repositoryModuleTestDescriptor('tests');
  const membership = {
    descriptors: [first, second, tests],
    graphRoots: ['src', 'tests'],
    moduleRoots: [first.root, second.root, tests.root],
    moduleForPath: (file: string) => file.startsWith('src/first/')
      ? first
      : file.startsWith('src/second/') ? second : tests
  };
  const observationGraph = compileSecRepositoryModuleGraph({
    files: [
      'src/first/index.ts',
      'src/second/index.ts',
      'src/second/reverse.spec.ts',
      'tests/observation.test.ts'
    ],
    readSource: (file) => file === 'src/first/index.ts'
      ? "import '../second/index.ts';"
      : file === 'tests/observation.test.ts'
        ? "import '../src/first/index.ts';"
        : file === 'src/second/reverse.spec.ts'
          ? "import '../first/index.ts';"
        : 'export {};'
  });
  expect(collectSecRepositoryModuleBoundaryViolations(observationGraph, membership)
    .some(({ code }) => code === 'module-dependency-cycle')).toBe(false);

  const productionCycleGraph = compileSecRepositoryModuleGraph({
    files: ['src/first/index.ts', 'src/second/index.ts'],
    readSource: (file) => file === 'src/first/index.ts'
      ? "import '../second/index.ts';"
      : "import '../first/index.ts';"
  });
  expect(collectSecRepositoryModuleBoundaryViolations(productionCycleGraph, membership)
    .filter(({ code }) => code === 'module-dependency-cycle')).toHaveLength(1);
});

test('repository architecture projects stable SCC witnesses, reciprocal pairs, and an acyclic feedback cut', () => {
  const alpha = repositoryModuleTestDescriptor('src/alpha');
  const beta = repositoryModuleTestDescriptor('src/beta');
  const membership = {
    descriptors: [beta, alpha],
    graphRoots: ['src'],
    moduleRoots: [beta.root, alpha.root],
    moduleForPath: (file: string) => file.startsWith('src/alpha/') ? alpha : beta
  };
  const files = ['src/beta/b.ts', 'src/alpha/a.ts'];
  const sources = new Map([
    ['src/alpha/a.ts', "import '../beta/b.ts'; export const alpha = true;"],
    ['src/beta/b.ts', "import '../alpha/a.ts'; export const beta = true;"]
  ]);
  const facts = {
    files: files.map((path) => ({
      path,
      moduleId: path.startsWith('src/alpha/') ? alpha.moduleId : beta.moduleId,
      surface: 'production' as const,
      semanticKind: 'declaration-owner' as const,
      semanticObservationClass: 'derived' as const
    })),
    entrypoints: [],
    entrypointClosures: []
  };
  const compile = (orderedFiles: readonly string[]) => {
    const graph = compileSecRepositoryModuleGraph({
      files: orderedFiles,
      readSource: (file) => sources.get(file) ?? null
    });
    return compileSecRepositoryModuleArchitectureProjection(graph, membership, facts);
  };
  const projection = compile(files);

  expect(projection.ownerEdges.map(({ fromOwner, toOwner }) => [fromOwner, toOwner]))
    .toEqual([
      [alpha.moduleId, beta.moduleId],
      [beta.moduleId, alpha.moduleId]
    ]);
  expect(projection.strongComponents).toEqual([expect.objectContaining({
    ownerIds: [alpha.moduleId, beta.moduleId]
  })]);
  expect(projection.reciprocalPairs).toHaveLength(1);
  expect(projection.feedbackCuts).toEqual([expect.objectContaining({
    fromOwner: beta.moduleId,
    toOwner: alpha.moduleId,
    witnesses: [expect.objectContaining({
      fromPath: 'src/beta/b.ts',
      toPath: 'src/alpha/a.ts'
    })]
  })]);
  expect(compile([...files].reverse())).toEqual(projection);
});

test('repository architecture derives one node responsibility and rejects reverse node dependencies', () => {
  const descriptors = [
    repositoryModuleTestDescriptor('src/contracts'),
    repositoryModuleTestDescriptor('src/computation'),
    parseSecModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [{ capability: 'clock', operations: ['readClock'] }]
    }, 'src/capability/sec.module.json'),
    repositoryModuleTestDescriptor('src/operation'),
    repositoryModuleTestDescriptor('src/workflow'),
    parseSecModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: ['src/interface/cli.ts']
    }, 'src/interface/sec.module.json')
  ];
  const files = [
    'src/contracts/types.ts',
    'src/computation/value.ts',
    'src/capability/clock.ts',
    'src/operation/execute.ts',
    'src/workflow/run.ts',
    'src/interface/cli.ts'
  ];
  const membership = {
    descriptors,
    graphRoots: ['src'],
    moduleRoots: descriptors.map(({ root }) => root),
    moduleForPath: (file: string) => descriptors.find(({ root }) => file.startsWith(`${root}/`)) ?? null
  };
  const sources = new Map([
    ['src/contracts/types.ts', 'export interface Value { readonly value: string; }'],
    ['src/computation/value.ts', "import type { Value } from '../contracts/types.ts'; export const value: Value = { value: 'x' };"],
    ['src/capability/clock.ts', 'export function readClock(): number { return 0; }'],
    ['src/operation/execute.ts', "import { readClock } from '../capability/clock.ts'; export const execute = () => readClock();"],
    ['src/workflow/run.ts', "import { execute } from '../operation/execute.ts'; export const run = () => execute();"],
    ['src/interface/cli.ts', "import { run } from '../workflow/run.ts'; run();"]
  ]);
  const facts = {
    files: files.map((path) => ({
      path,
      moduleId: membership.moduleForPath(path)?.moduleId ?? null,
      surface: 'production' as const,
      semanticKind: path === 'src/contracts/types.ts'
        ? 'declaration-owner' as const : 'executable' as const,
      semanticObservationClass: 'derived' as const
    })),
    declarations: [{
      path: 'src/capability/clock.ts',
      moduleId: 'capability',
      name: 'readClock',
      exported: true
    }],
    entrypoints: [{
      observationId: 'interface-cli',
      kind: 'module-entrypoint' as const,
      path: 'package.json',
      name: 'cli',
      targetPaths: ['src/interface/cli.ts'],
      observationClass: 'derived' as const
    }],
    entrypointClosures: [{
      entrypointObservationId: 'interface-cli',
      targetPaths: ['src/interface/cli.ts'],
      handlerModuleIds: ['interface'],
      reachablePaths: files,
      capabilityPaths: ['src/capability/clock.ts'],
      transports: [],
      unknownPaths: [],
      observationClass: 'derived' as const
    }],
    capabilities: []
  };
  const compile = (sourceForContract: string) => compileSecRepositoryModuleArchitectureProjection(
    compileSecRepositoryModuleGraph({
      files,
      readSource: (file) => file === 'src/contracts/types.ts'
        ? sourceForContract : sources.get(file) ?? null
    }),
    membership,
    facts
  );
  const valid = compile(sources.get('src/contracts/types.ts')!);
  expect(valid.nodeResponsibilities.map(({ path, responsibility }) => [path, responsibility]))
    .toEqual([
      ['src/capability/clock.ts', 'capability'],
      ['src/computation/value.ts', 'computation'],
      ['src/contracts/types.ts', 'contract'],
      ['src/interface/cli.ts', 'interface'],
      ['src/operation/execute.ts', 'operation'],
      ['src/workflow/run.ts', 'workflow']
    ]);
  expect(valid.violations).toEqual([]);

  const reversed = compile("export { readClock } from '../capability/clock.ts';");
  expect(reversed.violations).toContainEqual(expect.objectContaining({
    code: 'repository-node-responsibility-reverse-dependency',
    from: 'src/contracts/types.ts',
    to: 'src/capability/clock.ts'
  }));
});

test('package role claims cannot change node responsibility authority', () => {
  const descriptor = parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{ capability: 'example-provider', operations: ['run'] }]
  }, 'src/example/sec.module.json');
  const graph = compileSecRepositoryModuleGraph({
    files: ['src/example/value.ts'],
    readSource: () => 'export const value = 1;'
  });
  const facts = {
    files: [{
      path: 'src/example/value.ts',
      moduleId: descriptor.moduleId,
      surface: 'production' as const,
      semanticKind: 'executable' as const,
      semanticObservationClass: 'derived' as const
    }],
    entrypoints: [],
    entrypointClosures: [],
    capabilities: [],
    moduleRoles: [{
      moduleId: descriptor.moduleId,
      role: 'command' as const,
      observationClass: 'observed' as const
    }]
  };
  const projection = compileSecRepositoryModuleArchitectureProjection(graph, {
    descriptors: [descriptor],
    graphRoots: ['src/example'],
    moduleRoots: ['src/example'],
    moduleForPath: () => descriptor
  }, facts);
  expect(projection.nodeResponsibilities).toEqual([
    expect.objectContaining({
      path: 'src/example/value.ts',
      responsibility: 'unknown',
      reason: 'responsibility-evidence-unresolved'
    })
  ]);
  expect(projection.violations).toContainEqual(expect.objectContaining({
    code: 'repository-node-responsibility-unresolved',
    from: 'src/example/value.ts'
  }));
});

test('source-program ownership excludes colocated tests and binds public entrypoints to descriptors', () => {
  const undeclared = repositoryModuleTestDescriptor('src/feature');
  const declared = parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/feature/cli.ts']
  }, 'src/feature/sec.module.json');
  const membershipFor = (descriptor: typeof declared) => ({
    descriptors: [descriptor],
    graphRoots: [descriptor.root],
    moduleRoots: [descriptor.root],
    moduleForPath: (file: string) => file.startsWith('src/feature/') ? descriptor : null
  });
  const entrypointKinds = ['package-script', 'package-bin', 'module-entrypoint'] as const;
  const facts = {
    files: [
      { path: 'src/feature/cli.ts', moduleId: 'feature', surface: 'production' as const },
      { path: 'src/unowned/service.ts', moduleId: null, surface: 'production' as const },
      { path: 'src/unowned/service.test.ts', moduleId: null, surface: 'test' as const }
    ],
    entrypoints: entrypointKinds.map((kind) => ({
      observationId: kind,
      kind,
      path: 'package.json',
      name: kind,
      observationClass: 'observed' as const
    })),
    entrypointClosures: entrypointKinds.map((kind) => ({
      entrypointObservationId: kind,
      targetPaths: ['src/feature/cli.ts'],
      handlerModuleIds: ['feature'],
      reachablePaths: ['src/feature/cli.ts'],
      capabilityPaths: [],
      observationClass: 'observed' as const
    }))
  };

  const violations = collectSecRepositoryModuleSourceProgramViolations(
    facts,
    membershipFor(undeclared)
  );
  expect(violations.filter(({ code }) => code === 'unowned-production-source'))
    .toEqual([expect.objectContaining({ from: 'src/unowned/service.ts' })]);
  expect(violations.filter(({ code }) => code === 'repository-entrypoint-not-declared'))
    .toHaveLength(entrypointKinds.length);
  expect(violations.some(({ from }) => from === 'src/unowned/service.test.ts')).toBe(false);

  expect(() => assertSecRepositoryModuleSourceProgramBoundaries(facts, membershipFor(declared)))
    .toThrow('[unowned-production-source]');
  expect(() => assertSecRepositoryModuleSourceProgramBoundaries({
    ...facts,
    files: facts.files.filter(({ path }) => path !== 'src/unowned/service.ts')
  }, membershipFor(declared))).not.toThrow();
});
