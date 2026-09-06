import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';

type InstallResource = 'executable' | 'working-directory' | 'process-session';
type Release = Readonly<{ resource: InstallResource; run: () => void | PromiseLike<void> }>;
export type CompilerInstallResourceFailure = Readonly<{ resource: InstallResource; reason: unknown }>;

/** A failed release or session receipt is not optional telemetry. Resources may
 * already be partly released. Keep each failure and the exact execution cause. */
export class CompilerInstallSettlementFailure extends SecError {
  readonly primaryFailed: boolean;
  readonly resourceFailures: readonly CompilerInstallResourceFailure[];

  constructor(primary: Readonly<{ reason: unknown }> | undefined, failures: readonly CompilerInstallResourceFailure[]) {
    super('RUNTIME-DEPS-SETTLEMENT-001', 'Compiler dependency resource settlement did not complete',
      { primaryFailed: primary !== undefined, resources: failures.map(({ resource }) => resource) },
      primary === undefined ? undefined : { cause: primary.reason });
    this.name = 'CompilerInstallSettlementFailure';
    this.primaryFailed = primary !== undefined;
    this.resourceFailures = Object.freeze(failures.map((failure) => Object.freeze({ ...failure })));
  }
}

/** One install attempt owns its acquired handles, including partial acquisition.
 * Register immediately after acquisition. Release once in reverse order, even
 * when another release fails. This does not retry or claim physical disposal. */
export async function withCompilerInstallResources<T>(
  execute: (retain: (resource: InstallResource, release: () => void | PromiseLike<void>) => void) => Promise<T>
): Promise<T> {
  const releases: Release[] = [];
  let closed = false;
  let primary: Readonly<{ reason: unknown }> | undefined;
  let result!: T;
  try {
    result = await execute((resource, run) => {
      if (closed) throw new Error('Compiler install resource scope is closed');
      releases.push(Object.freeze({ resource, run }));
    });
  } catch (reason) { primary = Object.freeze({ reason }); }
  closed = true;
  const failures: CompilerInstallResourceFailure[] = [];
  for (let index = releases.length - 1; index >= 0; index -= 1) {
    const release = releases[index]!;
    try { await release.run(); }
    catch (reason) { failures.push({ resource: release.resource, reason }); }
  }
  if (failures.length > 0) throw new CompilerInstallSettlementFailure(primary, failures);
  if (primary !== undefined) throw primary.reason;
  return result;
}
