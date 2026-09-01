import { expect, test } from 'bun:test';
import nodePath from 'node:path';

import {
  collectSecRepositoryModuleBoundaryViolations,
  compileSecRepositoryModuleGraph,
  parseSecModuleDescriptor,
  type SecRepositoryModuleBoundaryViolationCode,
  type SecRepositoryModuleMembership
} from './contract.ts';

const descriptor = parseSecModuleDescriptor({
  importGraph: 'runtime',
  externalEntrypoints: []
}, 'src/policy-observation/sec.module.json');

const membership: SecRepositoryModuleMembership = {
  descriptors: [descriptor],
  graphRoots: ['src'],
  moduleRoots: [descriptor.root],
  moduleForPath: () => descriptor
};

function importSpecifier(from: string, to: string): string {
  const relative = nodePath.posix.relative(nodePath.posix.dirname(from), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function violationsForEdge([from, to]: readonly [from: string, to: string]) {
  const graph = compileSecRepositoryModuleGraph({
    files: [from, to],
    readSource: (path) => path === from
      ? `import ${JSON.stringify(importSpecifier(from, to))};`
      : 'export {};'
  });
  return collectSecRepositoryModuleBoundaryViolations(graph, membership);
}

const policyEdges = [
  {
    code: 'compiler-no-upward-entrypoint-deps',
    forbidden: ['src/compiler/parse/input.ts', 'src/development/runner/cli.ts'],
    allowed: ['src/compiler/parse/input.ts', 'src/semantic/contracts/contract.ts']
  },
  {
    code: 'orchestrator-no-cli-or-dev-runner',
    forbidden: ['src/compiler/orchestration/run.ts', 'src/interface/cli/register.ts'],
    allowed: ['src/compiler/orchestration/run.ts', 'src/compiler/parse/input.ts']
  },
  {
    code: 'product-no-codex-control-plane',
    forbidden: ['src/workspace/runtime/project.ts', 'src/control/agent/task.ts'],
    allowed: ['src/workspace/runtime/project.ts', 'src/control/task/contract.ts']
  },
  {
    code: 'platform-compiler-facade-boundary',
    forbidden: ['src/interface/cli/register.ts', 'src/compiler/emit/report.ts'],
    allowed: ['src/change-management/upgrade/run.ts', 'src/compiler/emit/report.ts']
  },
  {
    code: 'verification-evidence-no-child-runner',
    forbidden: [
      'src/compiler/verify/semantic-mutation-isolated-verification-evidence.ts',
      'src/compiler/verify/run-semantic-mutation-isolated-child.ts'
    ],
    allowed: [
      'src/compiler/verify/other-evidence.ts',
      'src/compiler/verify/run-semantic-mutation-isolated-child.ts'
    ]
  },
  {
    code: 'semantic-mutation-no-upward-layer-deps',
    forbidden: ['src/compiler/semantic-mutation/derive.ts', 'src/workspace/runtime/project.ts'],
    allowed: ['src/compiler/semantic-mutation/derive.ts', 'src/semantic/contracts/contract.ts']
  },
  {
    code: 'semantic-foundations-no-reverse-mutation-deps',
    forbidden: ['src/compiler/ir/build.ts', 'src/compiler/semantic-mutation/derive.ts'],
    allowed: ['src/compiler/ir/build.ts', 'src/semantic/contracts/contract.ts']
  },
  {
    code: 'no-registry-to-compiler',
    forbidden: ['src/compiler/registry/read.ts', 'src/compiler/parse/input.ts'],
    allowed: ['src/compiler/registry/read.ts', 'src/semantic/contracts/contract.ts']
  }
] as const satisfies readonly Readonly<{
  code: SecRepositoryModuleBoundaryViolationCode;
  forbidden: readonly [string, string];
  allowed: readonly [string, string];
}>[];

test('canonical repository graph owns every dependency boundary previously expressed by path rules', () => {
  for (const rule of policyEdges) {
    expect(violationsForEdge(rule.forbidden), rule.code)
      .toContainEqual(expect.objectContaining({ code: rule.code }));
    expect(violationsForEdge(rule.allowed), rule.code)
      .not.toContainEqual(expect.objectContaining({ code: rule.code }));
  }
  expect(violationsForEdge([
    'src/workspace/test/helper.ts',
    'src/control/agent/task.ts'
  ])).toContainEqual(expect.objectContaining({ code: 'product-no-codex-control-plane' }));
  expect(violationsForEdge([
    'src/workspace/runtime/project.spec.ts',
    'src/control/agent/task.ts'
  ])).not.toContainEqual(expect.objectContaining({ code: 'product-no-codex-control-plane' }));
});

test('canonical repository graph rejects unresolved local imports and circular source relations', () => {
  const unresolved = compileSecRepositoryModuleGraph({
    files: ['src/feature/source.ts'],
    readSource: () => "import './missing.ts';"
  });
  expect(collectSecRepositoryModuleBoundaryViolations(unresolved, membership))
    .toContainEqual(expect.objectContaining({
      code: 'no-unresolved-production-dependencies',
      from: 'src/feature/source.ts'
    }));

  const circular = compileSecRepositoryModuleGraph({
    files: ['src/feature/a.ts', 'src/feature/b.ts'],
    readSource: (path) => path.endsWith('/a.ts')
      ? "import './b.ts';"
      : "import './a.ts';"
  });
  expect(collectSecRepositoryModuleBoundaryViolations(circular, membership))
    .toContainEqual(expect.objectContaining({ code: 'repository-module-internal-cycle' }));

  const testCircular = compileSecRepositoryModuleGraph({
    files: ['src/feature/a.test.ts', 'src/feature/b.test.ts'],
    readSource: (path) => path.endsWith('/a.test.ts')
      ? "import './b.test.ts';"
      : "import './a.test.ts';"
  });
  expect(collectSecRepositoryModuleBoundaryViolations(testCircular, membership))
    .toContainEqual(expect.objectContaining({ code: 'repository-module-internal-cycle' }));
});

test('dependency boundary projection is byte-identical for equivalent source snapshots', () => {
  const sources = new Map<string, string>();
  for (const { forbidden: [from, to] } of policyEdges) {
    sources.set(from, `import ${JSON.stringify(importSpecifier(from, to))};`);
    sources.set(to, sources.get(to) ?? 'export {};');
  }
  sources.set('src/feature/unresolved.ts', "import './missing.ts';");
  sources.set('src/feature/a.ts', "import './b.ts';");
  sources.set('src/feature/b.ts', "import './a.ts';");
  const files = [...sources.keys()];
  const compile = (orderedFiles: readonly string[]) => JSON.stringify(
    collectSecRepositoryModuleBoundaryViolations(
      compileSecRepositoryModuleGraph({
        files: orderedFiles,
        readSource: (path) => sources.get(path) ?? null
      }),
      membership
    )
  );

  const forward = compile(files);
  expect(compile([...files].reverse())).toBe(forward);
  const codes = new Set((JSON.parse(forward) as { code: string }[]).map(({ code }) => code));
  expect([...policyEdges, { code: 'no-unresolved-production-dependencies' }]
    .every(({ code }) => codes.has(code))).toBe(true);
  expect(codes.has('repository-module-internal-cycle')).toBe(true);
});
