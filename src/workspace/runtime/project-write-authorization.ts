import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

import { sha256 } from '../../contracts/canonical.ts';
import { captureProjectPathInventory } from '../contract/project-path-inventory.ts';

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

// Reservation prevents a preparation callback from starting a nested scope,
// without making an authorization available before the owner fence admits it.
const PREPARING_AUTHORIZATION = Symbol('preparing-project-write-authorization');
const authorizationContext = new AsyncLocalStorage<ProjectWriteAuthorization | typeof PREPARING_AUTHORIZATION>();
const authorizationPayloads = new WeakMap<ProjectWriteAuthorization, ProjectWriteAuthorizationPayload>();

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function canonicalOperation(operation: string): string {
  if (typeof operation !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(operation)) {
    throw new ProjectWriteAuthorizationError(
      'invalid-operation',
      'Project write authorization operation must be one canonical semantic identity'
    );
  }
  return operation;
}

function canonicalImpactPaths(impactPaths: readonly string[]): readonly string[] {
  try {
    return captureProjectPathInventory(impactPaths, 'reject', 'Project write authorization scope');
  } catch {
    throw new ProjectWriteAuthorizationError(
      'invalid-path',
      'Project write authorization needs unique canonical non-aliasing path data'
    );
  }
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

  if (typeof execute !== 'function') throw new TypeError('Project write executor must be callable');
  const cwd = process.cwd();
  return authorizationContext.run(PREPARING_AUTHORIZATION, async () => {
    const { workspaceRoot: requestedRoot, operation: requestedOperation, impactPaths: requestedPaths, beforeCommit } = input;
    const workspaceRoot = path.resolve(cwd, requestedRoot);
    const operation = canonicalOperation(requestedOperation);
    const impactPaths = canonicalImpactPaths(requestedPaths);
    if (beforeCommit !== undefined && typeof beforeCommit !== 'function') {
      throw new TypeError('Project write admission fence must be callable');
    }
    if (beforeCommit !== undefined) await Reflect.apply(beforeCommit, input, []);

    const authorization = Object.freeze({ [PROJECT_WRITE_AUTHORIZATION]: true as const });
    const payload: ProjectWriteAuthorizationPayload = {
      workspaceRoot,
      operation,
      scopeDigest: sha256({ operation, impactPaths }) as `sha256:${string}`,
      impactPaths,
      expires: 'callback-settlement',
      active: true
    };
    authorizationPayloads.set(authorization, payload);
    try {
      return await authorizationContext.run(authorization, () => execute(authorization));
    } finally {
      payload.active = false;
    }
  });
}

export function currentProjectWriteAuthorization(): ProjectWriteAuthorization | null {
  const authorization = authorizationContext.getStore();
  return authorization !== undefined && authorization !== PREPARING_AUTHORIZATION
    && authorizationPayloads.get(authorization)?.active === true ? authorization : null;
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
