import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatedStateDigest } from '../../src/runtime-state/generated-state/contract.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { canonicalJson } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import { formatJsonFile } from '../../src/workspace/files.ts';
import { runtimeDependencyOperationControls } from '../../src/toolchain/dependencies/runtime/operation-controls.ts';
import { generatedStatePhysicalIdentity, runtimeDependencySourceGenerationEpoch,
  DEPENDENCY_TRANSITION_SCHEMA, type DependencyTransitionUnsigned, type DependencyTransitionJournal } from '../../src/toolchain/dependencies/runtime/dependency-transition/contract.ts';
import { dependencyTransitionRecordBytes, dependencyTransitionDigestWithoutRecord, transitionRecordName,
  parseDependencyTransitionRecord } from '../../src/toolchain/dependencies/runtime/dependency-transition/codec.ts';
import { dependencyTransitionNamespacePaths, dependencyTransitionLedgerDigest } from '../../src/toolchain/dependencies/runtime/dependency-transition/store.ts';
import type { DependencyTransitionRolloverIntent } from '../../src/toolchain/dependencies/runtime/dependency-transition/rollover.ts';

/** Deliberately constructs persisted protocol inputs, not an authorization or a
 * replacement parser. Recovery revalidates their exact bytes and physical roots.
 * Native runs retain actual physical/codec owners; local replay declares adapters.
 */
export function createRolloverFixture(recordCount = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-rollover-recovery-'));
  const paths = dependencyTransitionNamespacePaths(root);
  fs.mkdirSync(paths.recordsRoot, { recursive: true }); fs.mkdirSync(paths.rolloversRoot, { recursive: true });
  const sourcePath = path.join(root, 'source'); fs.mkdirSync(sourcePath);
  const physical = (p: string) => generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(p, 'test input').target);
  const ownerRootPhysical = physical(root), sourceRecordsRootPhysical = physical(paths.recordsRoot);
  const sourceInput = { ownerRoot: root, ownerRootPhysical, physical: physical(sourcePath),
    bindingDigest: generatedStateDigest('binding'), treeDigest: generatedStateDigest('source'), treeEntryCount: 0 };
  const sourceGeneration = { schema: 'sec-runtime-dependency-source-generation-v1' as const, ...sourceInput,
    sourcePath, epoch: runtimeDependencySourceGenerationEpoch(sourceInput) };
  const absent = { path: path.join(root, 'node_modules'), kind: 'absent' as const, physical: null, linkTarget: null, bindingDigest: null };
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  let terminal!: DependencyTransitionJournal;
  for (let i = 0; i < recordCount; i++) {
    const unsigned: DependencyTransitionUnsigned = { schema: DEPENDENCY_TRANSITION_SCHEMA,
      previousRecordDigest: i ? terminal.recordDigest : null, sequence: i + 1,
      operationKey: generatedStateDigest({ sequence: i + 1 }), attemptNonce: `fixture-${i}`,
      kind: 'compiler-bridge', ownerRoot: root, ownerRootPhysical, destination: absent, preimage: absent,
      stage: null, stageRoot: null, backup: null, sourceGeneration, phase: 'complete', durability: 'known', failure: null };
    terminal = parseDependencyTransitionRecord(dependencyTransitionRecordBytes({ ...unsigned,
      recordDigest: dependencyTransitionDigestWithoutRecord(unsigned) }));
    records.set(terminal.recordDigest, terminal);
    fs.writeFileSync(path.join(paths.recordsRoot, transitionRecordName(terminal.recordDigest)), dependencyTransitionRecordBytes(terminal));
  }
  const ledgerDigest = dependencyTransitionLedgerDigest(records);
  const { recordDigest: _old, ...terminalWithoutDigest } = terminal;
  const checkpointInput: DependencyTransitionUnsigned = { ...terminalWithoutDigest, previousRecordDigest: null, sequence: 1,
    operationKey: generatedStateDigest({ schema: 'sec-dependency-transition-rollover-checkpoint-operation-v1',
      terminalRecordDigest: terminal.recordDigest, ledgerDigest }),
    attemptNonce: `rollover-checkpoint:${terminal.recordDigest.slice(7)}` };
  const checkpoint = parseDependencyTransitionRecord(dependencyTransitionRecordBytes({ ...checkpointInput,
    recordDigest: dependencyTransitionDigestWithoutRecord(checkpointInput) }));
  const schema = 'sec-dependency-transition-rollover-v1' as const;
  const stem = generatedStateDigest({ schema, previousIntentDigest: null, sequence: 1, ownerRoot: root,
    terminalRecordDigest: terminal.recordDigest, ledgerDigest, recordCount, checkpointDigest: checkpoint.recordDigest }).slice(7, 55);
  const stable = { schema, previousIntentDigest: null, sequence: 1, ownerRoot: root, ownerRootPhysical,
    recordsRootPath: paths.recordsRoot, sourceRecordsRootPhysical,
    retiredRecordsPath: path.join(paths.rolloversRoot, `records-retired-${stem}`),
    nextRecordsPath: path.join(paths.rolloversRoot, `records-next-${stem}`),
    terminalRecordDigest: terminal.recordDigest, ledgerDigest, recordCount, checkpointDigest: checkpoint.recordDigest };
  const { checkpointDigest: _digest, ...base } = stable;
  const prepared: DependencyTransitionRolloverIntent = { ...base, checkpoint, intentDigest: generatedStateDigest(stable),
    phase: 'prepared', retiredRecordsPhysical: null, retiredRecordsDisposed: false, nextRecordsPhysical: null,
    publishedRecordsRootPhysical: null };
  const receiptPath = (phase: string) => path.join(paths.rolloversRoot, `rollover-${prepared.intentDigest.slice(7)}-${phase}.json`);
  const writeReceipt = (value: DependencyTransitionRolloverIntent) => fs.writeFileSync(receiptPath(value.phase), formatJsonFile(canonicalJson(value)));
  writeReceipt(prepared);
  return { root, paths, records, terminal, checkpoint, prepared, receiptPath, writeReceipt,
    options: runtimeDependencyOperationControls({ lockTimeoutMs: 300_000 }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
