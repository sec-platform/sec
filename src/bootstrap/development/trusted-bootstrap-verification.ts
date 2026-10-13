import { createTrustedBootstrapCapture } from '../../adapters/verification/platform/trust/runtime/trusted-bootstrap-checker-native.ts';
import { runTrustedBootstrapVerification } from '../../application/trusted-bootstrap-verification.ts';

/** Bind the original native issuers to the application phase sequence. The
 * capture publishes only after its own completed stage history is verified. */
export async function executeTrustedBootstrapVerification(): Promise<Readonly<Record<string, unknown>>> {
  const capture = await createTrustedBootstrapCapture();
  const prepared = await runTrustedBootstrapVerification(capture.facts, capture.ports);
  return capture.publish(prepared);
}

if (import.meta.main) {
  await executeTrustedBootstrapVerification();
}
