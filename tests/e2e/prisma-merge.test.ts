import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { runCliInProcess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('Compose materializes Prisma schema without applying it to a database', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const initRes = await runCliInProcess(workspaceRoot, ['init']);
    expect(initRes.code).toBe(0);

    const { prismaRoot } = getWorkspacePaths(workspaceRoot);
    const schemaDir = prismaRoot;
    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(path.join(schemaDir, 'db.prisma.template'), `
model CustomExtension {
  id    String @id
  value String
}
`, 'utf8');

    const resolveRes = await runCliInProcess(workspaceRoot, ['resolve']);
    expect(resolveRes.code).toBe(0);
    const composeRes = await runCliInProcess(workspaceRoot, ['compose']);
    expect(composeRes.code, composeRes.stderr || composeRes.stdout).toBe(0);

    const targetPrismaSchemaPath = path.join(prismaRoot, 'schema.prisma');
    const resultSchema = await fs.readFile(targetPrismaSchemaPath, 'utf8');
    expect(resultSchema).toContain('model CustomExtension {');
    expect(resultSchema).toContain('id    String @id');
    expect(resultSchema).toContain('value String');

    // Database mutation is not a compilation side effect. A future explicit
    // database Operation/provider may apply this schema under its own authority.
    await expect(fs.stat(path.join(prismaRoot, 'dev.db'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 180000);
