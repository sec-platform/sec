import { Glob } from 'bun';
import { describe, expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

describe('canonical documentation authority', () => {
  test('roadmap owns the stable capability DAG without dynamic project state', async () => {
    const roadmap = await readCompilerFile('docs/roadmap.md');
    const orderedStages = [
      'Canonical Engineering Foundation',
      'Semantic Mutation Minimal Surface',
      'Blockless Source Ownership',
      'Target Profile + Type Algebra',
      'Application IR',
      'Behavior IR',
      'Target Program IR + Backend',
      'General TypeScript Lowering',
      'Engineering Workspace Domains',
      'Workbench / AI Semantic Operator',
      'TypeScript Brownfield Adoption',
      'Release / Deployment / Operations',
      'Registry Trust / Ecosystem / Additional Languages'
    ];

    expectContainsAll(roadmap, [
      ...orderedStages,
      'Verification Result Truth',
      'Epoch / Failure Core → Trusted Bootstrap → Evidence DAG / Run Journal',
      'clean/incremental byte-equivalent',
      'unsupported-before-emit',
      'stable Entity/Fact/Assertion identity',
      'deterministic revision',
      '统一 Pipeline Kernel',
      '每层只有一个producer',
      '只保留一个writer'
    ]);
    for (let index = 1; index < orderedStages.length; index += 1) {
      expect(roadmap.indexOf(orderedStages[index]!)).toBeGreaterThan(
        roadmap.indexOf(orderedStages[index - 1]!)
      );
    }
    expectContainsNone(roadmap, [
      'docs/03-MVP实施计划与路线图.md',
      '当前禁止事项',
      'v0.3 Semantic Core Foundation'
    ]);
    expect(roadmap).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(roadmap).not.toMatch(/\bPR #\d+\b/u);
  });

  test('rolling plan and migration Evidence retain replay provenance and ordered verification exits', async () => {
    const rollingPlan = await readCompilerFile('docs/work/rolling-plan.md');
    const migrationEvidence = await readCompilerFile(
      'docs/evidence/documentation/active-documentation-corpus-v1.md'
    );

    expectContainsAll(rollingPlan, [
      '当前 PR #196',
      'PR #197',
      'consolidated tree 等价重放',
      'Failure Epoch → Trusted Bootstrap → Evidence DAG'
    ]);
    expect(rollingPlan.indexOf('Failure Epoch')).toBeLessThan(rollingPlan.indexOf('Trusted Bootstrap'));
    expect(rollingPlan.indexOf('Trusted Bootstrap')).toBeLessThan(rollingPlan.indexOf('Evidence DAG'));
    expectContainsNone(rollingPlan, ['Failure Epoch / Trusted Bootstrap / Evidence DAG']);
    expectContainsAll(migrationEvidence, [
      'Target IR 跨层进入门',
      'provisional snapshot 失效/rebind',
      'aggregate completion',
      '两个独立团队',
      '永久 regression',
      'PR #197 内容重放'
    ]);
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

  test('archive preserves historical agent prose only under non-discoverable names', async () => {
    const discoverableArchiveEntries: string[] = [];
    for await (const entry of new Glob('docs/archive/**/AGENTS.md').scan({
      cwd: compilerRoot,
      onlyFiles: true
    })) {
      discoverableArchiveEntries.push(entry);
    }

    expect(discoverableArchiveEntries).toEqual([]);
    expect(
      await readCompilerFile('docs/archive/authority-v5/root/AGENTS.historical.md')
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
      'bun run check:affected --plan',
      'sec-repository-orientation'
    ]);
    expect(readme.match(/^\d+\. /gmu)).toHaveLength(5);
    expect(readme).not.toContain('bun run sec -- <command>');
    expect(readme).not.toContain('demo:closed-loop');
    expect(readme).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(readme).not.toMatch(/\bPR #\d+\b/u);
  });
});
