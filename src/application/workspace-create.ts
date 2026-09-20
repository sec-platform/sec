import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import { posixPath } from '../contracts/relative-path.ts';
import type { PlanFile } from '../compiler/contract.ts';
import { SUPPORTED_STACK } from '../compiler/contract.ts';
import { CompilerError } from '../compiler/errors.ts';
import { privateRegistryRelativePath } from '../workspace/paths.ts';

export type WorkspaceCreateTemplate = 'minimal' | 'reference-customer';

export interface WorkspaceCreateResources {
  readonly officialRegistryRelativePath: string;
}

export interface PreparedWorkspaceCreate {
  readonly template: WorkspaceCreateTemplate;
  readonly plan: PlanFile;
  readonly initialGeneratedPaths: readonly string[];
}

const REFERENCE_ACCEPTANCE: readonly PlanFile['acceptance'][number][] = Object.freeze([
  { id: 'user_can_login' },
  { id: 'user_can_create_customer' },
  { id: 'user_can_list_customers' },
  { id: 'tenant_only_sees_own_customers' }
]);

export function resolveWorkspaceCreateTemplate(value: unknown): WorkspaceCreateTemplate {
  if (value === undefined) return 'minimal';
  if (value === 'minimal' || value === 'reference-customer') return value;
  throw new CompilerError(
    'WORKSPACE-INIT-002',
    `Unsupported workspace create template "${String(value)}"`,
    { supportedTemplates: ['minimal', 'reference-customer'] }
  );
}

function registrySources(resources: WorkspaceCreateResources): PlanFile['registry']['sources'] {
  return [
    {
      id: 'official',
      kind: 'official',
      location: 'compiler',
      path: posixPath(resources.officialRegistryRelativePath)
    },
    {
      id: 'private',
      kind: 'private',
      location: 'workspace',
      path: posixPath(privateRegistryRelativePath)
    }
  ];
}

export function buildReferenceWorkspacePlan(resources: WorkspaceCreateResources): PlanFile {
  return {
    app: {
      id: 'customer-admin',
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: registrySources(resources) },
    blocks: [
      { id: 'auth/basic-session', version: '0.1.0' },
      { id: 'tenant/basic-workspace', version: '0.1.0' },
      { id: 'entity/customer-basic', version: '0.1.0' }
    ],
    // A returned author plan owns its entries; array copying alone would let
    // one workspace mutate the defaults used by every later workspace.
    acceptance: REFERENCE_ACCEPTANCE.map(entry => ({ ...entry }))
  };
}

export function buildMinimalWorkspacePlan(resources: WorkspaceCreateResources): PlanFile {
  return {
    app: {
      id: 'app',
      name: 'app',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: { sources: registrySources(resources) },
    blocks: [],
    acceptance: []
  };
}

export function buildWorkspaceCreatePlan(
  template: WorkspaceCreateTemplate,
  resources: WorkspaceCreateResources
): PlanFile {
  return template === 'reference-customer'
    ? buildReferenceWorkspacePlan(resources)
    : buildMinimalWorkspacePlan(resources);
}

export function initialWorkspaceGeneratedPaths(template: WorkspaceCreateTemplate): readonly string[] {
  return template === 'reference-customer'
    ? Object.freeze([
        CI_ARTIFACT_FILES.blockUsageMap,
        CI_ARTIFACT_FILES.installManifest,
        CI_ARTIFACT_FILES.verificationReport
      ])
    : Object.freeze([CI_ARTIFACT_FILES.verificationReport]);
}

export function prepareWorkspaceCreate(
  templateValue: unknown,
  resources: WorkspaceCreateResources
): PreparedWorkspaceCreate {
  const template = resolveWorkspaceCreateTemplate(templateValue);
  return Object.freeze({
    template,
    plan: buildWorkspaceCreatePlan(template, resources),
    initialGeneratedPaths: initialWorkspaceGeneratedPaths(template)
  });
}
