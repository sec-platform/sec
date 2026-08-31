import path from 'node:path';

import { inspectNoFollowDirectoryChain, PhysicalNoFollowError, readNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolvePathInside } from '../../workspace/paths.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import {
  evaluateCustomSlotCapabilityObservation,
  type SlotCapabilityObservation
} from './slot-capability-contract.ts';
import {
  observeTypeScriptSlotCapabilities,
  SlotCapabilityTypeScriptProviderError
} from './slot-capability-typescript-provider.ts';

interface ActiveSlotSource {
  readonly bytes: Uint8Array;
  readonly path: string;
}

function lintFailure(code: string, message: string, details: Record<string, unknown> = {}): CompilerError {
  return new CompilerError(
    code,
    `${message} The direct capability authoring check fails closed; this result is not transitive-effect or physical-security proof.`,
    details
  );
}

function activeSlotTasks(lock: LockFile) {
  return lock.slotTasks.filter((task) => task.status === 'filled' || task.status === 'verified');
}

function inspectActiveSlotSource(workspaceRoot: string, task: LockFile['slotTasks'][number]): ActiveSlotSource {
  if (!task.sourcePath && task.provenanceHints.generator !== null) {
    throw lintFailure(
      'SLOT-LINT-001',
      `Workspace-authored Slot "${task.id}" has no sourcePath.`,
      { slotId: task.id, reason: 'missing-source-path' }
    );
  }
  const sourcePath = task.sourcePath ?? task.target;
  const fullPath = resolvePathInside(workspaceRoot, sourcePath);
  if (!fullPath) {
    throw lintFailure(
      'SLOT-LINT-001',
      `Active Slot "${task.id}" sourcePath escapes the workspace.`,
      { slotId: task.id, sourcePath, reason: 'source-path-escape' }
    );
  }
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(fullPath),
      `Slot ${task.id} source parent`
    ).target;
    const bytes = readNoFollowOrdinaryFile(parent, path.basename(fullPath));
    if (bytes === null) {
      throw lintFailure(
        'SLOT-LINT-001',
        `Active Slot "${task.id}" source is missing or is not one ordinary file.`,
        { slotId: task.id, sourcePath, reason: 'non-ordinary-source-file' }
      );
    }
    return Object.freeze({ bytes, path: fullPath });
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    if (error instanceof PhysicalNoFollowError) {
      throw lintFailure(
        'SLOT-LINT-001',
        `Active Slot "${task.id}" source cannot be retained without following links.`,
        { slotId: task.id, sourcePath, reason: error.code }
      );
    }
    throw error;
  }
}

function decodeSlotSource(source: ActiveSlotSource): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  } catch (error) {
    throw lintFailure(
      'SLOT-LINT-001',
      `Custom Slot source "${source.path}" is not exact UTF-8.`,
      {
        source: source.path,
        reason: 'invalid-utf8',
        cause: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

function rejectionMessage(observation: SlotCapabilityObservation, relativeName: string): string {
  if (observation.kind === 'runtime-global') {
    if (observation.syntax === 'call') {
      return `Effectful global function "${observation.capability}()" is not authorized in Custom Slot file "${relativeName}".`;
    }
    if (observation.syntax === 'constructor') {
      return `Effectful global constructor "${observation.capability}" is not authorized in Custom Slot file "${relativeName}".`;
    }
    if (observation.syntax === 'root') {
      return `Runtime capability root "${observation.capability}" is not authorized in Custom Slot file "${relativeName}".`;
    }
    return `Runtime capability identifier "${observation.capability}" is not authorized in Custom Slot file "${relativeName}".`;
  }
  const target = observation.moduleSpecifier;
  if (target === null) {
    return observation.syntax === 'require'
      ? `Dynamic require() without one literal target was found in Custom Slot file "${relativeName}".`
      : observation.syntax === 'dynamic-import'
        ? `Dynamic import() without one literal target was found in Custom Slot file "${relativeName}".`
        : `Import-equals declaration "${observation.text}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`;
  }
  if (observation.syntax === 'require') {
    return `Runtime require("${target}") in Custom Slot file "${relativeName}" is not authorized.`;
  }
  if (observation.syntax === 'dynamic-import') {
    return `Dynamic runtime import("${target}") in Custom Slot file "${relativeName}" is not authorized.`;
  }
  if (observation.syntax === 'reexport') {
    return `Runtime re-export "${target}" in Custom Slot file "${relativeName}" is not authorized.`;
  }
  return `Runtime import "${target}" in Custom Slot file "${relativeName}" is not authorized.`;
}

/**
 * Retains exact Custom Slot source bytes, obtains tool-owned TypeScript facts,
 * and evaluates them against the SEC-owned direct-acquisition intent. A pass
 * proves only that this finite policy observed no prohibited direct host
 * acquisition; it is not sandbox, capability-port, transitive-dependency,
 * effect, or physical-security evidence.
 */
export async function checkSlotDirectCapabilities(workspaceRoot: string, lock: LockFile): Promise<void> {
  const activeSlotSources = activeSlotTasks(lock).map((task) =>
    inspectActiveSlotSource(workspaceRoot, task));
  if (activeSlotSources.length === 0) return;
  let observations;
  try {
    observations = observeTypeScriptSlotCapabilities(activeSlotSources.map((source) => ({
      path: source.path,
      text: decodeSlotSource(source)
    })));
  } catch (error) {
    if (!(error instanceof SlotCapabilityTypeScriptProviderError)) throw error;
    throw lintFailure(
      'SLOT-LINT-001',
      `Custom Slot TypeScript observation failed: ${error.message}`,
      { source: error.source, reason: error.reason }
    );
  }
  for (const observation of observations.observations) {
    const decision = evaluateCustomSlotCapabilityObservation(observation);
    if (decision.status === 'allowed') continue;
    const relativeName = path.relative(workspaceRoot, observation.source);
    throw lintFailure(
      decision.code,
      rejectionMessage(observation, relativeName),
      {
        source: relativeName,
        ...(observation.kind === 'runtime-global'
          ? { capability: observation.capability }
          : { moduleSpecifier: observation.moduleSpecifier }),
        reason: decision.reason
      }
    );
  }
}
