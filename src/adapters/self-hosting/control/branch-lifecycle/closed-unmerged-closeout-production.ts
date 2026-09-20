import { createHash } from 'node:crypto';

import {
  resolveWindowsControlCliSession,
  type WindowsControlCliSessionResolutionReason
} from '../../../providers/windows-control-cli/runtime/session.ts';
import type {
  ClosedUnmergedCloseoutEffectProvider
} from './closed-unmerged-closeout.ts';

export type ProductionClosedUnmergedCloseoutProviderResolution =
  | Readonly<{
      status: 'ready';
      provider: ClosedUnmergedCloseoutEffectProvider;
    }>
  | Readonly<{
      status: 'unsupported' | 'unavailable' | 'unknown';
      reason: WindowsControlCliSessionResolutionReason
        | 'semantic-effect-provider-unavailable'
        | 'session-close-failed';
      detailDigest: `sha256:${string}`;
    }>;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function failure(
  status: 'unsupported' | 'unavailable' | 'unknown',
  reason: WindowsControlCliSessionResolutionReason
    | 'semantic-effect-provider-unavailable'
    | 'session-close-failed',
  detail: unknown
): ProductionClosedUnmergedCloseoutProviderResolution {
  return Object.freeze({ status, reason, detailDigest: digest(detail) });
}

/**
 * Production admission for the one closed-unmerged GitHub/Git Effect provider.
 *
 * The current Windows external capability proves retained physical CLI bytes,
 * but deliberately exposes no command method.  The only existing semantic
 * Git/GitHub ref-effect implementation is private to merged VerificationSession
 * closeout and cannot authorize a closed-unmerged operation.  Therefore this
 * resolver must return a typed unavailable result before any PATH lookup,
 * child process, GitHub mutation, recovery write, or branch-lifecycle read.
 */
export async function resolveProductionClosedUnmergedCloseoutEffectProvider(input: Readonly<{
  repositoryRoot: string;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<ProductionClosedUnmergedCloseoutProviderResolution> {
  if (process.platform !== 'win32') {
    return failure('unsupported', 'unsupported-platform', {
      boundary: 'closed-unmerged-semantic-effect-provider',
      platform: process.platform
    });
  }
  const resolution = resolveWindowsControlCliSession({
    workingDirectoryPathHint: input.repositoryRoot,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    signal: input.signal,
    maxRootObservedBytes: 128 * 1024 * 1024,
    maxExecutableObservedBytes: 128 * 1024 * 1024,
    maxRecords: 256,
    maxCloseSettlementAttempts: 1
  });
  if (resolution.status !== 'ready') {
    return failure(resolution.status, resolution.reason, {
      boundary: 'closed-unmerged-windows-control-cli-admission',
      providerDetailDigest: resolution.detailDigest
    });
  }
  try {
    const terminal = await resolution.session.close();
    return failure('unavailable', 'semantic-effect-provider-unavailable', {
      boundary: 'closed-unmerged-semantic-effect-provider',
      physicalProviderRevision: resolution.session.providerRevision,
      terminalReceiptDigest: terminal.receiptDigest
    });
  } catch (error) {
    return failure('unknown', 'session-close-failed', {
      boundary: 'closed-unmerged-windows-control-cli-settlement',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
