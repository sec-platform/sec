import path from 'node:path';

import {
  requireSelectedTypeScriptNativeChecker,
  selectInstalledTypeScriptNativeChecker
} from './checker.ts';

export const TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH =
  'src/adapters/toolchain/typescript/canary.ts' as const;

function resolveBaseFromArguments(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--resolve-from' || args[1]!.length === 0) {
    throw new Error('TypeCheck Provider canary requires exactly --resolve-from <directory>');
  }
  return path.resolve(args[1]!);
}

if (import.meta.main) {
  const checker = requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(path.join(
      resolveBaseFromArguments(process.argv.slice(2)),
      'node_modules'
    ))
  );
  process.stdout.write(JSON.stringify(checker.provider));
}
