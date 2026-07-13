import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WorkspaceWriteLeaseError } from '../../platform/shared/workspace-write-lease.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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
      [migrationEntry],
      async () => undefined
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

test('db-expand-contract stops before its next live write when the commit fence is lost', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const prismaDir = path.join(workspaceRoot, 'prisma');
    await fs.mkdir(prismaDir, { recursive: true });
    const schemaPath = path.join(prismaDir, 'schema.prisma');
    await fs.writeFile(schemaPath, `model Customer {
  id    String @id
  phone String
}
`, 'utf8');

    const migrationEntry = {
      id: 'mig-fence-loss',
      kind: 'db-expand-contract' as const,
      reason: 'Exercise the deep commit fence',
      target: 'prisma/schema.prisma',
      entity: 'Customer',
      expandField: 'phoneNumber String?',
      contractField: 'phone',
      copyJobCode: 'await prisma.customer.updateMany({ data: { phoneNumber: null } });'
    };
    let fenceChecks = 0;
    const commitFence = async (): Promise<void> => {
      fenceChecks += 1;
      if (fenceChecks === 2) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-002',
          'Workspace writer lease token no longer owns the lease'
        );
      }
    };

    await expect(applyMigrationEntries(
      workspaceRoot,
      path.join(workspaceRoot, 'manifests'),
      ['prisma/schema.prisma'],
      [migrationEntry],
      commitFence
    )).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-002' });

    expect(await fs.readFile(schemaPath, 'utf8')).toContain('phoneNumber String?');
    const jobPath = path.join(
      workspaceRoot,
      'src',
      'jobs',
      'db-migrations',
      'mig-fence-loss.ts'
    );
    expect(await fs.stat(jobPath).then(() => true).catch(() => false)).toBe(false);
    expect(fenceChecks).toBe(2);
  }, 'engineering-compiler-upgrade-fence-loss-');
});
