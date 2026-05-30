import { expect, test } from 'bun:test';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

test('applies db-expand-contract migration correctly', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // 1. 准备 prisma/schema.prisma 文件的初始内容
    const prismaDir = path.join(workspaceRoot, 'prisma');
    await fs.mkdir(prismaDir, { recursive: true });
    const schemaPath = path.join(prismaDir, 'schema.prisma');
    
    const initialSchema = `
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Customer {
  id    String @id @default(uuid())
  email String
  phone String
}
`;
    await fs.writeFile(schemaPath, initialSchema, 'utf8');

    // 2. 构造 db-expand-contract 迁移条目
    const migrationEntry = {
      id: 'mig-expand-contract-test',
      kind: 'db-expand-contract' as const,
      reason: 'Migrate phone to phoneNumber',
      target: 'prisma/schema.prisma',
      entity: 'Customer',
      expandField: 'phoneNumber String?',
      contractField: 'phone',
      copyJobCode: `
        await prisma.customer.updateMany({
          data: {
            phoneNumber: 'copied-phone'
          }
        });
      `
    };

    // 3. 执行应用
    const targetManifestRoot = path.join(workspaceRoot, 'manifests');
    await fs.mkdir(targetManifestRoot, { recursive: true });
    
    await applyMigrationEntries(
      workspaceRoot,
      targetManifestRoot,
      ['prisma/schema.prisma'], // impacts
      [migrationEntry]
    );

    // 4. 断言验证
    // 验证 schema.prisma 是否被正确修改：phoneNumber 被加入，phone 被注释掉
    const updatedSchema = await fs.readFile(schemaPath, 'utf8');
    expect(updatedSchema).toContain('phoneNumber String?');
    expect(updatedSchema).toContain('// [Contracted Old Field]: phone String');

    // 验证迁移 Job 文件是否被物理写入
    const jobPath = path.join(workspaceRoot, 'src', 'jobs', 'db-migrations', 'mig-expand-contract-test.ts');
    const jobExists = await fs.stat(jobPath).then(() => true).catch(() => false);
    expect(jobExists).toBe(true);

    const jobContent = await fs.readFile(jobPath, 'utf8');
    expect(jobContent).toContain('// @generated-db-migration-job migration-id:mig-expand-contract-test');
    expect(jobContent).toContain('runMigrationJob');
    expect(jobContent).toContain("phoneNumber: 'copied-phone'");
  });
});
