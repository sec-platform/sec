import { expect, test } from 'bun:test';

import {
  AssertWorkPackageChangedRecords,
  AssertWorkPackageOwnership,
  DecodeWorkPackageManifest,
  ParseWorkPackageLocator,
  ParseWorkPackageManifest,
  WorkPackageManifestDigest
} from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';

const BASE = '1'.repeat(40);

function manifest(overrides = ''): string {
  return `---
schema: codex-development-work-package-v1
id: b0-bootstrap-v1
tracking: issue-106
base: "${BASE}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: b0-bootstrap-v1
    owner: b0-writer
    ownedPaths:
      - platform/shared/ci-contract.ts
      - scripts/codex/
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact-head-evidence
tests:
  - tests/unit/work-package-contract.test.ts
${overrides}---

# B0 Bootstrap
`;
}

function retiredManifest(): string {
  return `---
schema: codex-development-work-package-v2
id: ci-v8-evidence-composition-bootstrap-v1
tracking: none
base: "${BASE}"
manifestState: frozen
evidenceComposition:
  policyId: ci-v8-synthetic-composition-v1
tasks:
  - id: ci-v8-bootstrap
    owner: ci-v8-writer
    ownedPaths:
      - platform/shared/ci-evidence-reuse-contract.ts
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact-composition
---

# CI V8 Bootstrap
`;
}

test('Work Package locator is one exact canonical PR body line', () => {
  expect(ParseWorkPackageLocator([
    'Summary',
    'Work-Package: config/repository/work-packages/b0-bootstrap-v1.md',
    'Validation'
  ].join('\n'))).toBe('config/repository/work-packages/b0-bootstrap-v1.md');
  expect(() => ParseWorkPackageLocator('no locator')).toThrow('exactly one');
  expect(() => ParseWorkPackageLocator([
    'Work-Package: config/repository/work-packages/b0-bootstrap-v1.md',
    'Work-Package: config/repository/work-packages/other.md'
  ].join('\n'))).toThrow('found 2');
  expect(() => ParseWorkPackageLocator(
    'Work-Package: ./config/repository/work-packages/b0-bootstrap-v1.md'
  )).toThrow('must be exactly');
});

