import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertWorkPackageChangedRecords,
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentParseWorkPackageManifestV2,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';

const BASE = '1'.repeat(40);

function manifest(overrides = ''): string {
  return `---
schema: codex-development-work-package-v1
id: b0-bootstrap-v1
tracking: issue-106
base: "${BASE}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v14
tasks:
  - id: b0-bootstrap-v1
    owner: b0-writer
    ownedPaths:
      - platform/shared/ci-contract.ts
      - scripts/codex/
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact-head-evidence
tests:
  - bun run typecheck
${overrides}---

# B0 Bootstrap
`;
}

function manifestV2(overrides = ''): string {
  return `---
schema: codex-development-work-package-v2
id: ci-v7-evidence-composition-bootstrap-v1
tracking: none
base: "${BASE}"
manifestState: frozen
evidenceComposition:
  policyId: ci-v7-synthetic-composition-v1
tasks:
  - id: ci-v7-bootstrap
    owner: ci-v7-writer
    ownedPaths:
      - platform/shared/ci-evidence-reuse-contract.ts
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact-composition
${overrides}---

# CI V7 Bootstrap
`;
}

test('Work Package locator is one exact canonical PR body line', () => {
  expect(CodexDevelopmentParseWorkPackageLocator([
    'Summary',
    'Work-Package: docs/work-packages/b0-bootstrap-v1.md',
    'Validation'
  ].join('\n'))).toBe('docs/work-packages/b0-bootstrap-v1.md');
  expect(() => CodexDevelopmentParseWorkPackageLocator('no locator')).toThrow('exactly one');
  expect(() => CodexDevelopmentParseWorkPackageLocator([
    'Work-Package: docs/work-packages/b0-bootstrap-v1.md',
    'Work-Package: docs/work-packages/other.md'
  ].join('\n'))).toThrow('found 2');
  expect(() => CodexDevelopmentParseWorkPackageLocator(
    'Work-Package: ./docs/work-packages/b0-bootstrap-v1.md'
  )).toThrow('must be exactly');
});

test('frozen Work Package V1 binds strict task ownership and full manifest bytes', () => {
  const source = manifest();
  const parsed = CodexDevelopmentParseWorkPackageManifestV1(
    source,
    'docs/work-packages/b0-bootstrap-v1.md'
  );
  expect(parsed).toMatchObject({
    id: 'b0-bootstrap-v1',
    base: BASE,
    manifestState: 'frozen',
    requiredProfile: 'quick',
    ciRevision: 'ci-verification-v14'
  });
  for (const legacyRevision of ['ci-verification-v13', 'ci-verification-v12', 'ci-verification-v11', 'ci-verification-v10', 'ci-verification-v9', 'ci-verification-v8', 'ci-verification-v6'] as const) {
    const historical = CodexDevelopmentParseWorkPackageManifestV1(
      source.replace('ci-verification-v14', legacyRevision)
    );
    expect(historical.ciRevision).toBe(legacyRevision);
  }
  expect(CodexDevelopmentWorkPackageManifestDigest(source)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(CodexDevelopmentAssertWorkPackageOwnership(parsed, [
    'platform/shared/ci-contract.ts',
    'scripts/codex/merge-gate.ts'
  ])).toEqual({
    changedPathOwners: [
      { path: 'platform/shared/ci-contract.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' },
      { path: 'scripts/codex/merge-gate.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' }
    ]
  });
});

test('Work Package V2 exposes only one immutable evidence-composition policy reference', () => {
  const parsed = CodexDevelopmentParseWorkPackageManifestV2(
    manifestV2(),
    'docs/work-packages/ci-v7-evidence-composition-bootstrap-v1.md'
  );
  expect(parsed).toMatchObject({
    schema: 'codex-development-work-package-v2',
    id: 'ci-v7-evidence-composition-bootstrap-v1',
    evidenceComposition: { policyId: 'ci-v7-synthetic-composition-v1' }
  });
  expect('requiredProfile' in parsed).toBe(false);
  expect('ciRevision' in parsed).toBe(false);
  expect('tests' in parsed).toBe(false);
  expect(CodexDevelopmentParseWorkPackageManifest(manifestV2())).toEqual(parsed);
  expect(CodexDevelopmentParseWorkPackageManifest(manifest())).toEqual(
    CodexDevelopmentParseWorkPackageManifestV1(manifest())
  );
});

test('Work Package V2 rejects commands, exclusions, evidence claims, and unknown policy fields', () => {
  for (const injected of [
    '  argv: [bun, test]\n',
    '  exclude: tests/e2e/**\n',
    '  evidencePath: docs/evidence/candidate.json\n',
    '  scopeIds: [fast-test:any]\n',
    'tests:\n  - bun run typecheck\n',
    'requiredProfile: quick\n',
    'ciRevision: ci-verification-v7\n'
  ]) {
    expect(() => CodexDevelopmentParseWorkPackageManifestV2(manifestV2(injected))).toThrow();
  }
});

test('Work Package parser rejects unknown, duplicate, mutable, and ambiguous scope', () => {
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest('unknownField: true\n')
  )).toThrow('must contain exactly');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('tracking: issue-106', 'tracking: issue-106\ntracking: issue-107')
  )).toThrow('YAML is invalid');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('manifestState: frozen', 'manifestState: draft')
  )).toThrow('must be frozen');
  for (const revision of ['ci-verification-v0', 'ci-verification-v05', 'ci-verification-latest']) {
    expect(() => CodexDevelopmentParseWorkPackageManifestV1(
      manifest().replace('ci-verification-v14', revision)
    )).toThrow('stable positive verification revision');
  }
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('id: b0-bootstrap-v1', 'id: !custom b0-bootstrap-v1')
  )).toThrow('YAML tags are forbidden');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace(
      '      - scripts/codex/',
      '      - scripts/codex/\n      - scripts/codex/merge-gate.ts'
    )
  )).toThrow('owned paths overlap');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('  - platform/compiler/', '  - scripts/codex/')
  )).toThrow('owned/forbidden paths overlap');
});

