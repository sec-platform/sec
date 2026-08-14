#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { executeWorktreePhysicalCloseoutV1, type ExecuteWorktreePhysicalCloseoutInputV1 } from '../../scripts/codex/worktree-physical-closeout.ts';

const encoded = process.argv[2];
if (encoded === undefined) throw new Error('closeout crash fixture requires one JSON argument');
const input = JSON.parse(encoded) as ExecuteWorktreePhysicalCloseoutInputV1;
const mode = process.argv[4] ?? 'execute';
const handshakePath = process.argv[5];
if (mode !== 'execute' && mode !== 'pause-after-fence-before-terminal') {
  throw new Error('closeout crash fixture mode is invalid');
}
if (mode === 'pause-after-fence-before-terminal') {
  if (handshakePath === undefined) throw new Error('transition crash fixture requires a handshake path');
  // This timer lives exclusively in the test executable.  It observes the
  // durable public shape produced by the normal engine, then blocks this
  // child after the acquisition fence and before terminal publication. Production modules have
  // no environment switch, callback, or exported fault injection surface.
  const authorization = JSON.parse(readFileSync(input.authorizationPath, 'utf8')) as { proofRoot?: { path?: unknown }; target?: { path?: unknown } };
  if (typeof authorization.proofRoot?.path !== 'string' || typeof authorization.target?.path !== 'string') throw new Error('transition crash fixture authorization lacks proof root or target');
  const proofRoot = authorization.proofRoot.path;
  const fenceParent = path.dirname(authorization.target.path);
  const blocker = new Int32Array(new SharedArrayBuffer(4));
  const watcher = setInterval(() => {
    if (!existsSync(proofRoot) || existsSync(handshakePath)) return;
    const entries = readdirSync(proofRoot);
    const transition = entries.some((name) => /^\.workspace-write-lease-transition-[0-9a-f]{64}\.json$/u.test(name));
    const relocatedNamespace = entries.some((name) => /^workspace-write-lease-retired-namespace-[0-9a-f]{64}$/u.test(name));
    const fencePresent = readdirSync(fenceParent).some((name) => /^\.workspace-write-lease-retired-[0-9a-f]{64}\.json$/u.test(name));
    if (transition && !relocatedNamespace && fencePresent) {
      writeFileSync(handshakePath, `${JSON.stringify({ stage: 'acquisition-fence-durable-terminal-pending', proofRoot: path.resolve(proofRoot) })}\n`, { encoding: 'utf8', flag: 'wx' });
      Atomics.wait(blocker, 0, 0, 60_000);
    }
  }, 1);
  watcher.unref();
}
const receipt = await executeWorktreePhysicalCloseoutV1(input);
const outputPath = process.argv[3];
if (outputPath === undefined) throw new Error('closeout crash fixture requires one output path');
writeFileSync(outputPath, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', flag: 'wx' });
// The fixture deliberately models a process boundary.  Exit only after the
// durable result file is closed so module timers cannot turn a completed
// operation into an opaque test timeout.
process.exit(0);
