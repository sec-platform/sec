import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  applyPrefixSandboxing,
  prefixClassNameString,
  prefixCssContent
} from '../../platform/compiler/compose/frontend-stitching.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('prefixClassNameString handles canonical literal utility tokens', () => {
  expect(prefixClassNameString('flex items-center bg-white'))
    .toBe('block-attachment-flex block-attachment-items-center block-attachment-bg-white');
  expect(prefixClassNameString('-mx-2 -mt-4'))
    .toBe('-block-attachment-mx-2 -block-attachment-mt-4');
  expect(prefixClassNameString('hover:text-red-500 sm:flex lg:hover:-mx-2'))
    .toBe('hover:block-attachment-text-red-500 sm:block-attachment-flex lg:hover:-block-attachment-mx-2');
  expect(prefixClassNameString('block-attachment-flex flex'))
    .toBe('block-attachment-flex block-attachment-flex');
});

test('prefixCssContent supports flat selector rules and preserves non-class selectors', () => {
  const css = `
    .btn {
      color: red;
    }
    .btn-primary, .btn-secondary:hover {
      background: blue;
    }
    div {
      padding: 10px;
    }
  `;
  const result = prefixCssContent(css);
  expect(result).toContain('.block-attachment-btn {');
  expect(result).toContain('.block-attachment-btn-primary, .block-attachment-btn-secondary:hover {');
  expect(result).not.toContain('.block-attachment-div');
});

test('prefixCssContent refuses grammar that needs a real CSS parser provider', () => {
  expect(() => prefixCssContent('@media (min-width: 640px) { .card { color: red; } }'))
    .toThrow(/requires a real CSS provider|nested rules/);
  expect(() => prefixCssContent('[data-state="open"] .card { color: red; }'))
    .toThrow(/unsupported selector grammar/);
});

test('applyPrefixSandboxing applies deterministic transformations to static workspace files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const configPath = path.join(workspaceRoot, 'tailwind.config.ts');
    await fs.writeFile(configPath, `
      const config = {
        theme: {
          extend: {}
        }
      };
      export default config;
    `, 'utf8');

    const componentDir = path.join(workspaceRoot, 'components');
    await fs.mkdir(componentDir, { recursive: true });
    const tsxPath = path.join(componentDir, 'Button.tsx');
    await fs.writeFile(tsxPath, `
      export function Button() {
        return <button className="flex items-center hover:bg-blue-500 -mx-2">Click me</button>;
      }
    `, 'utf8');

    const cssDir = path.join(workspaceRoot, 'styles');
    await fs.mkdir(cssDir, { recursive: true });
    const cssPath = path.join(cssDir, 'globals.css');
    await fs.writeFile(cssPath, '.card { border: 1px solid #ccc; }\n', 'utf8');

    await applyPrefixSandboxing(workspaceRoot, [
      'components/Button.tsx',
      'styles/globals.css'
    ]);

    expect(await fs.readFile(configPath, 'utf8')).toContain('prefix: "block-attachment-"');
    const updatedTsx = await fs.readFile(tsxPath, 'utf8');
    expect(updatedTsx).toContain('block-attachment-flex');
    expect(updatedTsx).toContain('hover:block-attachment-bg-blue-500');
    expect(updatedTsx).toContain('-block-attachment-mx-2');
    expect(await fs.readFile(cssPath, 'utf8')).toContain('.block-attachment-card {');
  });
});

test('dynamic className cannot silently bypass a globally injected Tailwind prefix', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const configPath = path.join(workspaceRoot, 'tailwind.config.ts');
    const originalConfig = `
      const config = { theme: { extend: {} } };
      export default config;
    `;
    await fs.writeFile(configPath, originalConfig, 'utf8');
    await fs.mkdir(path.join(workspaceRoot, 'components'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'components', 'Dynamic.tsx'), `
      export function Dynamic({ active }: { active: boolean }) {
        return <div className={active ? "card" : "panel"}>x</div>;
      }
    `, 'utf8');

    await expect(applyPrefixSandboxing(workspaceRoot, ['components/Dynamic.tsx']))
      .rejects.toThrow(/requires an explicit Style Transform Provider/);
    expect(await fs.readFile(configPath, 'utf8')).toBe(originalConfig);
  });
});

test('style sandbox rejects portable path aliases before injecting configuration', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const configPath = path.join(workspaceRoot, 'tailwind.config.ts');
    const original = 'export default { theme: { extend: {} } };\n';
    await fs.writeFile(configPath, original, 'utf8');
    await expect(applyPrefixSandboxing(workspaceRoot, [
      'components/Foo.tsx',
      'components/foo.tsx'
    ])).rejects.toMatchObject({ code: 'COMPOSE-PATH-004' });
    expect(await fs.readFile(configPath, 'utf8')).toBe(original);
  });
});

test('style sandbox revalidates the complete edit-set preimage before its first write', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const configPath = path.join(workspaceRoot, 'tailwind.config.ts');
    const originalConfig = 'export default { theme: { extend: {} } };\n';
    await fs.writeFile(configPath, originalConfig, 'utf8');
    const componentDir = path.join(workspaceRoot, 'components');
    await fs.mkdir(componentDir, { recursive: true });
    const componentPath = path.join(componentDir, 'Button.tsx');
    await fs.writeFile(componentPath, 'export const Button = () => <button className="flex">x</button>;\n');

    let mutated = false;
    await expect(applyPrefixSandboxing(
      workspaceRoot,
      ['components/Button.tsx'],
      async () => {
        if (mutated) return;
        mutated = true;
        await fs.writeFile(componentPath, 'external writer\n');
      }
    )).rejects.toThrow(/preimage changed after planning/);

    expect(await fs.readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(await fs.readFile(componentPath, 'utf8')).toBe('external writer\n');
  });
});
