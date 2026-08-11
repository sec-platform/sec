import path from 'node:path';

import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseRollingPlanV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import { NEXUS_EPR_BINDINGS_V1 } from '../../scripts/codex/repository-audit.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

describe('canonical documentation authority', () => {
  test('roadmap owns the stable capability DAG without dynamic project state', async () => {
    const roadmap = await readCompilerFile('docs/roadmap.md');
    const orderedStages = [
      'R0 — Theory / Authority Convergence',
      'R1 — Canonical Engineering Semantic Kernel',
      'R2 — Verification Truth Kernel',
      'R3 — Physical Workspace Observation',
      'R4 — TypeScript Source Program Model',
      'R5 — Responsibility Reconstruction',
      'R6 — Semantic Delta / Impact',
      'R7 — Operation / Authorization / Planning',
      'R8 — Transactional Controlled Mutation',
      'R9 — Brownfield Adoption',
      'R10 — Target Profile / Type Algebra',
      'R11 — Application / Behavior / Target Program Lowering',
      'R12 — General TypeScript Engineering Compiler',
      'R13 — Workbench / AI Semantic Operator',
      'R14 — Agent Operation Compiler / VerificationSession Cutover',
      'R15 — Release / Deployment / Operations',
      'R16 — Registry Ecosystem / Additional Languages'
    ];

    expectContainsAll(roadmap, [
      ...orderedStages,
      '## Workspace Domain 激活规则',
      '## Nexus Conformance 轨道',
      '## Specialized Target / Provider 轨道',
      'W0 inventory',
      'N0 exact repository/artifact census',
      'S0 corpus + architecture only',
      'unclassified = 0',
      'unexplained delta = 0',
      '基础设施饥饿保护',
      'Observation → Responsibility → Impact → Operation → Mutation 不可颠倒',
      'clean/incremental byte-equivalent',
      'unsupported-before-emit',
      'stable Entity / Fact / Assertion identity',
      'deterministic revision',
      '统一 Pipeline Kernel',
      '每层一个producer',
      '无竞争writer',
      'public contract、migration和retirement一致'
    ]);
    for (let index = 1; index < orderedStages.length; index += 1) {
      expect(roadmap.indexOf(orderedStages[index]!)).toBeGreaterThan(
        roadmap.indexOf(orderedStages[index - 1]!)
      );
    }
    expectContainsNone(roadmap, [
      'docs/03-MVP实施计划与路线图.md',
      '当前禁止事项',
      'v0.3 Semantic Core Foundation',
      '1B-4 → #216 → #207'
    ]);
    expect(roadmap).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(roadmap).not.toMatch(/\bPR #\d+\b/u);
  });

  test('development control-plane convergence keeps one run coordinator and separated identities', async () => {
    const [architecture, development, verification, roadmap, proposal] = await Promise.all([
      readCompilerFile('docs/system-architecture.md'),
      readCompilerFile('docs/development-governance.md'),
      readCompilerFile('docs/verification-governance.md'),
      readCompilerFile('docs/roadmap.md'),
      readCompilerFile('docs/proposals/development-run-kernel.md')
    ]);

    expectContainsAll(architecture, [
      'Task Capsule 是独立 pure compiler 的不可变输出',
      'VerificationSession 是唯一 development run coordinator',
      '系统不建立',
      'general Run Kernel',
      'NextTransitionCompiler 只组合各 owner 已签发的 typed decisions',
      'CandidateContentId',
      'CandidateGenerationRef',
      'ReviewSubjectId',
      'PromotionId'
    ]);
    expectContainsAll(development, [
      'Task Capsule 唯一拥有其内容 schema、编译规则和 revision',
      '`sec-task-capsule-v1`',
      '`taskCapsuleRef`、`taskCapsuleDigest`、`taskCapsuleRevision`',
      '`sec-operation-read-plan-v1`',
      'requiredRefs',
      'conditionalRefs',
      'forbiddenSources',
      'maxSkillBodies = 0 | 1',
      'caller-selected comparison pair',
      '永远不签发 effect',
      'Development control-plane 七项终态裁决',
      'SEC_REPOSITORY_BEHAVIOR_ROUTES',
      'FindingSuccessorWorktreeCount = 0',
      'physicalStartsPerActionKey <= 1',
      '不拥有 Task Capsule 内容或 compiler',
      'IssueDisposition',
      'registry absence 与 exact physical target',
      'zero residue',
      'typed blocked receipt'
    ]);
    expectContainsAll(verification, [
      '`CandidateContentId` 绑定',
      '`CandidateGenerationRef` 绑定',
      '`ProspectiveControlProjection`',
      '`ActiveMainControlState`',
      '`ReviewRequestActionKey`',
      '`physicalStartsPerActionKey <= 1`',
      'Tier 0 Transition Root',
      '`PromotionId` 绑定'
    ]);
    expectContainsAll(roadmap, [
      'R14 — Agent Operation Compiler / VerificationSession Cutover',
      '不创建一个只做“最终架构”的umbrella Work Package',
      'Read fast path（#205 → #346）',
      'Guidance convergence（#275）',
      'Candidate / Control transaction',
      'Promotion / retirement'
    ]);
    expectContainsAll(proposal, [
      '新的顶层 durable Run Kernel state machine 被拒绝',
      'Task Capsule',
      'VerificationSession',
      'NextTransitionCompiler',
      'proposal-only'
    ]);
    expectContainsNone(architecture, ['Run Kernel 未实现时']);
  });

  test('rolling plan is relationally bound to the active pointer and keeps the remaining candidates', async () => {
    const [rollingPlanSource, pointerSource] = await Promise.all([
      readCompilerFile('docs/work/rolling-plan.md'),
      readCompilerFile('docs/work/active-work-package.md')
    ]);
    const rollingPlan = CodexDevelopmentParseRollingPlanV1(rollingPlanSource);
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    const selectedManifestId = path.posix.basename(pointer.manifest, '.md');
    const manifestSource = await readCompilerFile(pointer.manifest);
    const rawManifestDigest = pointerSource.match(
      /manifestDigest: (sha256:[0-9a-f]{64})/u
    )?.[1];

    expect(rollingPlan.activePackageId).toBe(selectedManifestId);
    expect(rollingPlan.candidatePackageIds.length).toBeGreaterThanOrEqual(2);
    expect(rollingPlan.candidatePackageIds.length).toBeLessThanOrEqual(5);
    expect(new Set(rollingPlan.candidatePackageIds).size)
      .toBe(rollingPlan.candidatePackageIds.length);
    expect(rollingPlan.candidatePackageIds).not.toContain(selectedManifestId);
    expectContainsAll(rollingPlanSource, [
      '## 当前唯一 Work Package',
      '## 候选 Work Package',
      '#275',
      '## 后续但暂不占 formal writer',
      '## 重新规划硬触发器',
      '## 加速验收'
    ]);
    expect(rawManifestDigest).toBeDefined();
    expect(CodexDevelopmentWorkPackageManifestDigest(manifestSource)).toBe(rawManifestDigest!);
    const manifest = CodexDevelopmentParseWorkPackageManifest(
      manifestSource,
      pointer.manifest
    );
    expect(manifest.id).toBe(selectedManifestId);
    expect(manifest.manifestState).toBe('frozen');
    expect(manifest.tasks.length).toBeGreaterThan(0);
    expect(manifest.acceptance.length).toBeGreaterThan(0);
    expectContainsAll(pointerSource, [
      `docs/work-packages/${selectedManifestId}.md`,
      rawManifestDigest!,
      'selectionMode: exact-manifest-not-on-default-branch-v1'
    ]);
    expectContainsAll(rollingPlanSource, [
      `### ${selectedManifestId}`,
      'then-current main',
      'consumer-zero'
    ]);
    expectContainsNone(rollingPlanSource, [
      '### verification-action-trusted-cutover-v10',
      '### implementation-resolution-architecture-convergence-v1',
      'canonical-architecture-convergence-v1',
      'physical-workspace-observation-v1',
      '1B-4 → #216 → #207',
      'PR #196',
      '#232',
      'Failure Epoch → Trusted Bootstrap → Evidence DAG',
      'bootstrap-repair-348-347-v1'
    ]);
  });

  test('verification governance keeps trusted-cutover activation independent of rotating Work Package ids', async () => {
    const [verificationGovernance, pointerSource] = await Promise.all([
      readCompilerFile('docs/verification-governance.md'),
      readCompilerFile('docs/work/active-work-package.md')
    ]);
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    const activeManifestId = path.posix.basename(pointer.manifest, '.md');

    expectContainsAll(verificationGovernance, [
      'T2 trusted-cutover epoch',
      'integrated candidate',
      'new `main`',
      'exact commit/tree/',
      'merged-tree readback',
      'ordinary candidate canary',
      '轮换中的Work Package identity只由',
      'Document Control Plane拥有'
    ]);
    expect(verificationGovernance).not.toMatch(
      /\bverification-action-trusted-cutover-v\d+\b/u
    );
    expect(verificationGovernance).not.toContain(activeManifestId);
  });

  test('compiler authority binds the pipeline kernel, IR layers, lowering, and single-writer migration', async () => {
    const compiler = await readCompilerFile('docs/compiler-target-ir.md');

    expectContainsAll(compiler, [
      'Pipeline Kernel 拥有 stage order、transaction、journal、cancellation 和 failure propagation',
      '任何 downstream mutating stage只消费同一 transaction 的 validated semantic context',
      '每个阶段必须声明：输入/输出类型、唯一 producer',
      'Target Profile 是生成目标的 canonical capability 输入',
      'Type Algebra 拥有跨层类型 identity',
      'Application IR 表达目标无关的应用结构',
      'Behavior IR 只表达 SEC 能完整验证和 lowering 的受限行为',
      'Target Program IR 表达目标语言程序结构',
      'unsupported 已在 emit 前拒绝',
      'raw builder → validator → branded validated snapshot',
      '不按 Ticket、Customer 或其他示例名称分支',
      'shadow generate',
      'clean result byte-equivalent',
      '同一artifact没有竞争writer'
    ]);
    expectContainsNone(compiler, [
      'docs/05-编译器核心实现规格.md',
      '当前默认 Next'
    ]);
  });

  test('historical agent prose remains non-discoverable and is stored as a fixture', async () => {
    const discoverableArchiveEntries: string[] = [];
    for await (const entry of new Glob('docs/archive/**/AGENTS.md').scan({
      cwd: compilerRoot,
      onlyFiles: true
    })) {
      discoverableArchiveEntries.push(entry);
    }

    expect(discoverableArchiveEntries).toEqual([]);
    expect(
      await readCompilerFile('tests/fixtures/documentation-history/AGENTS.authority-v5.historical.md')
    ).toContain('# SEC Codex 工程治理');
  });

  test('README remains a bounded entry projection instead of a second product or CLI catalog', async () => {
    const readme = await readCompilerFile('README.md');

    expectContainsAll(readme, [
      'Engineering Workspace Compiler',
      'Canonical 工程事实',
      '[产品与边界](docs/product.md)',
      '[系统架构](docs/system-architecture.md)',
      '[语义模型](docs/semantic-model.md)',
      '[编译与目标 IR](docs/compiler-target-ir.md)',
      '[文档导航](docs/README.md)',
      '[仓库开发入口](AGENTS.md)',
      'document control plane',
      'RequiredClosure ∩ MissingOrStale'
    ]);
    expect(readme.match(/^\d+\. /gmu)).toHaveLength(5);
    expect(readme).not.toContain('bun run sec -- <command>');
    expect(readme).not.toContain('demo:closed-loop');
    expect(readme).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(readme).not.toMatch(/\bPR #\d+\b/u);
  });

  test('Nexus absorption ledger binds the exact corpus baseline and the 29 EPR binding records', async () => {
    const ledger = await readCompilerFile('docs/governance/nexus-absorption-ledger.yaml');
    const parsed = Bun.YAML.parse(ledger) as {
      status: string;
      source: {
        repository: string;
        baselineCommit: string;
        baselineTree: string;
        trackedPaths: number;
      };
      coverage: { eprBindings: { bound: number; expected: number } };
      completion: {
        censusComplete: boolean;
        parityComplete: boolean;
        retirementComplete: boolean;
        noOmissionProven: boolean;
      };
    };

    expect(parsed.status).toBe('incomplete');
    expect(parsed.source.repository).toBe('QzCrane/nexus');
    expect(parsed.source.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.source.baselineTree).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.source.trackedPaths).toBeGreaterThan(0);
    expect(parsed.coverage.eprBindings.expected).toBe(29);
    expect(parsed.coverage.eprBindings.bound).toBe(
      NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'bound').length
    );
    expect(NEXUS_EPR_BINDINGS_V1).toHaveLength(29);
    expect(NEXUS_EPR_BINDINGS_V1.filter((entry) => entry.binding === 'blocked')).toHaveLength(
      29 - parsed.coverage.eprBindings.bound
    );
    expect(parsed.completion).toEqual({
      censusComplete: false,
      parityComplete: false,
      retirementComplete: false,
      noOmissionProven: false
    });
    expectContainsAll(ledger, [
      'status: incomplete',
      'repository: QzCrane/nexus',
      'bound: 26',
      'expected: 29',
      'EPR-013 Issue #307',
      'EPR-016 Issue #288',
      'EPR-017 Issue #222'
    ]);
  });
});
