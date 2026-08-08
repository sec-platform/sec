import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  matchSecTrustedBootstrapPathV1,
  parseSecTrustedBootstrapRegistryV1,
  SEC_TRUST_ROOT_PATHS_V1,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1,
  type SecTrustedBootstrapRegistryV1
} from '../../platform/shared/tcb-trust-root-contract.ts';

function canonicalSource(value: SecTrustedBootstrapRegistryV1 | Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function registrySource(): string {
  return readFileSync(path.join(compilerRoot, ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1.split('/')), 'utf8');
}

function mutate(patch: Partial<Record<keyof SecTrustedBootstrapRegistryV1, unknown>>): string {
  return canonicalSource({ ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1, ...patch });
}

test('canonical trust-root registry is structurally strict and separates static privilege from causal runtime', () => {
  const parsed = parseSecTrustedBootstrapRegistryV1(registrySource());
  expect(parsed).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1);
  expect(parsed.causalRuntimePaths).toContain('scripts/codex/sec-merge-bootstrap-runtime.ts');
  expect(parsed.runtimeEntrypoints).toContain('scripts/codex/sec-merge-bootstrap.ts');
  expect(parsed.reviewedSutEdges).toEqual(['scripts/ci-workspace-fast.ts -> platform/orchestrator.ts']);

  expect(matchSecTrustedBootstrapPathV1('scripts/codex/repository-audit.ts')).toBeNull();
  expect(matchSecTrustedBootstrapPathV1('scripts/codex/sec-merge-bootstrap.ts')).toEqual({
    kind: 'causal-runtime',
    rule: 'scripts/codex/sec-merge-bootstrap.ts'
  });
  expect(matchSecTrustedBootstrapPathV1('scripts/codex/merge-gate.ts')).toEqual({
    kind: 'causal-runtime',
    rule: 'scripts/codex/merge-gate.ts'
  });
  expect(matchSecTrustedBootstrapPathV1('platform/shared/tcb-closure-lock.ts')).toEqual({
    kind: 'static-exact',
    rule: 'platform/shared/tcb-closure-lock.ts'
  });
  expect(matchSecTrustedBootstrapPathV1('platform/shared/tcb-trust-root-contract.ts')).toEqual({
    kind: 'causal-runtime',
    rule: 'platform/shared/tcb-trust-root-contract.ts'
  });
  expect(matchSecTrustedBootstrapPathV1(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1)).toEqual({
    kind: 'static-exact',
    rule: SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1
  });
  expect(matchSecTrustedBootstrapPathV1('.github/workflows/compiler-pr-validation.yml')).toEqual({
    kind: 'static-directory',
    rule: '.github/workflows/'
  });
  expect(matchSecTrustedBootstrapPathV1('.env.production')).toEqual({
    kind: 'static-prefix',
    rule: '.env'
  });
  expect(SEC_TRUST_ROOT_PATHS_V1).not.toContain('scripts/codex/');
  expect(SEC_TRUST_ROOT_PATHS_V1).toContain('scripts/codex/merge-gate.ts');
});

test('trust-root registry rejects structural ambiguity, path aliases and self-demotion', () => {
  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1;
  const failures = [
    registrySource().trimEnd(),
    `${registrySource()}\n`,
    canonicalSource({ ...base, unknown: true }),
    registrySource().replace(
      '  "schema": "sec-trusted-bootstrap-registry-v1",\n',
      '  "schema": "sec-trusted-bootstrap-registry-v1",\n  "schema": "sec-trusted-bootstrap-registry-v1",\n'
    ),
    mutate({ staticExactPaths: [...base.staticExactPaths, base.staticExactPaths[0]!].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths].reverse() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'C:/escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), '../escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'platform\\escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'docs/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths.slice(0, -1), 'tests/testkit'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'scripts/codex/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'platform/shared/'].sort() }),
    mutate({ staticPrefixes: ['.env', '.env.'] }),
    mutate({ staticPrefixes: ['../'] }),
    mutate({ staticExactPaths: base.staticExactPaths.filter((entry) => entry !== '.bun-version') }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== 'platform/shared/tcb-closure-lock.ts')
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter((entry) => entry !== 'platform/shared/tcb-trust-root-contract.ts')
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1)
    }),
    mutate({
      causalRuntimePaths: base.causalRuntimePaths.filter((entry) => entry !== 'scripts/codex/merge-gate.ts')
    }),
    mutate({
      causalRuntimePaths: [...base.causalRuntimePaths, 'scripts/codex/repository-audit.ts'].sort()
    }),
    mutate({
      runtimeEntrypoints: [...base.runtimeEntrypoints, 'scripts/codex/repository-audit.ts'].sort()
    }),
    mutate({
      reviewedSutEdges: ['scripts/codex/repository-audit.ts -> platform/orchestrator.ts']
    }),
    mutate({
      causalRuntimePaths: [...base.causalRuntimePaths.slice(0, -1), 'virtual/e\u0301.ts'].sort()
    })
  ];

  for (const source of failures) {
    expect(() => parseSecTrustedBootstrapRegistryV1(source)).toThrow();
  }
});

test('trust-root matcher rejects non-canonical caller paths instead of laundering aliases', () => {
  for (const repositoryPath of [
    '../scripts/codex/merge-gate.ts',
    '/scripts/codex/merge-gate.ts',
    'scripts\\codex\\merge-gate.ts',
    'scripts//codex/merge-gate.ts',
    'C:/scripts/codex/merge-gate.ts'
  ]) {
    expect(() => matchSecTrustedBootstrapPathV1(repositoryPath)).toThrow();
  }
});
