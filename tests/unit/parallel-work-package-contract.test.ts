import { expect, test } from 'bun:test';

import type {
  ParallelConflictInput,
  ParallelWorkPackageManifestV3
} from '../../scripts/codex/parallel-work-package-contract.ts';
import {
  CodexDevelopmentParseParallelWorkPackageManifestV3,
  GLOBAL_EXCLUSIVE_RESOURCE_CLASSES,
  ParallelWorkPackageManifestDigest,
  ParallelWorkPackageSchemaV3,
  classifyGlobalExclusiveResource,
  resolveParallelConflict
} from '../../scripts/codex/parallel-work-package-contract.ts';

const BASE = 'a'.repeat(40);
const BASE_B = 'b'.repeat(40);

function v3Manifest(
  overrides: {
    id?: string;
    base?: string;
    authorityReads?: string[];
    authorityWrites?: string[];
    owned?: string[];
    permitted?: string[];
    forbidden?: string[];
    exclusive?: string[];
    sharedReadOnly?: string[];
    requires?: string[];
    orderedAfter?: string[];
    conflictsWith?: string[];
    policyId?: string;
    acceptance?: string[];
    cleanup?: string[];
  } = {}
): string {
  const id = overrides.id ?? 'test-package-a';
  const tracking = 'issue-1';
  const base = overrides.base ?? BASE;
  const ar = overrides.authorityReads ?? [];
  const aw = overrides.authorityWrites ?? ['test.authority.a'];
  const owned = overrides.owned ?? ['platform/shared/test-a/'];
  const permitted = overrides.permitted ?? [];
  const forbidden = overrides.forbidden ?? ['package.json'];
  const exclusive = overrides.exclusive ?? [];
  const sharedReadOnly = overrides.sharedReadOnly ?? [];
  const requires = overrides.requires ?? [];
  const orderedAfter = overrides.orderedAfter ?? [];
  const conflictsWith = overrides.conflictsWith ?? [];
  const policyId = overrides.policyId ?? 'test-policy-a';
  const acceptance = overrides.acceptance ?? ['acceptance-a'];
  const cleanup = overrides.cleanup ?? ['branch', 'worktree'];

  const seq = (items: string[], indent: number): string => {
    const pad = ' '.repeat(indent);
    return items.length > 0 ? items.map((i) => `${pad}- ${i}`).join('\n') : '';
  };

  const yaml = `---
schema: codex-development-work-package-v3
id: ${id}
tracking: ${tracking}
base: ${base}
manifestState: frozen
scope:
  authorityReads:
${seq(ar, 4)}
  authorityWrites:
${seq(aw, 4)}
  paths:
    owned:
${seq(owned, 6)}
    permitted:
${seq(permitted, 6)}
    forbidden:
${seq(forbidden, 6)}
  resources:
    exclusive:
${seq(exclusive, 6)}
    sharedReadOnly:
${seq(sharedReadOnly, 6)}
relations:
  requires:
${seq(requires, 4)}
  orderedAfter:
${seq(orderedAfter, 4)}
  conflictsWith:
${seq(conflictsWith, 4)}
verification:
  policyId: ${policyId}
acceptance:
${seq(acceptance, 2)}
completion:
  cleanup:
${seq(cleanup, 4)}
---

# Test Package
`;
  return yaml;
}

function parseV3(source: string): ParallelWorkPackageManifestV3 {
  return CodexDevelopmentParseParallelWorkPackageManifestV3(source);
}

function v3Input(manifest: ParallelWorkPackageManifestV3): ParallelConflictInput {
  return { kind: 'v3', manifest };
}

function legacyInput(id: string): ParallelConflictInput {
  return { kind: 'legacy', manifest: { schema: 'codex-development-work-package-v1', id } };
}

// ============================================================
// V3 Parser tests
// ============================================================

