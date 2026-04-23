import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';

test('policy gate fails when tenant scoping is removed from customer queries', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-policy-'));

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const customerServicePath = path.join(
    workspaceRoot,
    'project',
    'src',
    'installed',
    'entity',
    'customer-service.ts'
  );
  await fs.writeFile(
    customerServicePath,
    `import type { CustomerInput, CustomerRecord, Database } from '../../runtime/database.ts';\nimport type { Session } from '../auth/session.ts';\nimport { normalizeCustomerInput } from '../../../custom/customer_normalizer.ts';\n\nexport function createCustomer(db: Database, session: Session, input: CustomerInput): CustomerRecord {\n  const normalized = normalizeCustomerInput(input);\n  const customer: CustomerRecord = {\n    id: db.nextCustomerId++,\n    tenantId: session.tenantId,\n    ...normalized\n  };\n  db.customers.push(customer);\n  return customer;\n}\n\nexport function listCustomers(db: Database, session: Session): CustomerRecord[] {\n  return db.customers.filter((customer) => customer.tenantId === session.tenantId);\n}\n`,
    'utf8'
  );

  await assert.rejects(
    async () => verifyWorkspace(workspaceRoot),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'VERIFY-ACCEPTANCE-003'
  );

  const report = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'verification-report.json'), 'utf8')
  ) as { policy: { status: string; violations: Array<{ id: string }> } };
  assert.equal(report.policy.status, 'failed');
  assert.equal(report.policy.violations[0]?.id, 'tenant-scope-required');
});
