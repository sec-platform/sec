import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { getErrorCode } from '../../../../compiler/errors.ts';
import { sortedKeys } from '../../../../compiler/semantic-mutation/canonical.ts';

const SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT =
  'semantic-mutation-isolated-phase-telemetry-v1' as const;

export const ISOLATED_PHASES = Object.freeze([
  'source-snapshot-revalidate',
  'source-snapshot-capture',
  'source-snapshot-single-flight-wait',
  'runtime-materialize',
  'compile-workspace',
  'runtime-test-discovery',
  'runtime-dependency-validation',
  'runtime-process-environment-materialize',
  'runtime-staging-tree-validation',
  'unit'
] as const);

export type IsolatedPhase =
  (typeof ISOLATED_PHASES)[number];
type SemanticMutationIsolatedPhaseState = 'started' | 'completed';

interface SemanticMutationIsolatedPhaseTelemetryEvent {
  readonly formatVersion: typeof SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT;
  readonly phase: IsolatedPhase;
  readonly state: SemanticMutationIsolatedPhaseState;
  readonly durationMs: number;
}

export type IsolatedPhaseTelemetryReadResult =
  | Readonly<{
      readonly status: 'valid';
      readonly events: readonly SemanticMutationIsolatedPhaseTelemetryEvent[];
    }>
  | Readonly<{ readonly status: 'protocol-error' | 'read-error' }>;

const SNAPSHOT_PHASES = new Set<IsolatedPhase>([
  'source-snapshot-revalidate',
  'source-snapshot-capture',
  'source-snapshot-single-flight-wait'
]);
const STATES = new Set<SemanticMutationIsolatedPhaseState>(['started', 'completed']);
const MAX_EVENT_BYTES = 256;

function telemetryRoot(stagingWorkspaceRoot: string): string {
  return path.join(path.resolve(stagingWorkspaceRoot), '.isolated-process', 'phase-telemetry');
}

function telemetryFileName(
  phase: IsolatedPhase,
  state: SemanticMutationIsolatedPhaseState,
  pending = false
): string {
  return `${pending ? '.' : ''}${phase}-${state}.json`;
}

function telemetryPath(
  stagingWorkspaceRoot: string,
  phase: IsolatedPhase,
  state: SemanticMutationIsolatedPhaseState,
  pending = false
): string {
  return path.join(telemetryRoot(stagingWorkspaceRoot), telemetryFileName(phase, state, pending));
}

function eventBytes(event: SemanticMutationIsolatedPhaseTelemetryEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = getErrorCode(error);
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function publishEvent(
  stagingWorkspaceRoot: string,
  event: SemanticMutationIsolatedPhaseTelemetryEvent
): Promise<void> {
  try {
    const root = telemetryRoot(stagingWorkspaceRoot);
    await mkdir(root, { recursive: true });
    const finalPath = telemetryPath(stagingWorkspaceRoot, event.phase, event.state);
    const pendingPath = telemetryPath(stagingWorkspaceRoot, event.phase, event.state, true);
    const bytes = eventBytes(event);
    let pendingOwned = false;
    try {
      const handle = await open(pendingPath, 'wx', 0o600);
      pendingOwned = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(pendingPath, finalPath);
      pendingOwned = false;
      await fsyncDirectory(root);
    } finally {
      if (pendingOwned) await rm(pendingPath, { force: true }).catch(() => undefined);
    }
  } catch {
    // Telemetry is deliberately non-authoritative and cannot alter execution.
  }
}

export async function withSemanticMutationIsolatedPhaseTelemetry<T>(
  stagingWorkspaceRoot: string,
  phase: IsolatedPhase,
  execute: () => Promise<T>
): Promise<T> {
  await publishEvent(stagingWorkspaceRoot, {
    formatVersion: SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT,
    phase,
    state: 'started',
    durationMs: 0
  });
  const startedAt = globalThis.performance.now();
  try {
    return await execute();
  } finally {
    await publishEvent(stagingWorkspaceRoot, {
      formatVersion: SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT,
      phase,
      state: 'completed',
      durationMs: Math.max(0, Math.round(globalThis.performance.now() - startedAt))
    });
  }
}

async function resetPhases(
  stagingWorkspaceRoot: string,
  phases: readonly IsolatedPhase[]
): Promise<void> {
  try {
    await Promise.all(phases.flatMap((phase) => [...STATES].flatMap((state) => [
      rm(telemetryPath(stagingWorkspaceRoot, phase, state), { force: true }),
      rm(telemetryPath(stagingWorkspaceRoot, phase, state, true), { force: true })
    ])));
  } catch {
    // Cleanup is also best-effort; stale telemetry must never block execution.
  }
}

export async function resetSemanticMutationIsolatedPhaseTelemetry(
  stagingWorkspaceRoot: string
): Promise<void> {
  await resetPhases(stagingWorkspaceRoot, ISOLATED_PHASES);
}

export async function resetSemanticMutationIsolatedExecutionPhaseTelemetry(
  stagingWorkspaceRoot: string
): Promise<void> {
  await resetPhases(
    stagingWorkspaceRoot,
    ISOLATED_PHASES.filter((phase) => !SNAPSHOT_PHASES.has(phase))
  );
}

function parseEvent(
  bytes: Uint8Array,
  expectedPhase: IsolatedPhase,
  expectedState: SemanticMutationIsolatedPhaseState
): SemanticMutationIsolatedPhaseTelemetryEvent | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVENT_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = sortedKeys(record);
  if (keys.length !== 4 || keys[0] !== 'durationMs' || keys[1] !== 'formatVersion' ||
    keys[2] !== 'phase' || keys[3] !== 'state' ||
    record.formatVersion !== SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT ||
    record.phase !== expectedPhase || record.state !== expectedState ||
    !Number.isSafeInteger(record.durationMs) || Number(record.durationMs) < 0 ||
    (expectedState === 'started' && record.durationMs !== 0)) {
    return undefined;
  }
  return Object.freeze({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_PHASE_TELEMETRY_FORMAT,
    phase: expectedPhase,
    state: expectedState,
    durationMs: Number(record.durationMs)
  });
}