test('V3 parser parses a valid manifest', () => {
  const source = v3Manifest();
  const manifest = parseV3(source);
  expect(manifest.schema).toBe(ParallelWorkPackageSchemaV3);
  expect(manifest.id).toBe('test-package-a');
  expect(manifest.base).toBe(BASE);
  expect(manifest.scope.authorityWrites).toEqual(['test.authority.a']);
  expect(manifest.scope.paths.owned).toEqual(['platform/shared/test-a/']);
  expect(manifest.scope.paths.forbidden).toEqual(['package.json']);
  expect(manifest.relations.requires).toEqual([]);
  expect(manifest.verification.policyId).toBe('test-policy-a');
  expect(manifest.completion.cleanup).toEqual(['branch', 'worktree']);
});

test('V3 parser rejects missing top-level keys', () => {
  const source = `---
schema: codex-development-work-package-v3
id: test-package-a
tracking: issue-1
base: ${BASE}
manifestState: frozen
---

# Missing scope/relations/verification/acceptance/completion
`;
  expect(() => parseV3(source)).toThrow('must contain exactly');
});

test('V3 parser rejects invalid schema', () => {
  const source = v3Manifest();
  const bad = source.replace('codex-development-work-package-v3', 'codex-development-work-package-v1');
  expect(() => parseV3(bad)).toThrow('schema mismatch');
});

test('V3 parser rejects non-frozen manifestState', () => {
  const source = v3Manifest().replace('manifestState: frozen', 'manifestState: draft');
  expect(() => parseV3(source)).toThrow('must be frozen');
});

test('V3 parser rejects invalid base SHA', () => {
  const source = v3Manifest({ base: 'short' });
  expect(() => parseV3(source)).toThrow('40-character Git SHA');
});

test('V3 parser rejects invalid ownership path with backslash', () => {
  const source = v3Manifest({ owned: ['platform\\\\shared\\\\'] });
  expect(() => parseV3(source)).toThrow('normalized POSIX');
});

test('V3 parser rejects overlapping owned paths', () => {
  const source = v3Manifest({
    owned: ['platform/shared/test-a/', 'platform/shared/test-a/sub.ts']
  });
  expect(() => parseV3(source)).toThrow('overlap');
});

test('V3 parser rejects overlapping owned and forbidden paths', () => {
  const source = v3Manifest({
    owned: ['platform/shared/test-a/'],
    forbidden: ['platform/shared/test-a/sub.ts']
  });
  expect(() => parseV3(source)).toThrow('overlap');
});

test('V3 parser rejects Windows case collision in paths', () => {
  const source = v3Manifest({
    owned: ['platform/shared/test-a/'],
    forbidden: ['Platform/Shared/Test-A/']
  });
  expect(() => parseV3(source)).toThrow('overlap');
});

test('V3 parser rejects invalid cleanup value', () => {
  const source = v3Manifest({ cleanup: ['branch', 'invalid-cleanup'] });
  expect(() => parseV3(source)).toThrow('cleanup');
});

test('V3 parser rejects duplicate authority entries', () => {
  const source = v3Manifest({
    authorityWrites: ['test.authority.a', 'test.authority.a']
  });
  expect(() => parseV3(source)).toThrow('duplicate');
});

