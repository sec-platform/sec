import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  DOCS_DOCTOR_REQUIRED_CANONICAL_PATHS,
  scanDocumentation,
  type DocsDoctorResult
} from '../../docs/scripts/docs-doctor.ts';
import {
  CodexDevelopmentGitBlobSha256
} from '../../scripts/codex/document-control-plane-contract.ts';

const ACTIVE_PACKAGE_ID = 'fixture-active-v1';
const ACTIVE_MANIFEST = `docs/work-packages/${ACTIVE_PACKAGE_ID}.md`;
const EXPECTED_CANONICAL_OWNER_PATHS = [
  '00-文档索引与一致性规则.md',
  '01-用户能力模块化开发-主题整理稿.md',
  '02-工程编译器-MVP-PRD与架构稿.md',
  '03-MVP实施计划与路线图.md',
  '04-AI自主实现执行蓝图.md',
  '05-编译器核心实现规格.md',
  '06-Registry与Block协议规范.md',
  '07-Pass状态机、错误码与恢复机制.md',
  '08-Verification、Provenance与Graph规范.md',
  '09-AI Runtime、任务信封与治理规范.md',
  '10-升级迁移与Override规范.md',
  '11-Workbench与可视化规范.md',
  '12-编译管道与行为流图示.md',
  '13-独立工具分发与打包规划.md',
  '14-Engineering IR与语义事实规范.md',
  'goals/SEC-Engineering-Workspace-Compiler.md',
  'architecture/sec-ts-ir-layers.md',
  'architecture/engineering-workspace-ir.md',
  'architecture/brownfield-import.md',
  'governance/external-capability-and-provider-policy.md',
  'governance/external-capability-ledger.yaml',
  'governance/nexus-absorption-and-conformance.md',
  'governance/nexus-absorption-ledger.yaml',
  'governance/nexus-absorption-report.md',
  'work/current-state.yaml',
  'work/rolling-plan.md',
  'work/active-work-package.md',
  'work/README.md',
  'test-architecture.md',
  'test-feedback-and-ci-lanes.md',
  'slow-suite-registry.md'
] as const;

interface DocumentationFixture {
  dispose: () => Promise<void>;
  docsRoot: string;
  repositoryRoot: string;
  scan: () => Promise<DocsDoctorResult>;
  writeDoc: (relativePath: string, content: string) => Promise<void>;
}

function authorityDocument(relativePath: string): string {
  const title = `Fixture ${relativePath.replace(/[^A-Za-z0-9]+/gu, ' ').trim()}`;
  return `---
title: ${title}
status: stable
last-reviewed: 2026-07-24
---

# ${title}

Canonical fixture authority.
`;
}

function rollingPlan(candidateCount = 2): string {
  const candidates = Array.from({ length: candidateCount }, (_, index) => `
### ${index + 1}. fixture-candidate-${index + 1}-v1

- 依赖：前一包完成后重算。
`).join('');
  return `---
title: Fixture rolling plan
status: active
last-reviewed: 2026-07-24
---

# Fixture rolling plan

## 当前唯一 Work Package

### ${ACTIVE_PACKAGE_ID}

- 结果：scanner fixture。

## 候选 Work Package
${candidates}
## Gate、单写者与重算

- A0 owns the fixture gate.
`;
}

async function createFixture(): Promise<DocumentationFixture> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-docs-doctor-'));
  const docsRoot = path.join(repositoryRoot, 'docs');
  const manifestBytes = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${ACTIVE_PACKAGE_ID}
tracking: issue-132
base: "${'1'.repeat(40)}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v15
tasks:
  - id: fixture-task
    owner: a0
    ownedPaths:
      - ${ACTIVE_MANIFEST}
      - docs/evidence/future-output.json
forbiddenPaths:
  - platform/compiler/
acceptance:
  - "Declared future output remains semantic: \`docs/evidence/future-output.json\`."
tests:
  - "bun run docs:doctor"
---

