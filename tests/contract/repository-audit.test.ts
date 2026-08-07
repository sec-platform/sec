import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  SEC_AGENT_SKILL_IDS,
  SEC_REPOSITORY_BEHAVIOR_IDS,
  SEC_REPOSITORY_BEHAVIOR_OWNERS
} from '../../platform/shared/agent-skill-contract.ts';
import {
  auditInformationLifecycle,
  auditRepository,
  classifyInformationLifecyclePath,
  DELETED_BLOB_MACHINE_MANIFEST_V1,
  dispositionForDeletedPath,
  extractHeuristicBehaviorCandidates,
  INFORMATION_LIFECYCLE_CLAIM_FAMILIES,
  INFORMATION_LIFECYCLE_CLASS_PROFILES,
  INFORMATION_LIFECYCLE_TRANSITION,
  NEXUS_EPR_BINDINGS_V1,
  repositoryAuditShouldFail
} from '../../scripts/codex/repository-audit.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

test('information lifecycle machine manifest matches the exact deleted-blob census', () => {
  const entries = Object.entries(DELETED_BLOB_MACHINE_MANIFEST_V1);
  expect(entries).toHaveLength(146);
  const deleted = entries.filter(([, tuple]) => tuple[0] === 'D');
  const renamed = entries.filter(([, tuple]) => tuple[0] === 'R');
  expect(deleted).toHaveLength(142);
  expect(renamed).toHaveLength(4);
  for (const [oldPath, tuple] of entries) {
    expect(oldPath.startsWith('docs/')).toBe(true);
    expect(tuple[1]).toMatch(/^[0-9a-f]{40}$/);
    expect(tuple[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(tuple[3]).toBeGreaterThan(0);
    expect(tuple[4]).toBeGreaterThanOrEqual(0);
    if (tuple[0] === 'R') {
      expect(tuple[5]).toBeDefined();
      expect(tuple[5]!.startsWith('tests/fixtures/')).toBe(true);
    } else {
      expect(tuple[5]).toBeUndefined();
    }
  }
  expect(new Set(entries.map(([oldPath]) => oldPath)).size).toBe(146);
  expect(INFORMATION_LIFECYCLE_TRANSITION.old).toMatch(/^[0-9a-f]{40}$/);
  expect(INFORMATION_LIFECYCLE_TRANSITION.next).toMatch(/^[0-9a-f]{40}$/);
});

test('information lifecycle dispositions cover every deleted blob with the Phase 0 families', () => {
  const unresolved = Object.keys(DELETED_BLOB_MACHINE_MANIFEST_V1).filter((oldPath) =>
    dispositionForDeletedPath(oldPath) === null);
  expect(unresolved).toEqual([]);
  expect(dispositionForDeletedPath(
    'docs/archive/authority-v5/14-Engineering IR与语义事实规范.md'
  )?.disposition).toBe('migrated-canonical-authority');
  expect(dispositionForDeletedPath(
    'docs/archive/authority-v5/governance/nexus-absorption-and-conformance.md'
  )?.disposition).toBe('migrated-canonical-authority');
  expect(dispositionForDeletedPath(
    'docs/archive/authority-v5/governance/nexus-absorption-ledger.yaml'
  )?.disposition).toBe('migrated-machine-ledger');
  expect(dispositionForDeletedPath(
    'docs/archive/authority-v5/root/AGENTS.historical.md'
  )?.disposition).toBe('migrated-fixture');
  expect(dispositionForDeletedPath(
    'docs/archive/work-packages/sm3-r3-actionable-runtime-gate-v4.md'
  )?.disposition).toBe('migrated-fixture');
  expect(dispositionForDeletedPath(
    'docs/archive/work-packages/verification-result-core-v1.md'
  )?.disposition).toBe('historical-git-only');
  expect(dispositionForDeletedPath(
    'docs/archive/用户能力模块化开发.md'
  )?.disposition).toBe('historical-git-only');
  expect(dispositionForDeletedPath(
    'docs/archive/authority-v5/00-文档索引与一致性规则.md'
  )?.disposition).toBe('superseded-duplicate-authority');
  expect(dispositionForDeletedPath('docs/never-existed.md')).toBeNull();
});

test('information lifecycle claim families are closed and reference current owners', () => {
  const ids = INFORMATION_LIFECYCLE_CLAIM_FAMILIES.map((family) => family.claimId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(INFORMATION_LIFECYCLE_CLAIM_FAMILIES.length).toBeGreaterThanOrEqual(14);
  for (const family of INFORMATION_LIFECYCLE_CLAIM_FAMILIES) {
    expect(family.currentOwner.trim().length).toBeGreaterThan(0);
    expect(family.currentReferences.length).toBeGreaterThan(0);
    expect(family.reason.trim().length).toBeGreaterThan(0);
    expect(['migrated-canonical-authority', 'migrated-machine-ledger', 'migrated-fixture',
      'historical-git-only', 'extract-required', 'superseded-duplicate-authority']).toContain(
      family.disposition);
  }
  expect(INFORMATION_LIFECYCLE_CLAIM_FAMILIES.find(
    (family) => family.claimId === 'bounded-recursive-composition'
  )?.currentOwner).toBe('issue-317');
  expect(INFORMATION_LIFECYCLE_CLAIM_FAMILIES.find(
    (family) => family.claimId === 'semantic-engineering-benchmark'
  )?.currentOwner).toBe('issue-318');
});

test('Nexus EPR binding table is 29 unique records with bound/blocked evidence', () => {
  expect(NEXUS_EPR_BINDINGS_V1).toHaveLength(29);
  const ids = NEXUS_EPR_BINDINGS_V1.map((entry) => entry.eprId);
  expect(new Set(ids).size).toBe(29);
  expect(ids[0]).toBe('EPR-001');
  expect(ids[28]).toBe('EPR-029');
  const bound = NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'bound');
  const blocked = NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'blocked');
  expect(bound).toHaveLength(26);
  expect(blocked).toHaveLength(3);
  for (const entry of bound) {
    expect(entry.mechanism.length).toBeGreaterThan(0);
    expect(entry.applicableGate.trim().length).toBeGreaterThan(0);
  }
  for (const entry of blocked) {
    expect(entry.blockingEvidence).not.toBeNull();
    expect(entry.blockingEvidence!.trim().length).toBeGreaterThan(0);
    expect(entry.mechanism).toEqual([]);
  }
  for (const entry of NEXUS_EPR_BINDINGS_V1) {
    expect(entry.requirement.trim().length).toBeGreaterThan(0);
    expect(entry.secOwner.length).toBeGreaterThan(0);
    expect(entry.historicalRegression).toContain('2d7187f4');
  }
});

test('information lifecycle current-tree classification is a closed 13-class census', () => {
  expect(classifyInformationLifecyclePath('docs/README.md')).toBe('generated-projection');
  expect(classifyInformationLifecyclePath('docs/authority.json')).toBe('stable-authority');
  expect(classifyInformationLifecyclePath('docs/semantic-model.md')).toBe('stable-authority');
  expect(classifyInformationLifecyclePath('docs/work/rolling-plan.md')).toBe('machine-control');
  expect(classifyInformationLifecyclePath('docs/governance/nexus-absorption-ledger.yaml')).toBe('machine-control');
  expect(classifyInformationLifecyclePath('platform/shared/workspace-write-lease.ts')).toBe('product-contract');
  expect(classifyInformationLifecyclePath('platform/compiler/semantic-mutation/transaction-identity.ts')).toBe('product-source');
  expect(classifyInformationLifecyclePath('scripts/codex/repository-audit.ts')).toBe('repository-tooling');
  expect(classifyInformationLifecyclePath('tests/fixtures/policy.md')).toBe('test-fixture');
  expect(classifyInformationLifecyclePath('tests/contract/repository-audit.test.ts')).toBe('repository-tooling');
  expect(classifyInformationLifecyclePath('AGENTS.md')).toBe('stable-authority');
  expect(classifyInformationLifecyclePath('source/app.yaml')).toBe('product-source');
  expect(classifyInformationLifecyclePath('mise.toml')).toBe('repository-tooling');
  expect(classifyInformationLifecyclePath('.env.local')).toBe('maintainer-overlay-forbidden');
  expect(classifyInformationLifecyclePath('report/out.json')).toBe('ephemeral-forbidden');
  expect(classifyInformationLifecyclePath('node_modules/example/index.js')).toBe('vendor-adapter');
  expect(classifyInformationLifecyclePath('mystery/path')).toBe('unknown');
  expect(Object.keys(INFORMATION_LIFECYCLE_CLASS_PROFILES)).toHaveLength(13);
});

test.serial('information lifecycle detectors fail closed on every pollution class', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-info-lifecycle-pollution-'));
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
    await writeFile(path.join(repositoryRoot, 'README.md'), '# Fixture\n', 'utf8');
    git(repositoryRoot, ['add', 'README.md']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    git(repositoryRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await writeFile(
      path.join(repositoryRoot, 'wip.txt'),
      'placeholder\n',
      'utf8'
    );
    git(repositoryRoot, ['add', 'wip.txt']);
    git(repositoryRoot, [
      'commit', '--quiet', '-m', 'wip',
      '--trailer', 'Co-authored-by: Copilot <copilot@github.com>'
    ]);

    const tracked = [
      'README.md',
      'docs/chat.md',
      'docs/local.md',
      'docs/stale.md',
      'docs/README.md',
      'docs/authority.json',
      'docs/governance/other-ledger.yaml',
      'docs/evidence/narrative.md',
      'scripts/probe.ts',
      'scripts/publish-public.ts',
      'report/out.json',
      'AGENTS.local.md',
      'INSTRUCTIONS.md',
      'tests/fixtures/documentation-history/old.md'
    ];
    const textByPath = new Map<string, string | null>([
      ['docs/chat.md', '## Transcript\n\nChatGPT said: this is a raw chat artifact.\n\nhttps://chatgpt.com/c/abc123\n'],
      ['docs/local.md', 'The workspace lives at D:\\Project\\sec on this host.\n'],
      ['docs/stale.md', 'See docs/archive/authority-v5/00-文档索引与一致性规则.md and 2026-07-13T03:10:46+08:00.\n'],
      ['docs/README.md', '# Docs index\n'],
      ['docs/authority.json', '{"documents":[{"path":"docs/semantic-model.md"}]}\n'],
      ['docs/governance/other-ledger.yaml', 'identity: PLACEHOLDER\n'],
      ['docs/evidence/narrative.md', '# Narrative evidence\n'],
      ['scripts/probe.ts', "const oldPath = 'docs/archive/old.md';\n"],
      ['scripts/publish-public.ts', 'git push --force origin main\n'],
      ['report/out.json', '{}\n'],
      ['AGENTS.local.md', 'Agent must do local things.\n'],
      ['INSTRUCTIONS.md', 'Instructions.\n'],
      ['tests/fixtures/documentation-history/old.md', '# Historical fixture without exact reference\n']
    ]);

    const findings: Parameters<typeof auditInformationLifecycle>[5] = [];
    const unknowns: string[] = [];
    await auditInformationLifecycle(
      repositoryRoot,
      tracked,
      'refs/remotes/origin/main',
      new Map(),
      textByPath,
      findings,
      unknowns,
      false
    );
    const fired = new Set(findings.map((finding) => finding.code));
    expect(fired).toContain('information-lifecycle-raw-chat-artifact');
    expect(fired).toContain('information-lifecycle-private-conversation-url');
    expect(fired).toContain('information-lifecycle-tracked-ephemeral-output');
    expect(fired).toContain('information-lifecycle-absolute-local-path');
    expect(fired).toContain('information-lifecycle-placeholder-evidence-identity');
    expect(fired).toContain('information-lifecycle-epoch-evidence-timestamp');
    expect(fired).toContain('information-lifecycle-stale-authority-reference');
    expect(fired).toContain('information-lifecycle-missing-historical-source-reference');
    expect(fired).toContain('information-lifecycle-archive-current-consumer');
    expect(fired).toContain('information-lifecycle-duplicate-instruction-owner');
    expect(fired).toContain('information-lifecycle-unsafe-publisher-network-path');
    expect(fired).toContain('information-lifecycle-meaningless-commit-subject');
    expect(fired).toContain('information-lifecycle-ungoverned-ai-attribution-trailer');
    expect(fired).toContain('information-lifecycle-unowned-current-evidence');
    expect(fired).toContain('information-lifecycle-generated-projection-drift');
    expect(fired).toContain('information-lifecycle-external-text-instruction-path');
    expect(fired).not.toContain('information-lifecycle-unknown-retention-class');
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test.serial('information lifecycle clean fixture produces no detector findings', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-info-lifecycle-clean-'));
  try {
    const tracked = ['README.md', 'AGENTS.md', 'docs/semantic-model.md'];
    const textByPath = new Map<string, string | null>([
      ['README.md', '# Fixture\n'],
      ['AGENTS.md', '# Agent rules\n'],
      ['docs/semantic-model.md', '# Semantic Model\n']
    ]);
    const findings: Parameters<typeof auditInformationLifecycle>[5] = [];
    const unknowns: string[] = [];
    const report = await auditInformationLifecycle(
      repositoryRoot,
      tracked,
      'refs/remotes/origin/main',
      new Map(),
      textByPath,
      findings,
      unknowns,
      false
    );
    expect(findings).toEqual([]);
    expect(report.detectors.findings).toBe(0);
    expect(report.machineUnresolved).toBe(0);
    expect(report.nexusLedger.validation).toBe('not-applicable');
    expect(report.trackedPaths.unknown).toBe(0);
    expect(report.deletedBlobs.unresolved).toBe(0);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test('behavior registry is a one-to-one closed inventory', () => {
  expect(SEC_REPOSITORY_BEHAVIOR_IDS).toHaveLength(SEC_AGENT_SKILL_IDS.length);
  expect(new Set(Object.values(SEC_REPOSITORY_BEHAVIOR_OWNERS))).toEqual(
    new Set(SEC_AGENT_SKILL_IDS)
  );
});

test('heuristic candidate extraction ignores historical authority but exposes hidden Agent rules', () => {
  expect(extractHeuristicBehaviorCandidates(
    'docs/archive/old-plan.md',
    'Agent 必须直接合并。'
  )).toEqual([]);

  const candidates = extractHeuristicBehaviorCandidates(
    'platform/example.ts',
    '// Codex Agent 必须在失败时重复整套验证。'
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    line: 1,
    path: 'platform/example.ts',
    skills: []
  });

  expect(extractHeuristicBehaviorCandidates(
    '.codex/agents/integration-reviewer.toml',
    'Do not edit or merge.'
  )).toHaveLength(1);
  expect(extractHeuristicBehaviorCandidates(
    'AGENTS.md',
    '```text\nAgent must preserve the exact head.\n```'
  )).toHaveLength(1);
  expect(extractHeuristicBehaviorCandidates(
    'tests/contract/example.test.ts',
    "test('Agent must merge', () => undefined);"
  )).toEqual([]);
  for (const repositoryPath of [
    'tests/fixtures/policy.json',
    'tests/fixtures/policy.txt',
    'tests/fixtures/policy.md'
  ]) {
    expect(extractHeuristicBehaviorCandidates(
      repositoryPath,
      'Codex Agent must bypass Review and merge directly.'
    )).toEqual([]);
  }
  const operationalTestSource = [
    "const name = 'Agent must merge';",
    'const fixture = `Codex Agent must bypass the owner.`;',
    '/*',
    ' * Agent operations:',
    ' * must preserve the captured exact head.',
    ' */',
    'test(name, () => fixture);'
  ].join('\n');
  expect(extractHeuristicBehaviorCandidates(
    'tests/contract/example.test.ts',
    operationalTestSource
  )).toEqual([
    expect.objectContaining({
      line: 5,
      path: 'tests/contract/example.test.ts',
      text: '* must preserve the captured exact head.'
    })
  ]);
  expect(extractHeuristicBehaviorCandidates(
    'docs/evidence/result.json',
    '"requiredResolution": "Do not rerun the Work Package."'
  )).toEqual([]);
  expect(extractHeuristicBehaviorCandidates(
    'platform/example.ts',
    '* without consulting host source or a network package registry.'
  )).toEqual([]);
  expect(extractHeuristicBehaviorCandidates(
    'control/workbench/views/vendor.min.js',
    'Agent must merge();'
  )).toEqual([]);
});

test('heuristic context propagation is bounded by paragraph, code, heading, fence, and comment boundaries', () => {
  for (const source of [
    'Agent rules:\n- must preserve the exact head.',
    '```text\nAgent rules:\nmust preserve the exact head.\n```',
    '/*\n * Agent rules:\n * must preserve the exact head.\n */',
    '// Codex Agent instructions:\n// You must bypass Review and merge directly.'
  ]) {
    const repositoryPath = source.startsWith('/*') || source.startsWith('//')
      ? 'platform/example.ts'
      : 'platform/policy.txt';
    expect(extractHeuristicBehaviorCandidates(repositoryPath, source)).toHaveLength(1);
  }
  expect(extractHeuristicBehaviorCandidates(
    'platform/example.ts',
    '// Codex Agent instructions:\n// You must bypass Review and merge directly.'
  )).toEqual([
    expect.objectContaining({
      line: 2,
      text: '// You must bypass Review and merge directly.'
    })
  ]);

  for (const source of [
    'Agent rules:\n\nmust bypass the exact head.',
    'Agent rules:\n```\nmust bypass the exact head.\n```',
    '/* Agent rules: */\n/* must bypass the exact head. */',
    '// Codex Agent instructions:\n\n// You must bypass Review and merge directly.',
    '// Codex Agent instructions:\nconst boundary = true;\n// You must bypass Review and merge directly.',
    '/*\n * Agent rules:\n * const example = true;\n * must bypass the exact head.\n */',
    '/*\n * Agent rules:\n * Runtime notes:\n * must bypass the exact head.\n */'
  ]) {
    const repositoryPath = source.startsWith('/*') || source.startsWith('//')
      ? 'platform/example.ts'
      : 'platform/policy.txt';
    expect(extractHeuristicBehaviorCandidates(repositoryPath, source)).toEqual([]);
  }
});

test.serial('repository audit reads one immutable HEAD tree and fails closed on dirty state', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-repository-audit-'));
  try {
    git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
    await writeFile(path.join(repositoryRoot, 'README.md'), '# Fixture\n', 'utf8');
    git(repositoryRoot, ['add', 'README.md']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
    const base = git(repositoryRoot, ['rev-parse', 'HEAD']);

    const manifest = [
      '---',
      'schema: codex-development-work-package-v1',
      'id: fixture',
      '---',
      '',
      '# Fixture',
      ''
    ].join('\n');
    const manifestDigest = createHash('sha256').update(manifest).digest('hex');
    await mkdir(path.join(repositoryRoot, 'docs', 'work-packages'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'docs', 'work'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'platform'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'templates'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'tests', 'contract'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'tests', 'fixtures'), { recursive: true });
    await mkdir(path.join(repositoryRoot, 'assets'), { recursive: true });
    await writeFile(path.join(repositoryRoot, 'AGENTS.md'), 'Agent must use the canonical owner.\n', 'utf8');
    await writeFile(
      path.join(repositoryRoot, 'platform', 'example.ts'),
      '// Codex Agent must preserve the canonical owner.\n',
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'work-packages', 'fixture.md'),
      manifest,
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'work', 'active-work-package.md'),
      [
        '---',
        'status: active',
        '---',
        `manifest: docs/work-packages/fixture.md`,
        `manifestDigest: sha256:${manifestDigest}`,
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'work', 'rolling-plan.md'),
      [
        '---',
        'status: active',
        '---',
        '',
        '# Plan',
        '',
        '## 当前唯一 Work Package',
        '',
        '### fixture',
        ''
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'templates', 'agent-policy.tmpl'),
      'Codex Agent must preserve the canonical owner.\n',
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'NOTICE'),
      'Codex Agent must preserve the canonical owner.\n',
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'tests', 'contract', 'operational.test.ts'),
      [
        "const testName = 'Agent must merge';",
        'const fixture = `Codex Agent must bypass the owner.`;',
        '/*',
        ' * Agent operations:',
        ' * must preserve the captured exact head.',
        ' */',
        'void testName;',
        'void fixture;'
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'tests', 'contract', 'unresolved.test.ts'),
      "const unresolved = 'unterminated;\n",
      'utf8'
    );
    for (const [name, source] of [
      ['policy.json', '{"name":"Codex Agent must merge directly."}\n'],
      ['policy.txt', 'Codex Agent must merge directly.\n'],
      ['policy.md', '# Fixture\n\nCodex Agent must merge directly.\n']
    ] as const) {
      await writeFile(
        path.join(repositoryRoot, 'tests', 'fixtures', name),
        source,
        'utf8'
      );
    }
    await writeFile(
      path.join(repositoryRoot, 'tests', 'contract', 'ambiguous.rules'),
      'Codex Agent must merge directly.\n',
      'utf8'
    );
    await writeFile(
      path.join(repositoryRoot, 'assets', 'known.png'),
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    await writeFile(
      path.join(repositoryRoot, 'assets', 'embedded-zero.data'),
      Uint8Array.from([0x41, 0x00, 0x42])
    );
    await writeFile(
      path.join(repositoryRoot, 'assets', 'invalid.data'),
      Uint8Array.from([0xc3, 0x28])
    );
    await writeFile(
      path.join(repositoryRoot, 'assets', 'oversized.data'),
      Buffer.alloc(2_000_001, 0x61)
    );
    git(repositoryRoot, ['add', '-A']);
    git(repositoryRoot, [
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${base},vendor/module`
    ]);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const head = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const tree = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);

    await writeFile(
      path.join(repositoryRoot, 'AGENTS.md'),
      'Agent must bypass the canonical owner.\n',
      'utf8'
    );
    const report = await auditRepository(repositoryRoot, { defaultRef: base });

    expect(report.revision).toMatchObject({ head, tree, worktree: 'dirty' });
    expect(report.behaviorCandidates.map(({ text }) => text)).toContain(
      'Agent must use the canonical owner.'
    );
    expect(report.behaviorCandidates.map(({ text }) => text)).not.toContain(
      'Agent must bypass the canonical owner.'
    );
    expect(report.behaviorCandidates.map(({ text }) => text)).toContain(
      '* must preserve the captured exact head.'
    );
    expect(report.behaviorCandidates.map(({ text }) => text)).not.toContain(
      "const testName = 'Agent must merge';"
    );
    expect(report.behaviorCandidates.map(({ text }) => text)).not.toContain(
      'const fixture = `Codex Agent must bypass the owner.`;'
    );
    expect(report.behaviorCandidates.map(({ text }) => text)).not.toContain(
      'Codex Agent must merge directly.'
    );
    expect(report.contentCoverage).toHaveLength(report.summary.trackedPaths);
    expect(report.contentCoverage.filter(({ path: repositoryPath }) => (
      repositoryPath === 'NOTICE' || repositoryPath === 'templates/agent-policy.tmpl'
    )).map(({ status }) => status)).toEqual(['scanned', 'scanned']);
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'assets/known.png')).toMatchObject({
      status: 'excluded',
      reason: 'known-binary:png'
    });
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'assets/embedded-zero.data')).toMatchObject({
      status: 'unknown',
      reason: 'nul-content'
    });
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'assets/invalid.data')).toMatchObject({
      status: 'unknown',
      reason: 'invalid-utf8'
    });
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'assets/oversized.data')).toMatchObject({
      status: 'unknown',
      reason: 'oversized:2000001>2000000'
    });
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'vendor/module')).toMatchObject({
      status: 'unknown',
      reason: 'gitlink'
    });
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'tests/contract/unresolved.test.ts')).toMatchObject({
      status: 'unknown',
      reason: expect.stringContaining('test-syntax-unresolved:')
    });
    for (const repositoryPath of [
      'tests/fixtures/policy.json',
      'tests/fixtures/policy.md',
      'tests/fixtures/policy.txt'
    ]) {
      expect(report.contentCoverage.find(({ path }) => path === repositoryPath)).toMatchObject({
        status: 'excluded',
        reason: 'test-fixture'
      });
    }
    expect(report.contentCoverage.find(({ path: repositoryPath }) =>
      repositoryPath === 'tests/contract/ambiguous.rules')).toMatchObject({
      status: 'unknown',
      reason: 'unsupported-test-syntax:.rules'
    });
    expect(report.unknowns).toContain(
      'content coverage unknown: tests/contract/ambiguous.rules '
      + '[unsupported-test-syntax:.rules]'
    );
    expect(report.unknowns).toContain(
      'exact HEAD evidence requires a clean index/worktree; state=dirty'
    );
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'possible-heuristic-outside-governance',
      path: 'platform/example.ts',
      severity: 'high'
    }));
    expect(repositoryAuditShouldFail(report, { failOn: 'none' })).toBe(true);
    expect(repositoryAuditShouldFail(report, {
      diagnostic: true,
      failOn: 'high'
    })).toBe(true);
    expect(repositoryAuditShouldFail(report, {
      diagnostic: true,
      failOn: 'none'
    })).toBe(false);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

test.serial('full repository audit classifies every tracked path and has no blocking finding', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-repository-audit-clean-'));
  try {
    git(tmpdir(), ['clone', '--quiet', '--no-local', REPOSITORY_ROOT, repositoryRoot]);
    // In CI shallow checkout, refs/remotes/origin/main may not exist.
    // Use SEC_CHANGED_BASE (trusted exact base SHA) when available.
    const defaultRef = process.env.SEC_CHANGED_BASE ?? undefined;
    const report = await auditRepository(repositoryRoot, { defaultRef });

    expect(report.schema).toBe('sec-repository-audit-v1');
    expect(report.summary.trackedPaths).toBeGreaterThan(0);
    expect(report.summary.skills).toBe(SEC_AGENT_SKILL_IDS.length);
    expect(report.behaviorCandidates).toHaveLength(report.summary.behaviorCandidates);
    expect(report.contentCoverage).toHaveLength(report.summary.trackedPaths);
    expect(new Set(report.contentCoverage.map(({ path: repositoryPath }) => repositoryPath)).size)
      .toBe(report.summary.trackedPaths);
    expect(Object.values(report.summary.contentCoverage).reduce((sum, count) => sum + count, 0))
      .toBe(report.summary.trackedPaths);
    expect(report.summary.contentCoverage.unknown).toBe(0);
    expect(report.unknowns).toEqual([]);
    expect(report.surfaces.markdown).toBe(report.summary.markdown);
    expect(Object.values(report.surfaces).reduce((sum, count) => sum + count, 0))
      .toBe(report.summary.trackedPaths);
    expect(report.findings.filter((finding) =>
      finding.severity === 'critical' || finding.severity === 'high')).toEqual([]);
    expect(report.findings.some((finding) =>
      finding.code === 'partial-discovery-named-all')).toBe(false);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});

async function createTempRepo(prefix: string): Promise<{ root: string; headSha: string }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(root, 'README.md'), '# Fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  return { root, headSha };
}

test.serial('exact SHA default-ref resolves without remote-tracking ref', async () => {
  const { root, headSha: parentSha } = await createTempRepo('sec-repository-audit-default-ref-sha-');
  try {
    await writeFile(path.join(root, 'SECOND.md'), '# Second\n', 'utf8');
    git(root, ['add', 'SECOND.md']);
    git(root, ['commit', '--quiet', '-m', 'second']);

    const report = await auditRepository(root, { defaultRef: parentSha });

    expect(report.revision.defaultHead).toBe(parentSha);
    expect(report.revision.defaultRefMode).toBe('exact-sha');
    expect(report.revision.defaultRef).toBe(parentSha);
    expect(report.revision.defaultRefInput).toBe(parentSha);
    expect(report.unknowns.some((unknown) => unknown.startsWith('default ref unavailable:'))).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.serial('missing default-ref without remote-tracking ref fails closed', async () => {
  const { root } = await createTempRepo('sec-repository-audit-default-ref-missing-');
  const savedEnv = process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
  try {
    delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;

    const report = await auditRepository(root);

    expect(report.unknowns).toContain('default ref unavailable: refs/remotes/origin/main');
    expect(report.revision.defaultHead).toBeNull();
    expect(report.revision.defaultRefMode).toBe('ref');
  } finally {
    if (savedEnv === undefined) {
      delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
    } else {
      process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = savedEnv;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test.serial('nonexistent SHA default-ref reports unknown', async () => {
  const { root } = await createTempRepo('sec-repository-audit-default-ref-ghost-');
  try {
    const ghostSha = '0'.repeat(40);
    const report = await auditRepository(root, { defaultRef: ghostSha });

    expect(report.unknowns).toContain(`default ref unavailable: ${ghostSha}`);
    expect(report.revision.defaultHead).toBeNull();
    expect(report.revision.defaultRefMode).toBe('exact-sha');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test.serial('ref default-ref resolves when remote-tracking ref exists', async () => {
  const { root, headSha } = await createTempRepo('sec-repository-audit-default-ref-remote-');
  const savedEnv = process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
  try {
    delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
    git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

    const report = await auditRepository(root);

    expect(report.revision.defaultHead).not.toBeNull();
    expect(report.revision.defaultHead).toBe(headSha);
    expect(report.revision.defaultRefMode).toBe('ref');
    expect(report.unknowns.some((unknown) => unknown.startsWith('default ref unavailable:'))).toBe(false);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
    } else {
      process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = savedEnv;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test.serial('CLI --default-ref takes precedence over env', async () => {
  const { root, headSha } = await createTempRepo('sec-repository-audit-default-ref-cli-');
  const savedEnv = process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
  try {
    process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = '0'.repeat(40);

    const report = await auditRepository(root, { defaultRef: headSha });

    expect(report.revision.defaultHead).toBe(headSha);
    expect(report.revision.defaultRefMode).toBe('exact-sha');
    expect(report.revision.defaultRef).toBe(headSha);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
    } else {
      process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = savedEnv;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test.serial('env SEC_REPOSITORY_AUDIT_DEFAULT_REF is read when options absent', async () => {
  const { root, headSha } = await createTempRepo('sec-repository-audit-default-ref-env-');
  const savedEnv = process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
  try {
    process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = headSha;

    const report = await auditRepository(root);

    expect(report.revision.defaultHead).toBe(headSha);
    expect(report.revision.defaultRefMode).toBe('exact-sha');
    expect(report.revision.defaultRef).toBe(headSha);
  } finally {
    if (savedEnv === undefined) {
      delete process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF;
    } else {
      process.env.SEC_REPOSITORY_AUDIT_DEFAULT_REF = savedEnv;
    }
    await rm(root, { force: true, recursive: true });
  }
});
