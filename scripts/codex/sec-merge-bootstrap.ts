#!/usr/bin/env bun
/**
 * SEC exact-head merge bootstrap.
 *
 * Frozen verification, durable recovery, exact-head merge and deterministic
 * branch/ref closeout are composed by focused contracts. The bootstrap never
 * patches the control plane after merge.
 */
export * from './sec-merge-bootstrap-contract.ts';
export * from './sec-merge-bootstrap-runtime.ts';

import { runMergeBootstrapCli } from './sec-merge-bootstrap-runtime.ts';

if (import.meta.main) {
  runMergeBootstrapCli();
}
