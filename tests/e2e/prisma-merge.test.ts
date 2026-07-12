import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { runCliInProcess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('Compose merge-prisma-template successfully merges db.prisma.template into schema.prisma', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // 1. Initialize the workspace first
    const initRes = await runCliInProcess(workspaceRoot, ['init', '--reset']);
    expect(initRes.code).toBe(0);

    const { developerSourceRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
    
    // Create source/schema folder
    const schemaDir = path.join(developerSourceRoot, 'schema');
    await fs.mkdir(schemaDir, { recursive: true });

    // Write db.prisma.template
    const templateContent = `
model CustomExtension {
  id    String @id
  value String
}
`;
    await fs.writeFile(path.join(schemaDir, 'db.prisma.template'), templateContent, 'utf8');

    // Run CLI resolve
    const resolveRes = await runCliInProcess(workspaceRoot, ['resolve']);
    expect(resolveRes.code).toBe(0);

    // Run CLI compose
    const composeRes = await runCliInProcess(workspaceRoot, ['compose']);
    expect(composeRes.code, composeRes.stderr || composeRes.stdout).toBe(0);

    // 2. Check that target schema.prisma has the model CustomExtension merged
    const targetPrismaSchemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
    const resultSchema = await fs.readFile(targetPrismaSchemaPath, 'utf8');

    expect(resultSchema).toContain('model CustomExtension {');
    expect(resultSchema).toContain('id    String @id');
    expect(resultSchema).toContain('value String');

    // 3. Confirm SQLite database is created by prisma db push
    const dbPath = path.join(projectRoot, 'prisma', 'dev.db');
    const dbExists = await fs.stat(dbPath).then(() => true).catch(() => false);
    expect(dbExists).toBe(true);
  });
}, 180000);
