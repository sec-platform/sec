import path from 'node:path';

import {
  resolveInstalledTypeScriptNativeChecker
} from './index.ts';

export const TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH =
  'src/toolchain/typescript/canary.ts' as const;

function resolveBaseFromArguments(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--resolve-from' || args[1]!.length === 0) {
    throw new Error('TypeCheck Provider canary requires exactly --resolve-from <directory>');
  }
  return path.resolve(args[1]!);
}

/**
 * Resolve the package through the runtime under test, then ask the canonical
 * provider owner to describe that exact installation. Keeping this program in
 * a checked module prevents trusted-runtime probes from embedding a second,
 * compiler-invisible copy of the provider API.
 */
export async function observeTypecheckProviderCanary(
  resolveFrom: string
): Promise<Awaited<ReturnType<typeof resolveInstalledTypeScriptNativeChecker>>> {
  return await resolveInstalledTypeScriptNativeChecker(
    path.join(path.resolve(resolveFrom), 'node_modules')
  );
}

if (import.meta.main) {
  const checker = await observeTypecheckProviderCanary(
    resolveBaseFromArguments(process.argv.slice(2))
  );
  process.stdout.write(JSON.stringify(checker.provider));
}
