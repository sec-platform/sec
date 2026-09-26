import path from 'node:path';

import { FailureError } from '../contracts/failure.ts';

declare const isolatedVerificationCapabilityBrand: unique symbol;

export interface IsolatedVerificationCapability {
  readonly [isolatedVerificationCapabilityBrand]: true;
}

const workspaceRootsByCapability = new WeakMap<object, string>();

function exactWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

/**
 * Verification-internal authority. This factory is intentionally absent from
 * every public facade; trusted runners mint only after establishing their own
 * isolation boundary.
 */
export function mintIsolatedVerificationCapability(
  workspaceRoot: string
): IsolatedVerificationCapability {
  const capability = Object.freeze(Object.create(null)) as IsolatedVerificationCapability;
  workspaceRootsByCapability.set(capability as object, exactWorkspaceRoot(workspaceRoot));
  return capability;
}

export function assertIsolatedVerificationCapability(
  workspaceRoot: string,
  value: unknown
): asserts value is IsolatedVerificationCapability {
  if (!value || typeof value !== 'object' ||
    workspaceRootsByCapability.get(value) !== exactWorkspaceRoot(workspaceRoot)) {
    throw new FailureError(
      'VERIFY-ISOLATION-001',
      'Isolated Verification capability is not bound to the exact workspace root'
    );
  }
}