test('V3 parser computes manifest digest', () => {
  const source = v3Manifest();
  const digest = ParallelWorkPackageManifestDigest(source);
  expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('V3 parser validates canonical path', () => {
  const source = v3Manifest();
  expect(() => parseV3(source)).not.toThrow();
  expect(() => CodexDevelopmentParseParallelWorkPackageManifestV3(source, 'docs/work-packages/test-package-a.md')).not.toThrow();
  expect(() => CodexDevelopmentParseParallelWorkPackageManifestV3(source, 'docs/work-packages/wrong-id.md')).toThrow('ID/path mismatch');
});

// ============================================================
// Global Exclusive Resource Registry tests
// ============================================================

test('global resource registry has 8 classes', () => {
  expect(GLOBAL_EXCLUSIVE_RESOURCE_CLASSES.length).toBe(8);
});

test('classifyGlobalExclusiveResource maps package.json to package-lock', () => {
  expect(classifyGlobalExclusiveResource('package.json')).toBe('package-lock');
  expect(classifyGlobalExclusiveResource('bun.lock')).toBe('package-lock');
});

test('classifyGlobalExclusiveResource maps docs/work/ to docs-control-plane', () => {
  expect(classifyGlobalExclusiveResource('docs/work/active-work-package.md')).toBe('docs-control-plane');
  expect(classifyGlobalExclusiveResource('docs/work/')).toBe('docs-control-plane');
});

test('classifyGlobalExclusiveResource maps AGENTS.md to agent-skill-registry', () => {
  expect(classifyGlobalExclusiveResource('AGENTS.md')).toBe('agent-skill-registry');
  expect(classifyGlobalExclusiveResource('.agents/skills/test.md')).toBe('agent-skill-registry');
});

test('classifyGlobalExclusiveResource maps .github/workflows/ to workflow-trust-root', () => {
  expect(classifyGlobalExclusiveResource('.github/workflows/ci.yml')).toBe('workflow-trust-root');
});

test('classifyGlobalExclusiveResource returns null for normal paths', () => {
  expect(classifyGlobalExclusiveResource('platform/shared/test.ts')).toBeNull();
  expect(classifyGlobalExclusiveResource('tests/unit/test.test.ts')).toBeNull();
});

// ============================================================
// Pairwise Conflict Resolver tests
// ============================================================

test('legacy V1/V2 inputs return unresolved', () => {
  const left = legacyInput('old-package-v1');
  const right = legacyInput('old-package-v2');
  const result = resolveParallelConflict(left, right);
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toBe('legacy-manifest-missing-parallel-contract');
  expect(result.step).toBe(1);
});

test('legacy + V3 input returns unresolved', () => {
  const left = legacyInput('old-package-v1');
  const rightManifest = parseV3(v3Manifest());
  const right = v3Input(rightManifest);
  const result = resolveParallelConflict(left, right);
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toBe('legacy-manifest-missing-parallel-contract');
});

test('base mismatch without requires returns unresolved', () => {
  const leftManifest = parseV3(v3Manifest({ id: 'pkg-a', base: BASE }));
  const rightManifest = parseV3(v3Manifest({ id: 'pkg-b', base: BASE_B }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toBe('base-mismatch');
  expect(result.step).toBe(1);
});

test('base mismatch with requires returns ordered', () => {
  const leftManifest = parseV3(v3Manifest({ id: 'pkg-a', base: BASE }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    base: BASE_B,
    requires: ['pkg-a'],
    policyId: 'test-policy-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b']
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('ordered');
  expect(result.reason).toBe('base-mismatch');
  expect(result.step).toBe(1);
});

test('disjoint paths same authority returns authority-conflict', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['shared.authority'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['shared.authority'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('authority-conflict');
  expect(result.step).toBe(3);
});

test('both package.json writers returns resource-conflict via global registry', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/', 'package.json'],
    forbidden: ['docs/work/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/', 'bun.lock'],
    forbidden: ['docs/work/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('resource-conflict');
  expect(result.reason).toContain('global-exclusive-resource-class');
  expect(result.reason).toContain('package-lock');
  expect(result.step).toBe(5);
});

test('producer consumer without requires returns unresolved', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['shared.resource'],
    authorityReads: [],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    authorityReads: ['shared.resource'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toContain('producer/consumer');
  expect(result.step).toBe(3);
});

test('read-only same shared resource is parallel-safe', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    sharedReadOnly: ['compiler-dependency-cache'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    sharedReadOnly: ['compiler-dependency-cache'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('parallel-safe');
});

test('different exclusive resources conflict', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    exclusive: ['resource-registry-a'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    exclusive: ['resource-registry-a'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('resource-conflict');
  expect(result.step).toBe(4);
});

test('path overlap returns write-conflict', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/', 'platform/shared/shared.ts'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/shared.ts'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('write-conflict');
  expect(result.step).toBe(2);
});

test('Windows case collision in paths returns write-conflict', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['Platform/Shared/Test-A/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('write-conflict');
  expect(result.step).toBe(2);
});

test('shared verification policy returns unresolved', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'same-policy'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'same-policy'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toBe('shared-verification-policy');
  expect(result.step).toBe(7);
});

test('fully disjoint packages return parallel-safe', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a',
    forbidden: ['package.json', 'bun.lock']
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b',
    forbidden: ['package.json', 'bun.lock']
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('parallel-safe');
  expect(result.step).toBe(7);
});

test('authority semantic overlap without exact match returns authority-conflict', () => {
  const leftManifest = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['verification.result'],
    policyId: 'policy-a'
  }));
  const rightManifest = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['verification.result.truth'],
    policyId: 'policy-b'
  }));
  const result = resolveParallelConflict(v3Input(leftManifest), v3Input(rightManifest));
  expect(result.classification).toBe('authority-conflict');
  expect(result.step).toBe(6);
});

