import { expect, test } from 'bun:test';
import { applyViewMutations } from '../../platform/compiler/workbench/apply-view-mutations.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readYaml } from '../../platform/shared/yaml.ts';
import type { PlanFile } from '../../platform/shared/plan-manifest-types.ts';

test('applyViewMutations handles graphical mutations correctly', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // 1. 初始化 source/app.yaml
    const sourceDir = path.join(workspaceRoot, 'source');
    await fs.mkdir(sourceDir, { recursive: true });
    const appYamlPath = path.join(sourceDir, 'app.yaml');

    const initialAppYaml = `
app:
  name: test-app
  stack: nextjs-ts-prisma-sqlite
  mode: single-tenant
registry:
  sources: []
blocks:
  - id: auth/basic-session
    version: 0.1.0
slots:
  - id: existing_slot
    block: auth/basic-session
    kind: adapter
    target: custom/existing.ts
    sourcePath: source/code/slots/existing.ts
    symbol: handleAuth
acceptance: []
`;
    await fs.writeFile(appYamlPath, initialAppYaml, 'utf8');

    // 2. 创建 mock mutation 目录与 JSON 文件
    const mutationsDir = path.join(sourceDir, 'views', 'mutations');
    await fs.mkdir(mutationsDir, { recursive: true });

    const mutationFileContent = {
      formatVersion: '1',
      mutations: [
        // 增 Block
        {
          id: 'mut-add-block',
          kind: 'add-block',
          blockId: 'tenant/basic-workspace',
          version: '0.2.0'
        },
        // 绑 Slot (新增绑定)
        {
          id: 'mut-bind-slot-new',
          kind: 'bind-slot',
          slotId: 'new_slot',
          block: 'tenant/basic-workspace',
          slotKind: 'adapter',
          target: 'custom/tenant.ts',
          sourcePath: 'source/code/slots/tenant.ts',
          symbol: 'initTenant'
        },
        // 解绑 Slot
        {
          id: 'mut-unbind-slot',
          kind: 'unbind-slot',
          slotId: 'existing_slot'
        },
        // 删 Block
        {
          id: 'mut-remove-block',
          kind: 'remove-block',
          blockId: 'auth/basic-session'
        }
      ]
    };
    await fs.writeFile(
      path.join(mutationsDir, 'graphical-mutations.json'),
      JSON.stringify(mutationFileContent, null, 2),
      'utf8'
    );

    // 3. 执行应用
    const report = await applyViewMutations(workspaceRoot);

    expect(report.status).toBe('applied');
    expect(report.mutationCount).toBe(4);
    expect(report.appliedCount).toBe(4);

    // 4. 读取最终的 app.yaml 并断言
    const finalPlan = (await readYaml(appYamlPath)) as PlanFile;

    // 验证 add-block 成功
    expect(finalPlan.blocks.some(b => b.id === 'tenant/basic-workspace' && b.version === '0.2.0')).toBe(true);

    // 验证 bind-slot 成功
    expect(finalPlan.slots.some(s => s.id === 'new_slot' && s.block === 'tenant/basic-workspace' && s.symbol === 'initTenant')).toBe(true);

    // 验证 remove-block 成功 (auth/basic-session 被删除)
    expect(finalPlan.blocks.some(b => b.id === 'auth/basic-session')).toBe(false);

    // 验证 unbind-slot 成功 并且 remove-block 的 slots 被级联删除
    expect(finalPlan.slots.some(s => s.id === 'existing_slot')).toBe(false);
  });
});
