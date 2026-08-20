import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { formatOutputFiles } from '../../platform/compiler/compose/format-output-files.ts';
import { pathExists, readText, writeText } from '../../platform/shared/fs.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('formatOutputFiles', () => {
  test('successfully formats unformatted js/ts files using Prettier', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      // Create an unformatted file
      const relativePath = 'app/unformatted.ts';
      const fullPath = path.join(workspaceRoot, relativePath);
      
      const rawCode = `export   function    hello(name:string){
return "hello "+name;
}`;
      await writeText(fullPath, rawCode);

      // Verify it exists and is unformatted
      expect(await pathExists(fullPath)).toBe(true);

      // Run formatter, treat workspaceRoot as projectRoot for testing
      await formatOutputFiles(workspaceRoot, [relativePath]);

      const formattedCode = await readText(fullPath);
      
      // Prettier should have cleaned up spacing, added semicolons, etc.
      expect(formattedCode).not.toEqual(rawCode);
      expect(formattedCode).toContain('export function hello(name: string) {');
    });
  });

  test('rejects portable path aliases before formatter configuration or writes', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await expect(formatOutputFiles(workspaceRoot, [
        'generated/Foo.ts',
        'generated/foo.ts'
      ])).rejects.toMatchObject({ code: 'COMPOSE-PATH-004' });
      expect(await pathExists(path.join(workspaceRoot, 'generated'))).toBe(false);
    });
  });
});