test('three packages pairwise: A||B safe, A||C safe, but B||C conflict', () => {
  const manifestA = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  const manifestB = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const manifestC = parseV3(v3Manifest({
    id: 'pkg-c',
    owned: ['platform/shared/test-b/sub.ts'],
    authorityWrites: ['test.authority.c'],
    policyId: 'policy-c'
  }));
  const ab = resolveParallelConflict(v3Input(manifestA), v3Input(manifestB));
  const ac = resolveParallelConflict(v3Input(manifestA), v3Input(manifestC));
  const bc = resolveParallelConflict(v3Input(manifestB), v3Input(manifestC));
  expect(ab.classification).toBe('parallel-safe');
  expect(ac.classification).toBe('parallel-safe');
  expect(bc.classification).toBe('write-conflict');
});

test('merge first then recompute second shows base shift', () => {
  // Before merge: both on same base
  const manifestA = parseV3(v3Manifest({
    id: 'pkg-a',
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  const manifestB = parseV3(v3Manifest({
    id: 'pkg-b',
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const beforeMerge = resolveParallelConflict(v3Input(manifestA), v3Input(manifestB));
  expect(beforeMerge.classification).toBe('parallel-safe');

  // After A merges: B's base is now stale (different from new main)
  const manifestBStale = parseV3(v3Manifest({
    id: 'pkg-b',
    base: BASE_B,
    owned: ['platform/shared/test-b/'],
    authorityWrites: ['test.authority.b'],
    policyId: 'policy-b'
  }));
  const manifestAUpdated = parseV3(v3Manifest({
    id: 'pkg-a',
    base: BASE_B,
    owned: ['platform/shared/test-a/'],
    authorityWrites: ['test.authority.a'],
    policyId: 'policy-a'
  }));
  // Simulate A merged, B rebased to new main
  const afterMerge = resolveParallelConflict(v3Input(manifestAUpdated), v3Input(manifestBStale));
  expect(afterMerge.classification).toBe('parallel-safe');
});

test('cancelled/superseded package does not affect active packages', () => {
  // A superseded package (legacy input) should not block V3 packages
  const cancelled = legacyInput('cancelled-package-v1');
  const activeManifest = parseV3(v3Manifest({
    id: 'pkg-active',
    owned: ['platform/shared/test-active/'],
    authorityWrites: ['test.authority.active'],
    policyId: 'policy-active'
  }));
  const result = resolveParallelConflict(cancelled, v3Input(activeManifest));
  expect(result.classification).toBe('unresolved');
  expect(result.reason).toBe('legacy-manifest-missing-parallel-contract');
});
