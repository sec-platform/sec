import { ensureSharedDepsReady } from '../../platform/shared/project-runtime.ts';

export default async function prewarmSharedRuntimeDeps(): Promise<void> {
  await ensureSharedDepsReady();
}
