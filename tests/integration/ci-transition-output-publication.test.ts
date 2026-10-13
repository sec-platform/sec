import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PhysicalNoFollowError } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { publishSourceProgramTransitionOutput } from '../../src/adapters/verification/platform/ci/verification-cli.ts';

function transitionOutputOptions(root: string, stdout: Buffer, beforeReturn: () => void = () => {}) {
  let transitionRuns = 0;
  const evidencePath = path.join(root, 'configured-output', 'evidence.json');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  return {
    evidencePath,
    transitionRuns: () => transitionRuns,
    execute: async () => {
      transitionRuns += 1;
      beforeReturn();
      return { result: { code: 0, rawOutputDigest: '', failureTail: '', stdout } };
    }
  };
}

async function runTransitionOutput(options: ReturnType<typeof transitionOutputOptions>) {
  try {
    const settled = await publishSourceProgramTransitionOutput(options.evidencePath, options.execute);
    return { code: settled.result.code, error: null };
  } catch (error) {
    return { code: 1, error };
  } finally {
    expect(options.transitionRuns()).toBe(1);
  }
}

test('CI transition output publishes exact stdout at the configured destination with read-only permissions', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-bytes-'));
  try {
    const stdout = Buffer.from([0x20, 0x7b, 0x0a, 0x00, 0xff, 0xc3, 0x28, 0x0d, 0x0a]);
    const options = transitionOutputOptions(root, stdout);
    expect((await runTransitionOutput(options)).code).toBe(0);
    const output = path.join(path.dirname(options.evidencePath), SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE);
    expect(readFileSync(output)).toEqual(stdout);
    if (process.platform !== 'win32') expect(statSync(output).mode & 0o777).toBe(0o400);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const existing of ['same', 'different'] as const) {
  test(`CI transition output rejects an existing ${existing}-byte leaf without replacing it`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-exclusive-'));
    try {
      const stdout = Buffer.from('{"result":"captured"}\n');
      const options = transitionOutputOptions(root, stdout);
      const output = path.join(path.dirname(options.evidencePath), SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE);
      const original = existing === 'same' ? stdout : Buffer.from('pre-existing output');
      writeFileSync(output, original, { mode: 0o400 });
      const identity = statSync(output, { bigint: true });
      const result = await runTransitionOutput(options);
      expect(result.code).toBe(1);
      expect(result.error).toBeInstanceOf(PhysicalNoFollowError);
      const error = result.error as PhysicalNoFollowError;
      if (process.platform === 'win32' && existing === 'same') {
        // A read-only existing file can be rejected before canonical reuse.
        expect(error.code).toBe('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
      } else {
        expect(error.code).toBe('PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT');
      }
      expect(readFileSync(output)).toEqual(original);
      expect(statSync(output, { bigint: true }).ino).toBe(identity.ino);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const replacement of ['directory', 'symlink'] as const) {
  test(`CI transition output rejects its parent being replaced by a ${replacement} during execution`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-output-parent-'));
    try {
      const parent = path.join(root, 'configured-output');
      const saved = path.join(root, 'saved-output');
      const redirected = path.join(root, 'redirected-output');
      mkdirSync(redirected);
      const options = transitionOutputOptions(root, Buffer.from('captured stdout'), () => {
        renameSync(parent, saved);
        if (replacement === 'directory') mkdirSync(parent);
        else symlinkSync(redirected, parent, process.platform === 'win32' ? 'junction' : 'dir');
      });
      const result = await runTransitionOutput(options);
      expect(result.code).toBe(1);
      expect(result.error).toBeInstanceOf(PhysicalNoFollowError);
      expect(['PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'])
        .toContain((result.error as PhysicalNoFollowError).code);
      for (const directory of [parent, saved, redirected]) {
        expect(existsSync(path.join(directory, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
