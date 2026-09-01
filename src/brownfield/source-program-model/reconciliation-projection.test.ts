import { expect, test } from 'bun:test';

import { rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import type { SourceProgramUnknown } from './contract.ts';
import {
  compileSourceProgramReconciliationProjection,
  type SourceProgramReconciliationProviderEvidence
} from './reconciliation-projection.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

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
    descriptorPath: `${root}/sec.module.json`,
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
  const membership = compileSecRepositoryModuleMembershipSnapshot({
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
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
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
    after: after.compilation,
    beforeMembership: before.membership,
    afterMembership: after.membership
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
    beforeMembership: before.membership,
    afterMembership: after.membership,
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

  const unavailableShadow = compileSourceProgramReconciliationProjection({
    before: before.compilation,
    after: after.compilation,
    beforeMembership: before.membership,
    afterMembership: after.membership,
    providerEvidence: [Object.freeze({
      provider: 'static-analysis.dependencies',
      status: 'unresolved',
      providerRevision: null,
      configDigest: null,
      inputDigest: null,
      candidateDigest: null
    })]
  });
  expect(unavailableShadow.unresolvedReasons).toContainEqual(expect.objectContaining({
    code: 'candidate-provider-evidence-unresolved',
    subject: 'static-analysis.dependencies'
  }));

  for (const status of ['absent', 'unexpected']) {
    const invalidRuntimeStatus = compileSourceProgramReconciliationProjection({
      before: before.compilation,
      after: after.compilation,
      beforeMembership: before.membership,
      afterMembership: after.membership,
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
    beforeMembership: before.membership,
    afterMembership: after.membership,
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
