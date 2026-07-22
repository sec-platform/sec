import { expect, test } from 'bun:test';

import { CodexDevelopmentIsActiveDocumentationPathV1 } from '../../platform/shared/active-documentation-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';

const NON_CANONICAL_REPOSITORY_PATHS = [
  '',
  '/docs/work/current-state.yaml',
  'C:/absolute.md',
  'C:relative.md',
  'file:/docs/readme.md',
  'docs\\work\\current-state.yaml',
  'docs/file:stream.md',
  'docs//x.md',
  'docs/./x.md',
  'docs/work/../evidence/probe.yaml',
  'docs/work//state.yaml',
  'docs/work/\0state.yaml',
  'docs/e\u0301.md'
] as const;

test('canonical repository paths require normalized repository-relative POSIX segments', () => {
  for (const file of [
    'README.md',
    'docs/03-MVP实施计划与路线图.md',
    'docs/work/current-state.yaml'
  ]) expect(CodexDevelopmentIsCanonicalRepositoryPathV1(file)).toBe(true);

  for (const file of NON_CANONICAL_REPOSITORY_PATHS) {
    expect(CodexDevelopmentIsCanonicalRepositoryPathV1(file)).toBe(false);
  }
});

test('active documentation paths cover repository, Markdown, and governed YAML authorities', () => {
  for (const file of [
    'README.md',
    'docs/03-MVP实施计划与路线图.md',
    'docs/architecture/engineering-workspace-ir.md',
    'docs/work/current-state.yaml',
    'docs/work/state.yml',
    'docs/work/manifest.yaml',
    'docs/governance/contracts/policy.yaml',
    'docs/governance/nexus-absorption-ledger.yaml'
  ]) expect(CodexDevelopmentIsActiveDocumentationPathV1(file)).toBe(true);
});

test('active documentation paths keep unowned and evidence inputs fail-closed', () => {
  for (const file of [
    'AGENTS.md',
    'README.MD',
    'docs/architecture/unowned.yaml',
    'docs/evidence/probe.yaml',
    'docs/evidence/probe.json',
    'docs/project-state.json',
    'assets/new.bin',
    ...NON_CANONICAL_REPOSITORY_PATHS
  ]) expect(CodexDevelopmentIsActiveDocumentationPathV1(file)).toBe(false);
});
