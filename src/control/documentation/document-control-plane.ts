import { runDocumentControlPlaneCli } from '../../adapters/self-hosting/control/documentation/document-control-plane.ts';

/** Stable control-plane CLI address retained across physical module moves.
 * The self-hosting documentation adapter remains the sole capability/domain
 * owner; this file mints no provider, writer, schema or recovery authority. */
if (import.meta.main) {
  await runDocumentControlPlaneCli();
}
