import { SUPPORTED_STACK } from '../compiler/contract.ts';
import { officialRegistryRelativePath, posixPath } from '../workspace/paths.ts';
import type { PlanFile } from '../compiler/contract.ts';

const REFERENCE_ACCEPTANCE: readonly PlanFile['acceptance'][number][] = Object.freeze([
  { id: 'user_can_login' },
  { id: 'user_can_create_customer' },
  { id: 'user_can_list_customers' },
  { id: 'tenant_only_sees_own_customers' }
]);

/**
 * Explicit demo/reference template. These Customer/Tenant/Auth choices are
 * product-example data, not Workspace Lifecycle semantics.
 */
export function buildReferenceWorkspacePlan(): PlanFile {
  return {
    app: {
      id: 'customer-admin',
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: {
      sources: [
        {
          id: 'official',
          kind: 'official',
          location: 'compiler',
          path: posixPath(officialRegistryRelativePath)
        },
        {
          id: 'source-private',
          kind: 'private',
          location: 'workspace',
          path: 'source/blocks/private'
        },
        {
          id: 'private',
          kind: 'private',
          location: 'workspace',
          path: 'src/compiler/registry/private'
        }
      ]
    },
    blocks: [
      { id: 'auth/basic-session', version: '0.1.0' },
      { id: 'tenant/basic-workspace', version: '0.1.0' },
      { id: 'entity/customer-basic', version: '0.1.0' }
    ],
    slots: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        sourcePath: 'source/code/slots/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        description: 'Name required; email lowercased; phone digits only; company defaults to Unknown.'
      }
    ],
    acceptance: [...REFERENCE_ACCEPTANCE]
  };
}
