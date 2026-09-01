import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { sha256, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';

const PROJECT_WRITE_AUTHORIZATION = Symbol('project-write-authorization');

export interface ProjectWriteAuthorization {
  readonly [PROJECT_WRITE_AUTHORIZATION]: true;
}

export interface ProjectWriteAuthorizationProjection {
  readonly operation: string;
  readonly scopeDigest: `sha256:${string}`;
  readonly impactPaths: readonly string[];
  readonly expires: 'callback-settlement';
}

type ProjectWriteAuthorizationFailure =
  | 'concurrent-authorization'
  | 'expired-authorization'
  | 'invalid-operation'
  | 'invalid-path'
  | 'invalid-authorization'
  | 'root-mismatch';

export class ProjectWriteAuthorizationError extends Error {
  readonly name = 'ProjectWriteAuthorizationError';
  readonly code = 'PROJECT-WRITE-AUTHORIZATION-001';

  constructor(
    readonly kind: ProjectWriteAuthorizationFailure,
    message: string
  ) {
    super(message);
  }
}

interface ProjectWriteAuthorizationPayload extends ProjectWriteAuthorizationProjection {
  readonly workspaceRoot: string;
  active: boolean;
}

const authorizationContext = new AsyncLocalStorage<ProjectWriteAuthorization>();
const authorizationPayloads = new WeakMap<ProjectWriteAuthorization, ProjectWriteAuthorizationPayload>();

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function canonicalOperation(operation: string): string {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(operation)) {
    throw new ProjectWriteAuthorizationError(
      'invalid-operation',
      'Project write authorization operation must be one canonical semantic identity'
    );
  }
  return operation;
}

function canonicalImpactPaths(impactPaths: readonly string[]): readonly string[] {
  for (const impactPath of impactPaths) {
    if (!isCanonicalPortableLogicalPath(impactPath)) {
      throw new ProjectWriteAuthorizationError(
        'invalid-path',
        'Project write authorization contains a noncanonical impact path'
      );
    }
  }
  if (new Set(impactPaths).size !== impactPaths.length) {
    throw new ProjectWriteAuthorizationError(
      'invalid-path',
      'Project write authorization impact paths must be unique'
    );
  }
  return Object.freeze(uniqueSorted(impactPaths));
}

/**
 * Binds one owner decision to a generic Workspace write scope. The authority
 * exists only in the callback's async context and expires at settlement, so it
 * cannot be reconstructed from a persisted plan, journal, digest, or caller
 * object.
 */
export async function withProjectWriteAuthorization<Result>(input: {
  readonly workspaceRoot: string;
  readonly operation: string;
  readonly impactPaths: readonly string[];
  readonly beforeCommit?: () => void | Promise<void>;
}, execute: (authorization: ProjectWriteAuthorization) => Promise<Result>): Promise<Result> {
  if (authorizationContext.getStore() !== undefined) {
    throw new ProjectWriteAuthorizationError(
      'concurrent-authorization',
      'A project write authorization is already active in this async operation'
    );
  }

  const workspaceRoot = canonicalWorkspaceRoot(input.workspaceRoot);
  const operation = canonicalOperation(input.operation);
  const impactPaths = canonicalImpactPaths(input.impactPaths);
  await input.beforeCommit?.();

  const authorization = Object.freeze({ [PROJECT_WRITE_AUTHORIZATION]: true as const });
  const projection = Object.freeze({
    operation,
    scopeDigest: sha256({ operation, impactPaths }) as `sha256:${string}`,
    impactPaths,
    expires: 'callback-settlement' as const
  });
  const payload: ProjectWriteAuthorizationPayload = {
    workspaceRoot,
    ...projection,
    active: true
  };
  authorizationPayloads.set(authorization, payload);

  try {
    return await authorizationContext.run(authorization, () => execute(authorization));
  } finally {
    payload.active = false;
  }
}

export function currentProjectWriteAuthorization(): ProjectWriteAuthorization | null {
  return authorizationContext.getStore() ?? null;
}

export function projectProjectWriteAuthorization(
  workspaceRoot: string,
  authorization: ProjectWriteAuthorization
): ProjectWriteAuthorizationProjection {
  const payload = authorizationPayloads.get(authorization);
  if (!payload) {
    throw new ProjectWriteAuthorizationError(
      'invalid-authorization',
      'Project write authorization must be issued by the Workspace owner'
    );
  }
  if (!payload.active || authorizationContext.getStore() !== authorization) {
    throw new ProjectWriteAuthorizationError(
      'expired-authorization',
      'Project write authorization has expired'
    );
  }
  if (payload.workspaceRoot !== canonicalWorkspaceRoot(workspaceRoot)) {
    throw new ProjectWriteAuthorizationError(
      'root-mismatch',
      'Project write authorization targets a different workspace'
    );
  }
  return Object.freeze({
    operation: payload.operation,
    scopeDigest: payload.scopeDigest,
    impactPaths: payload.impactPaths,
    expires: payload.expires
  });
}