test('frozen Work Package V1 binds strict task ownership and full manifest bytes', () => {
  const source = manifest();
  const parsed = DecodeWorkPackageManifest(
    source,
    'config/repository/work-packages/b0-bootstrap-v1.md'
  );
  expect(parsed).toMatchObject({
    id: 'b0-bootstrap-v1',
    base: BASE,
    manifestState: 'frozen',
    requiredProfile: 'quick',
    ciRevision: 'ci-verification-v19'
  });
  for (const legacyRevision of ['ci-verification-v18', 'ci-verification-v17', 'ci-verification-v16', 'ci-verification-v15', 'ci-verification-v14', 'ci-verification-v13', 'ci-verification-v12', 'ci-verification-v11', 'ci-verification-v10', 'ci-verification-v9', 'ci-verification-v8', 'ci-verification-v6'] as const) {
    const historical = DecodeWorkPackageManifest(
      source.replace('ci-verification-v19', legacyRevision)
    );
    expect(historical.ciRevision).toBe(legacyRevision);
  }
  expect(WorkPackageManifestDigest(source)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(AssertWorkPackageOwnership(parsed, [
    'platform/shared/ci-contract.ts',
    'scripts/codex/example.ts'
  ])).toEqual({
    changedPathOwners: [
      { path: 'platform/shared/ci-contract.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' },
      { path: 'scripts/codex/example.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' }
    ]
  });
});

test('Work Package V1 authorityRefs are optional canonical document identities', () => {
  const first = 'urn:uuid:00000000-0000-4000-8000-000000000001';
  const second = 'urn:uuid:00000000-0000-4000-8000-000000000002';
  const withAuthority = manifest().replace(
    'tasks:\n',
    `authorityRefs:\n  - ${first}\n  - ${second}\ntasks:\n`
  );
  expect(DecodeWorkPackageManifest(withAuthority).authorityRefs).toEqual([
    first,
    second
  ]);
  expect(DecodeWorkPackageManifest(manifest()).authorityRefs).toBeUndefined();
  expect(() => DecodeWorkPackageManifest(withAuthority.replace(
    `  - ${first}\n  - ${second}`,
    `  - ${second}\n  - ${first}`
  ))).toThrow(/canonical code-unit order/u);
  expect(() => DecodeWorkPackageManifest(withAuthority.replace(
    first,
    'development-governance'
  ))).toThrow(/document UUID URN/u);
});

test('Work Package parser exposes one V1 authority route and rejects retired V2 bytes', () => {
  expect(ParseWorkPackageManifest(manifest())).toEqual(
    DecodeWorkPackageManifest(manifest())
  );
  expect(() => ParseWorkPackageManifest(retiredManifest()))
    .toThrow('schema is unsupported');
  for (const historicalOrFuture of ['ci-verification-v18', 'ci-verification-v20'] as const) {
    expect(() => ParseWorkPackageManifest(
      manifest().replace('ci-verification-v19', historicalOrFuture)
    )).toThrow('current CI verification revision');
    expect(DecodeWorkPackageManifest(
      manifest().replace('ci-verification-v19', historicalOrFuture)
    ).ciRevision).toBe(historicalOrFuture);
  }
});

test('Work Package parser rejects unknown, duplicate, mutable, and ambiguous scope', () => {
  expect(() => DecodeWorkPackageManifest(
    manifest('unknownField: true\n')
  )).toThrow('must contain exactly');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('tracking: issue-106', 'tracking: issue-106\ntracking: issue-107')
  )).toThrow('YAML is invalid');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('manifestState: frozen', 'manifestState: draft')
  )).toThrow('must be frozen');
  for (const revision of ['ci-verification-v0', 'ci-verification-v05', 'ci-verification-latest']) {
    expect(() => DecodeWorkPackageManifest(
      manifest().replace('ci-verification-v19', revision)
    )).toThrow('stable positive verification revision');
  }
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('tests/unit/work-package-contract.test.ts', 'bun run typecheck')
  )).toThrow();
  expect(() => DecodeWorkPackageManifest(
    manifest()
      .replace('ci-verification-v19', 'ci-verification-v18')
      .replace('tests/unit/work-package-contract.test.ts', 'bun run typecheck')
  )).toThrow();
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('id: b0-bootstrap-v1', 'id: !custom b0-bootstrap-v1')
  )).toThrow('YAML tags are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace(
      '      - scripts/codex/',
      '      - scripts/codex/\n      - scripts/codex/example.ts'
    )
  )).toThrow('owned paths overlap');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('  - src/compiler/', '  - scripts/codex/')
  )).toThrow('owned/forbidden paths overlap');
});

test('built-in Work Package YAML keeps strict mapping and lexical fail-closed semantics', () => {
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('    owner: b0-writer', '    owner: b0-writer\n    owner: duplicate-writer')
  )).toThrow('duplicate mapping key "owner"');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('id: b0-bootstrap-v1', 'id: &manifest-id b0-bootstrap-v1')
  )).toThrow('anchors, aliases, and merge keys are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('tracking: issue-106', 'tracking: *manifest-id')
  )).toThrow('anchors, aliases, and merge keys are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('acceptance:\n  - exact-head-evidence', 'acceptance: [exact-head-evidence]')
  )).toThrow('flow collections are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('acceptance:\n  - exact-head-evidence', 'acceptance: |\n  exact-head-evidence')
  )).toThrow('block scalars are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('tracking: issue-106', '\ttracking: issue-106')
  )).toThrow('tabs are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('tracking: issue-106', '"tracking": issue-106')
  )).toThrow('complex or quoted mapping keys are forbidden');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace(
      '  - exact-head-evidence',
      '  - "quoted [value] {value} !tag &anchor *alias | > # remains data"'
    )
  )).not.toThrow();
});

test('Work Package ownership rejects unowned and forbidden changed paths', () => {
  const parsed = DecodeWorkPackageManifest(manifest());
  expect(() => AssertWorkPackageOwnership(parsed, ['README.md'])).toThrow('exactly one');
  expect(() => AssertWorkPackageOwnership(parsed, ['src/compiler/resolve/index.ts'])).toThrow('forbidden');
  expect(() => AssertWorkPackageOwnership(parsed, ['scripts\\codex\\merge-gate.ts'])).toThrow('normalized POSIX');
});

