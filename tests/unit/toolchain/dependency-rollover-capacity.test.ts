import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dependencyTransitionRecordBytes, transitionRecordName } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import {
  DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER,
  inspectActiveDependencyTransitionRollover,
  rolloverDependencyTransitionLedger
} from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/rollover.ts';
import { dependencyTransitionLedgerDigest, inspectDependencyTransitionNamespace } from '../../../src/adapters/toolchain/dependencies/runtime/dependency-transition/store.ts';
import { createRolloverFixture } from '../../helpers/rollover-fixture.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

// Uses the real canonical trigger, not an injected smaller capacity. Local
// replay still uses declared physical/store adapters; this is not a benchmark
// or native durability evidence. The complete operation and codec remain real.
test('normal capacity rollover enters the common recovery path and publishes exactly its terminal checkpoint', async () => {
  const f = createRolloverFixture(DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER);
  return settleWorkspaceCallback(async () => {
    fs.unlinkSync(f.receiptPath('prepared'));
    fs.mkdirSync(f.paths.backupRoot, { recursive: true });
    const namespace = inspectDependencyTransitionNamespace(f.root)!;
    const ledger = Object.freeze({ namespace, records: f.records,
      ledgerDigest: dependencyTransitionLedgerDigest(f.records), tip: f.terminal });
    const checkpoint = await rolloverDependencyTransitionLedger(f.root, ledger, f.terminal, f.options);
    assert.equal(checkpoint.recordDigest, f.checkpoint.recordDigest);
    const after = await inspectActiveDependencyTransitionRollover(f.root, f.options);
    assert.equal(after?.active, null); assert.equal(after?.latestComplete?.phase, 'complete');
    assert.deepEqual(fs.readdirSync(f.paths.recordsRoot), [transitionRecordName(checkpoint.recordDigest)]);
    assert.deepEqual(fs.readFileSync(path.join(f.paths.recordsRoot, transitionRecordName(checkpoint.recordDigest))), dependencyTransitionRecordBytes(checkpoint));
    assert.ok(Object.isFrozen(checkpoint.sourceGeneration.physical));
    assert.equal(fs.existsSync(f.prepared.retiredRecordsPath), false);
    assert.equal(fs.existsSync(f.prepared.nextRecordsPath), false);
  }, async () => f.cleanup());
}, 240_000);
