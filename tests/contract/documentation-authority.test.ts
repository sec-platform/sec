import { describe, expect, test } from 'bun:test';

import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

describe('canonical documentation authority', () => {
  test('roadmap documents the stable stage DAG and authority boundaries', async () => {
    const routeMap = await readCompilerFile('docs/03-MVP实施计划与路线图.md');
    const stageMarkers = [
      'P0  Current Reality / Canonical Foundation',
      'P1  SM-4A Workbench/CLI Minimal Semantic Mutation Surface',
      'P2  Blockless Semantic Source Ownership',
      'P3  TypeScript Target Profile + Semantic Type Algebra',
      'P4  Application IR + Behavior IR + TypeScript Program IR',
      'P5  Generic TypeScript Lowering',
      'P6  Engineering Workspace Domain Foundation',
      'P7  Documentation / Workflow / Agent / Release Projections',
      'P8  Complete Workbench Semantic Operations',
      'P9  Task Envelope v2 + AI Semantic Operator',
      'P10 TypeScript Brownfield Attach/Lift/Reconcile/Adopt/Normalize',
      'P11 Nexus Full Parity / Retirement Closure',
      'P12 Registry Trust / Multi-team / Multi-target / Production Hardening'
    ];

    expectContainsAll(routeMap, [
      ...stageMarkers,
      '`work/current-state.yaml`、`work/rolling-plan.md` 与 active pointer',
      'provisional target-lowering input',
      '任何阶段都不得并行保留第二 loader、第二 writer、第二 revision algorithm 或第二 target-program pipeline',
      '结果进入main并完成清理',
      '从新main重算下一项',
      '未验证、失败、超时或未执行不能宣称通过'
    ]);
    for (let index = 1; index < stageMarkers.length; index += 1) {
      expect(routeMap.indexOf(stageMarkers[index])).toBeGreaterThan(
        routeMap.indexOf(stageMarkers[index - 1])
      );
    }
    expectContainsNone(routeMap, [
      'v0.3 Semantic Core Foundation',
      'Engineering IR Kernel',
      'Fact Provenance',
      'Ticket Semantic Contract',
      'Architecture View',
      'Scenario View',
      'State View',
      '当前禁止事项'
    ]);
    expect(routeMap).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(routeMap).not.toMatch(/\bPR #\d+\b/u);
  });

  test('compiler spec documents workspace ownership and canonical IR boundaries', async () => {
    const spec = await readCompilerFile('docs/05-编译器核心实现规格.md');

    expectContainsAll(spec, [
      'source/code/slots/**',
      'Governed Source',
      '`graph.lock.json`',
      '不是 Engineering IR',
      'platform/compiler/ir/',
      'build-engineering-ir.ts',
      'CodeBuilder'
    ]);
  });

  test('README documents the semantic compiler entry model without duplicating the CLI catalog', async () => {
    const readme = await readCompilerFile('README.md');

    expectContainsAll(readme, [
      '本地优先的工程语义编译器',
      'Authoring Source',
      'Semantic Frontend',
      'Engineering IR',
      'ExplainGraph',
      'bun run sec -- <command>',
      'bun run demo:closed-loop',
      'source/model/**',
      'Task Envelope',
      'Semantic Mutation'
    ]);
    expect(readme).not.toContain('bun run platform --');
  });

});