# ${ACTIVE_PACKAGE_ID}
`, 'utf8');

  const writeDoc = async (relativePath: string, content: string): Promise<void> => {
    const file = path.join(docsRoot, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  };

  for (const relativePath of DOCS_DOCTOR_REQUIRED_CANONICAL_PATHS) {
    if (
      relativePath === 'work/current-state.yaml'
      || relativePath === 'work/rolling-plan.md'
      || relativePath === 'work/active-work-package.md'
    ) continue;
    await writeDoc(
      relativePath,
      relativePath.endsWith('.md')
        ? authorityDocument(relativePath)
        : `schema: fixture-${path.basename(relativePath, path.extname(relativePath))}\n`
    );
  }
  await writeDoc('work/current-state.yaml', `schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
  await writeDoc('work/rolling-plan.md', rollingPlan());
  await writeDoc('work/active-work-package.md', `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---

# Fixture active Work Package

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${ACTIVE_MANIFEST}
manifestDigest: ${CodexDevelopmentGitBlobSha256(manifestBytes)}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`);
  const manifestFile = path.join(repositoryRoot, ACTIVE_MANIFEST);
  await mkdir(path.dirname(manifestFile), { recursive: true });
  await writeFile(manifestFile, manifestBytes);

  return {
    dispose: () => rm(repositoryRoot, { recursive: true, force: true }),
    docsRoot,
    repositoryRoot,
    scan: () => scanDocumentation({
      docsRoot,
      repositoryRoot,
      readCandidateManifestBlob: async (manifestPath) => readFile(
        path.join(repositoryRoot, manifestPath)
      )
    }),
    writeDoc
  };
}

test('positive fixture satisfies legacy, V5, Unicode, and control-plane policy', async () => {
  const fixture = await createFixture();
  try {
    await fixture.writeDoc(
      '01-用户能力模块化开发-主题整理稿.md',
      `${authorityDocument('fence-aware')}

\`\`\`markdown
# Fenced example is not an owner heading
\`\`\`
`
    );
    expect(await fixture.scan()).toMatchObject({ errors: [], warnings: [] });
  } finally {
    await fixture.dispose();
  }
});

test('required-owner projection independently matches the docs/00 authority table', async () => {
  expect(DOCS_DOCTOR_REQUIRED_CANONICAL_PATHS).toEqual(EXPECTED_CANONICAL_OWNER_PATHS);
  const authorityIndex = await readFile('docs/00-文档索引与一致性规则.md', 'utf8');
  for (const owner of EXPECTED_CANONICAL_OWNER_PATHS) {
    const numbered = owner.match(/^(\d{2})-/u);
    const tableIdentity = numbered ? numbered[1]! : owner;
    expect(authorityIndex).toContain(`| \`${tableIdentity}\` |`);
  }
});

test('current state retains reusable runtime and trusted-ingress capability prerequisites', async () => {
  const source = await readFile('docs/work/current-state.yaml', 'utf8');
  const currentState = parseYaml(source) as {
    stableFacts?: { completedCapabilities?: unknown[] };
  };

  expect(currentState.stableFacts?.completedCapabilities).toEqual(expect.arrayContaining([
    'semantic-mutation-runtime-canonical-authority',
    'semantic-mutation-sm4a-trusted-authorization-ingress'
  ]));
  expect(source).not.toContain('runtimeReconciliation:');
  expect(source).not.toContain('sm4aReconciliation:');
  expect(source).not.toContain('frozenFailedCandidate:');
  expect(source).not.toContain('failedSuccessorCandidates:');
});

