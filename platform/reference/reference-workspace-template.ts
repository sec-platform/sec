import {
  DEFAULT_ACCEPTANCE,
  SUPPORTED_STACK
} from '../shared/constants.ts';
import {
  officialRegistryRelativePath,
  posixPath
} from '../shared/paths.ts';
import type { PlanFile } from '../shared/plan-manifest-types.ts';

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
          path: 'platform/registry/private'
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
    acceptance: [...DEFAULT_ACCEPTANCE]
  };
}