async function readOptionalEvent(
  filePath: string,
  expectedPhase: IsolatedPhase,
  expectedState: SemanticMutationIsolatedPhaseState
): Promise<SemanticMutationIsolatedPhaseTelemetryEvent | 'absent' | 'read-error' | 'protocol-error'> {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch (error) {
    return getErrorCode(error) === 'ENOENT' ? 'absent' : 'read-error';
  }
  try {
    const buffer = Buffer.alloc(MAX_EVENT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > MAX_EVENT_BYTES) return 'protocol-error';
    return parseEvent(new Uint8Array(buffer.subarray(0, bytesRead)), expectedPhase, expectedState) ??
      'protocol-error';
  } catch {
    return 'read-error';
  } finally {
    try {
      await handle.close();
    } catch {
      // The read result remains diagnostic-only.
    }
  }
}

export async function readSemanticMutationIsolatedPhaseTelemetry(
  stagingWorkspaceRoot: string
): Promise<IsolatedPhaseTelemetryReadResult> {
  try {
    const names = await readdir(telemetryRoot(stagingWorkspaceRoot));
    const ownedNames = new Set(ISOLATED_PHASES.flatMap((phase) =>
      [...STATES].flatMap((state) => [
        telemetryFileName(phase, state),
        telemetryFileName(phase, state, true)
      ])
    ));
    if (names.some((name) => !ownedNames.has(name))) {
      return { status: 'protocol-error' };
    }
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return { status: 'valid', events: Object.freeze([]) };
    return { status: 'read-error' };
  }

  const events: SemanticMutationIsolatedPhaseTelemetryEvent[] = [];
  for (const phase of ISOLATED_PHASES) {
    const started = await readOptionalEvent(
      telemetryPath(stagingWorkspaceRoot, phase, 'started'),
      phase,
      'started'
    );
    if (started === 'read-error') return { status: 'read-error' };
    if (started === 'protocol-error') return { status: 'protocol-error' };
    const completed = await readOptionalEvent(
      telemetryPath(stagingWorkspaceRoot, phase, 'completed'),
      phase,
      'completed'
    );
    if (completed === 'read-error') return { status: 'read-error' };
    if (completed === 'protocol-error' || (completed !== 'absent' && started === 'absent')) {
      return { status: 'protocol-error' };
    }
    if (started !== 'absent') events.push(started);
    if (completed !== 'absent') events.push(completed);
  }
  return { status: 'valid', events: Object.freeze(events) };
}

export function isolatedPhaseTelemetryOwnedPaths(
  stagingWorkspaceRoot: string
): readonly string[] {
  return Object.freeze(ISOLATED_PHASES.flatMap((phase) =>
    [...STATES].flatMap((state) => [
      telemetryPath(stagingWorkspaceRoot, phase, state),
      telemetryPath(stagingWorkspaceRoot, phase, state, true)
    ])
  ));
}