test('canonical workflow keeps stable protocol in docs and executable detail in Skills', async () => {
  const [
    agents,
    blueprint,
    feedback,
    testArchitecture,
    workerSkill,
    failureSkill,
    ciSkill,
    auditSkill,
    heuristicSkill,
    architectureSkill
  ] = await Promise.all([
    readFile('AGENTS.md', 'utf8'),
    readFile('docs/04-AI自主实现执行蓝图.md', 'utf8'),
    readFile('docs/test-feedback-and-ci-lanes.md', 'utf8'),
    readFile('docs/test-architecture.md', 'utf8'),
    readFile('.agents/skills/sec-worker-development/SKILL.md', 'utf8'),
    readFile('.agents/skills/sec-failure-recovery/SKILL.md', 'utf8'),
    readFile('.agents/skills/sec-ci-and-merge/SKILL.md', 'utf8'),
    readFile('.agents/skills/sec-repository-audit/SKILL.md', 'utf8'),
    readFile('.agents/skills/sec-heuristic-governance/SKILL.md', 'utf8'),
    readFile('.agents/skills/sec-architecture-evolution/SKILL.md', 'utf8')
  ]);

  for (const fragment of [
    '单一纵向切片默认不创建子 Agent',
    '完全重复工具调用 `0`',
    'Agent wait timeout `0`',
    '产品实现占主动工作时间至少 `70%`',
    '正常交付不本地运行Risk后再重复hosted Risk'
  ]) {
    expect(agents).toContain(fragment);
  }
  expect(agents).not.toContain('detect_changes');

  for (const fragment of [
    '具体 trigger、exclusion、permissions、execution',
    '`sec-repository-audit`',
    '`sec-heuristic-governance`',
    '`sec-architecture-evolution`',
    '本文件不复制具体 repository dispatch payload'
  ]) {
    expect(blueprint).toContain(fragment);
  }
  for (const removedDuplicate of [
    '### 1.4 开发吞吐硬指标',
    '### 3.1 开发环节取舍',
    '### 3.2 最短且完整的十步交付'
  ]) {
    expect(blueprint).not.toContain(removedDuplicate);
  }

  expect(workerSkill).toContain('bun run check:affected --plan');
  expect(workerSkill).toContain('bun run check:affected');
  expect(failureSkill).toContain('STOP_PROOF_RESET');
  expect(ciSkill).toContain('merge后读取新 main tree');
  expect(auditSkill).toContain('全部 tracked paths');
  expect(heuristicSkill).toContain('唯一 Skill owner');
  expect(architectureSkill).toContain('authority first');

  for (const fragment of [
    '### 3.1 按变更类型选择最小验证',
    '| 纯文档 |',
    '| Leaf TypeScript |',
    '| 公共合同、IR、selector |',
    '| Runtime、browser、platform |',
    '| Verifier trust root |',
    '| Release或广泛schema/IR变化 |',
    '正常产品交付不执行“local Risk + hosted Risk”双份证明',
    'Contract Freeze 绑定公共合同与其快速owner tests'
  ]) {
    expect(feedback).toContain(fragment);
  }

  expect(testArchitecture).toContain('### 2.1 秒级反馈预算');
  expect(testArchitecture).toContain('Contract Freeze不启动Next、production server或Playwright');
});

test('legacy file URI, repository path, and deprecated-token diagnostics remain active', async () => {
  const fixture = await createFixture();
  try {
    await fixture.writeDoc('01-用户能力模块化开发-主题整理稿.md', `${authorityDocument('legacy')}

\`docs/missing-owner.md\`
file:///Z:/definitely/missing/sec-document.md
CompilerPass
`);
    const result = await fixture.scan();
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'broken-file-uri',
      'deprecated-token',
      'unresolved-inline-path'
    ]));
  } finally {
    await fixture.dispose();
  }
});

test('canonical owners, frontmatter, H1, retired V4, and Unicode fail closed', async () => {
  const fixture = await createFixture();
  try {
    await unlink(path.join(fixture.docsRoot, '14-Engineering IR与语义事实规范.md'));
    await fixture.writeDoc('01-用户能力模块化开发-主题整理稿.md', `---
title: Duplicate
status: active
last-reviewed: 2026-07-24
---

# Duplicate
# Duplicate

docs/goals/sec_document_system_v4/README.md
\`docs/cafe\u0301.md\`
\uFFFD
`);
    await fixture.writeDoc('02-工程编译器-MVP-PRD与架构稿.md', '# Missing frontmatter\n');
    await fixture.writeDoc(
      'goals/sec_document_system_v4/README.md',
      authorityDocument('retired-v4')
    );
    const result = await fixture.scan();
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'canonical-owner-missing',
      'frontmatter-invalid',
      'h1-count',
      'noncanonical-inline-path',
      'retired-authority-present',
      'retired-authority-reference',
      'unicode-replacement-character'
    ]));
  } finally {
    await fixture.dispose();
  }
});

