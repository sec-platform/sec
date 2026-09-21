import { compareCodeUnits } from '../contracts/canonical.ts';

export type LockInspectProjectionSource = Readonly<{
  app: Readonly<{
    name: string;
    stack: string;
    mode: string;
  }>;
  resolvedBlocks: readonly Readonly<{
    id: string;
    version: string;
    installOrder: number;
  }>[];
  generatedPaths: readonly unknown[];
  acceptancePlan: readonly unknown[];
  passStatus: Readonly<Record<string, string | undefined>>;
}>;

export type LockInspectView = Readonly<{
  appName: string;
  stack: string;
  mode: string;
  blockCount: number;
  generatedCount: number;
  acceptanceCount: number;
  blockOrder: readonly string[];
  passStates: readonly string[];
}>;

export function projectLockInspect(source: LockInspectProjectionSource): LockInspectView {
  const blockOrder = [...source.resolvedBlocks]
    .sort((left, right) =>
      left.installOrder - right.installOrder || compareCodeUnits(left.id, right.id)
    )
    .map((block) => `${block.installOrder}:${block.id}@${block.version}`);
  const passStates = Object.values(source.passStatus)
    .filter((state): state is string => state !== undefined);

  return {
    appName: source.app.name,
    stack: source.app.stack,
    mode: source.app.mode,
    blockCount: source.resolvedBlocks.length,
    generatedCount: source.generatedPaths.length,
    acceptanceCount: source.acceptancePlan.length,
    blockOrder,
    passStates
  };
}