test('Work Package ownership rejects unowned and forbidden changed paths', () => {
  const parsed = CodexDevelopmentParseWorkPackageManifestV1(manifest());
  expect(() => CodexDevelopmentAssertWorkPackageOwnership(parsed, ['README.md'])).toThrow('exactly one');
  expect(() => CodexDevelopmentAssertWorkPackageOwnership(parsed, ['platform/compiler/resolve/index.ts'])).toThrow('forbidden');
  expect(() => CodexDevelopmentAssertWorkPackageOwnership(parsed, ['scripts\\codex\\merge-gate.ts'])).toThrow('normalized POSIX');
});

test('Work Package literal paths allow framework brackets but reject Windows and Unicode collisions', () => {
  const bracketed = manifest().replace(
    '      - scripts/codex/',
    '      - app/[customerId]/'
  );
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(bracketed)).not.toThrow();
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('      - scripts/codex/', '      - app/CON.ts')
  )).toThrow('normalized POSIX');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('      - scripts/codex/', '      - app/file.ts:stream')
  )).toThrow('normalized POSIX');
  expect(() => CodexDevelopmentParseWorkPackageManifestV1(
    manifest().replace('      - scripts/codex/', '      - app/**')
  )).toThrow('normalized POSIX');
});

test('rename and copy endpoints must remain inside one task seam', () => {
  const source = manifest().replace(
    '  - id: b0-bootstrap-v1\n    owner: b0-writer\n    ownedPaths:\n      - platform/shared/ci-contract.ts\n      - scripts/codex/',
    `  - id: shared-task
    owner: shared-writer
    ownedPaths:
      - platform/shared/
  - id: scripts-task
    owner: scripts-writer
    ownedPaths:
      - scripts/codex/`
  );
  const parsed = CodexDevelopmentParseWorkPackageManifestV1(source);
  expect(() => CodexDevelopmentAssertWorkPackageChangedRecords(parsed, [{
    status: 'renamed',
    previousPath: 'platform/shared/old.ts',
    path: 'scripts/codex/new.ts'
  }])).toThrow('Cross-task renamed is forbidden');
  expect(() => CodexDevelopmentAssertWorkPackageChangedRecords(parsed, [{
    status: 'renamed',
    previousPath: 'scripts/codex/old.ts',
    path: 'scripts/codex/new.ts'
  }])).not.toThrow();
});

test('changed records reject case-insensitive flattened path collisions', () => {
  const parsed = CodexDevelopmentParseWorkPackageManifestV1(manifest().replace(
    '      - platform/shared/ci-contract.ts\n      - scripts/codex/',
    '      - src/'
  ));
  expect(() => CodexDevelopmentAssertWorkPackageChangedRecords(parsed, [
    { status: 'changed', path: 'src/Foo.ts' },
    { status: 'changed', path: 'src/foo.ts' }
  ])).toThrow('Windows-colliding');
});