test('frozen Work Package code spans allow historical and future outputs but links stay checked', async () => {
  const fixture = await createFixture();
  try {
    await fixture.writeDoc('work-packages/history-v1.md', `---
schema: codex-development-work-package-v1
id: history-v1
manifestState: frozen
---

# Historical fixture

\`next/package.json\`
\`official-registry/registry.yaml\`
\`docs/evidence/future-output.json\`
\`docs/work-packages/_template.md\`

[broken owner](../missing-owner.md)
`);
    const result = await fixture.scan();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'unresolved-markdown-link',
      file: 'work-packages/history-v1.md'
    });
  } finally {
    await fixture.dispose();
  }
});

test('reference paths reject traversal, backslash, colon, and empty or dot segments', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.repositoryRoot, 'README.md'), '# root\n', 'utf8');
    await fixture.writeDoc('01-用户能力模块化开发-主题整理稿.md', `${authorityDocument('paths')}

[valid root](../README.md)
[outside](../../outside.md)
\`docs/../README.md\`
\`docs\\invalid.md\`
\`docs/file:stream.md\`
\`docs//empty.md\`
\`docs/./dot.md\`
`);
    const result = await fixture.scan();
    const noncanonical = result.warnings.filter((issue) => (
      issue.code === 'noncanonical-reference' || issue.code === 'noncanonical-inline-path'
    ));
    expect(noncanonical).toHaveLength(6);
    expect(noncanonical.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('outside-repository'),
      expect.stringContaining('docs/../README.md'),
      expect.stringContaining('docs\\invalid.md'),
      expect.stringContaining('docs/file:stream.md'),
      expect.stringContaining('docs//empty.md'),
      expect.stringContaining('docs/./dot.md')
    ]));
  } finally {
    await fixture.dispose();
  }
});

test('historical root documents may cite retired inputs without reviving authority', async () => {
  const fixture = await createFixture();
  try {
    await fixture.writeDoc('historical-reference.md', `---
title: Historical input
status: historical
last-reviewed: 2026-07-24
---

# Historical input

Original input: docs/goals/sec_document_system_v4/README.md
`);
    const result = await fixture.scan();
    expect(result.errors.some((issue) => issue.code === 'retired-authority-reference')).toBe(false);
  } finally {
    await fixture.dispose();
  }
});

test('three control planes reject an unbounded or mismatched rolling selection', async () => {
  const fixture = await createFixture();
  try {
    await fixture.writeDoc('work/rolling-plan.md', rollingPlan(1));
    let result = await fixture.scan();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'control-plane-invalid' }));

    await fixture.writeDoc('work/rolling-plan.md', rollingPlan());
    const pointerPath = path.join(fixture.docsRoot, 'work/active-work-package.md');
    const pointer = await readFile(pointerPath, 'utf8');
    const selector = pointer.match(/```yaml\r?\n[\s\S]*?\r?\n```/u)?.[0];
    expect(selector).toBeDefined();
    await writeFile(
      pointerPath,
      `${pointer}\n${selector!.replace(ACTIVE_MANIFEST, 'docs/work-packages/fixture-competing-v1.md')}\n`,
      'utf8'
    );
    result = await fixture.scan();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'control-plane-invalid' }));

    await writeFile(
      pointerPath,
      pointer.replace('refs/remotes/origin/main', 'refs/remotes/upstream/main'),
      'utf8'
    );
    result = await fixture.scan();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'control-plane-invalid' }));
  } finally {
    await fixture.dispose();
  }
});
