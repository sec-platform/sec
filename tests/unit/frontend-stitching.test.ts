import { expect, test } from 'bun:test';
import { 
  prefixClassNameString, 
  prefixCssContent, 
  applyPrefixSandboxing 
} from '../../platform/compiler/compose/frontend-stitching.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

test('prefixClassNameString utility correctly handles classes', () => {
  // 1. 普通 Tailwind 类名
  expect(prefixClassNameString('flex items-center bg-white'))
    .toBe('block-attachment-flex block-attachment-items-center block-attachment-bg-white');

  // 2. 负值 utility 类名
  expect(prefixClassNameString('-mx-2 -mt-4'))
    .toBe('-block-attachment-mx-2 -block-attachment-mt-4');

  // 3. 修饰符（伪类/响应式）类名
  expect(prefixClassNameString('hover:text-red-500 sm:flex lg:hover:-mx-2'))
    .toBe('hover:block-attachment-text-red-500 sm:block-attachment-flex lg:hover:-block-attachment-mx-2');

  // 4. 忽略已经带有前缀的类名
  expect(prefixClassNameString('block-attachment-flex flex'))
    .toBe('block-attachment-flex block-attachment-flex');
});

test('prefixCssContent utility correctly handles css class selectors', () => {
  const css = `
    .btn {
      color: red;
    }
    .btn-primary, .btn-secondary {
      background: blue;
    }
    div {
      padding: 10px;
    }
  `;
  const result = prefixCssContent(css);
  expect(result).toContain('.block-attachment-btn {');
  expect(result).toContain('.block-attachment-btn-primary, .block-attachment-btn-secondary {');
  expect(result).not.toContain('.block-attachment-div');
});

test('applyPrefixSandboxing applies transformations to workspace files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // 1. 创建 mock tailwind.config.ts
    const configPath = path.join(workspaceRoot, 'tailwind.config.ts');
    await fs.writeFile(configPath, `
      const config = {
        theme: {
          extend: {}
        }
      };
      export default config;
    `, 'utf8');

    // 2. 创建 mock tsx 组件
    const componentDir = path.join(workspaceRoot, 'components');
    await fs.mkdir(componentDir, { recursive: true });
    const tsxPath = path.join(componentDir, 'Button.tsx');
    await fs.writeFile(tsxPath, `
      import React from 'react';
      export function Button() {
        return (
          <button className="flex items-center hover:bg-blue-500 -mx-2">
            Click me
          </button>
        );
      }
    `, 'utf8');

    // 3. 创建 mock css
    const cssDir = path.join(workspaceRoot, 'styles');
    await fs.mkdir(cssDir, { recursive: true });
    const cssPath = path.join(cssDir, 'globals.css');
    await fs.writeFile(cssPath, `
      .card {
        border: 1px solid #ccc;
      }
    `, 'utf8');

    // 4. 执行应用
    const generatedPaths = [
      'components/Button.tsx',
      'styles/globals.css'
    ];
    await applyPrefixSandboxing(workspaceRoot, generatedPaths);

    // 5. 断言验证
    // 验证 tailwind.config.ts 中是否注入了 prefix
    const updatedConfig = await fs.readFile(configPath, 'utf8');
    expect(updatedConfig).toContain('prefix: "block-attachment-"');

    // 验证 Button.tsx
    const updatedTsx = await fs.readFile(tsxPath, 'utf8');
    expect(updatedTsx).toContain('block-attachment-flex');
    expect(updatedTsx).toContain('hover:block-attachment-bg-blue-500');
    expect(updatedTsx).toContain('-block-attachment-mx-2');

    // 验证 globals.css
    const updatedCss = await fs.readFile(cssPath, 'utf8');
    expect(updatedCss).toContain('.block-attachment-card {');
  });
});
