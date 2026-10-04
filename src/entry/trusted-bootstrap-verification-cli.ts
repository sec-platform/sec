import { materializeTrustedBootstrapCheckerProgram } from '../adapters/verification/platform/trust/runtime/trusted-bootstrap-checker-program.ts';

/** PRE-only source materialization entry. The resulting checker.mjs is the
 * only executable reused by POST; this command does not evaluate a candidate. */
export async function runTrustedBootstrapVerificationCli(argv: readonly string[]): Promise<void> {
  if (argv.length !== 3 || argv[0] !== 'materialize' || argv[1] !== '--output'
      || typeof argv[2] !== 'string' || argv[2].length === 0) {
    throw new Error('Trusted bootstrap checker materialization requires materialize --output <fixed PRE slot>.');
  }
  await materializeTrustedBootstrapCheckerProgram(argv[2]);
}

if (import.meta.main) {
  await runTrustedBootstrapVerificationCli(process.argv.slice(2));
}
