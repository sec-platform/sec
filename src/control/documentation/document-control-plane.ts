import { runDocumentControlPlaneCli } from '../../adapters/self-hosting/control/documentation/document-control-plane.ts';

/** Stable CLI address. The self-hosting documentation adapter owns execution. */
if (import.meta.main) {
  await runDocumentControlPlaneCli();
}