test('Work Package literal paths allow framework brackets but reject Windows and Unicode collisions', () => {
  const bracketed = manifest().replace(
    '      - scripts/codex/',
    '      - app/[customerId]/'
  );
  expect(() => DecodeWorkPackageManifest(bracketed)).not.toThrow();
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('      - scripts/codex/', '      - app/CON.ts')
  )).toThrow('normalized POSIX');
  expect(() => DecodeWorkPackageManifest(
    manifest().replace('      - scripts/codex/', '      - app/file.ts:stream')
  )).toThrow('normalized POSIX');
  expect(() => DecodeWorkPackageManifest(
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
  const parsed = DecodeWorkPackageManifest(source);
  expect(() => AssertWorkPackageChangedRecords(parsed, [{
    status: 'renamed',
    previousPath: 'platform/shared/old.ts',
    path: 'scripts/codex/new.ts'
  }])).toThrow('Cross-task renamed is forbidden');
  expect(() => AssertWorkPackageChangedRecords(parsed, [{
    status: 'renamed',
    previousPath: 'scripts/codex/old.ts',
    path: 'scripts/codex/new.ts'
  }])).not.toThrow();
  expect(() => AssertWorkPackageChangedRecords(parsed, [{
    status: 'copied',
    previousPath: 'platform/shared/source.ts',
    path: 'scripts/codex/copy.ts'
  }])).toThrow('Cross-task copied is forbidden');
});

test('changed records preserve same-source copy lineage without weakening path identity', () => {
  const parsed = DecodeWorkPackageManifest(manifest().replace(
    '  - src/compiler/',
    '  - vendor/'
  ).replace(
    '      - platform/shared/ci-contract.ts\n      - scripts/codex/',
    '      - src/'
  ));
  expect(AssertWorkPackageChangedRecords(parsed, [
    { status: 'changed', path: 'src/source.ts' },
    { status: 'copied', previousPath: 'src/source.ts', path: 'src/archive/first.ts' },
    { status: 'copied', previousPath: 'src/source.ts', path: 'src/archive/second.ts' }
  ])).toEqual({
    changedPathOwners: [
      { path: 'src/archive/first.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' },
      { path: 'src/archive/second.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' },
      { path: 'src/source.ts', taskId: 'b0-bootstrap-v1', owner: 'b0-writer' }
    ]
  });
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'renamed', previousPath: 'src/source.ts', path: 'src/archive/first.ts' },
    { status: 'copied', previousPath: 'src/source.ts', path: 'src/archive/second.ts' }
  ])).not.toThrow();
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'changed', path: 'src/source.ts' },
    { status: 'changed', path: 'src/source.ts' }
  ])).toThrow('duplicates an earlier changed-file record');
  expect(() => AssertWorkPackageChangedRecords(parsed, [{
    status: 'copied',
    previousPath: 'src/source.ts',
    path: 'src/source.ts'
  }])).toThrow('source and destination paths must differ');
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'copied', previousPath: 'src/source.ts', path: 'src/archive/first.ts' },
    { status: 'copied', previousPath: 'src/other.ts', path: 'src/archive/first.ts' }
  ])).toThrow('ambiguous duplicate path roles');
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'removed', path: 'src/source.ts' },
    { status: 'copied', previousPath: 'src/source.ts', path: 'src/archive/first.ts' }
  ])).toThrow('ambiguous duplicate path roles');
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'renamed', previousPath: 'src/source.ts', path: 'src/archive/first.ts' },
    { status: 'renamed', previousPath: 'src/source.ts', path: 'src/archive/second.ts' }
  ])).toThrow('ambiguous duplicate path roles');
});

test('changed records reject case-insensitive flattened path collisions', () => {
  const parsed = DecodeWorkPackageManifest(manifest().replace(
    '  - src/compiler/',
    '  - vendor/'
  ).replace(
    '      - platform/shared/ci-contract.ts\n      - scripts/codex/',
    '      - src/'
  ));
  expect(() => AssertWorkPackageChangedRecords(parsed, [
    { status: 'changed', path: 'src/Foo.ts' },
    { status: 'changed', path: 'src/foo.ts' }
  ])).toThrow('Windows-colliding');
});
