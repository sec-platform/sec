import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AuthorNativeMethodUnit } from '../../../../contracts/author-native-methods.ts';
import { assertNativeRuleSourceMembership, selectNativeExecutionMethods } from './native-source-membership.ts';

const prefix = 'crates/gift-author-kernel/src/';

function fixture(execute: (root: string, source: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-native-source-membership-'));
  const source = path.join(root, prefix);
  try {
    mkdirSync(path.join(source, 'nested'), { recursive: true });
    writeFileSync(path.join(source, 'lib.rs'), 'pub fn root() {}');
    writeFileSync(path.join(source, 'nested', 'future.rs'), 'pub fn added_module() {}');
    writeFileSync(path.join(source, 'notes.txt'), 'not compiled rule source');
    execute(root, source);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function admission(repositoryRoot: string) {
  return { repositoryRoot, issuedInputPaths: [`${prefix}nested/future.rs`, `${prefix}lib.rs`, 'package.json'],
    deadlineAtMs: performance.now() + 30_000, maximumEntries: 32 };
}

test('native admission matches the real fixed source domain and rejects unissued nested Rust bytes', () => {
  fixture((root, source) => {
    expect(() => assertNativeRuleSourceMembership(admission(root))).not.toThrow();
    mkdirSync(path.join(source, '.tmp'));
    const unexpected = path.join(source, '.tmp', 'unissued.rs');
    writeFileSync(unexpected, 'pub const UNISSUED: bool = true;');
    // The original source issuer may exclude this path. The physical guard
    // cannot silently add it to the issued positive set or ignore it.
    expect(() => assertNativeRuleSourceMembership(admission(root))).toThrow(`${prefix}.tmp/unissued.rs`);
    expect(readFileSync(unexpected, 'utf8')).toBe('pub const UNISSUED: bool = true;');
  });
});

test('caller method copies cannot add unissued bytes while keeping an original input digest', () => {
  fixture((root, source) => {
    const original: AuthorNativeMethodUnit = {
      id: 'cargo-tests', owner: 'adapters.compilation', phase: 'quick',
      inputs: admission(root).issuedInputPaths.map(sourcePath => ({ path: sourcePath, contentDigest: 'original' })),
      selectionPaths: [], absentLookupPaths: [], unresolvedInputs: [], inputClosureDigest: 'issued-digest'
    };
    const forged = { ...original, inputs: [...original.inputs, { path: `${prefix}unissued.rs`, contentDigest: 'forged' }] };
    writeFileSync(path.join(source, 'unissued.rs'), 'must not be authorized by the caller');
    const selected = selectNativeExecutionMethods([original], [forged]);
    expect(selected[0]).toBe(original);
    expect(() => assertNativeRuleSourceMembership({ ...admission(root),
      issuedInputPaths: selected.flatMap(method => method.inputs.map(input => input.path)) })).toThrow(`${prefix}unissued.rs`);
    expect(() => selectNativeExecutionMethods([original], [{ ...forged, inputClosureDigest: 'other' }])).toThrow();
    expect(() => selectNativeExecutionMethods([{ ...original, unresolvedInputs: ['missing.rs'] }], [forged])).toThrow();
  });
});

test('physical Rust names outside the issued path domain are rejected rather than silently skipped', () => {
  fixture((root, source) => {
    const nonCanonical = 'cafe\u0301.rs';
    writeFileSync(path.join(source, nonCanonical), 'must remain visible to the physical census');
    expect(() => assertNativeRuleSourceMembership(admission(root))).toThrow('cannot be represented by issued inputs');
  });
});

test('native admission rejects missing inputs and a same-name directory replacement', () => {
  fixture((root, source) => {
    const expected = path.join(source, 'nested', 'future.rs');
    rmSync(expected);
    expect(() => assertNativeRuleSourceMembership(admission(root))).toThrow(`${prefix}nested/future.rs`);
    mkdirSync(expected);
    expect(() => assertNativeRuleSourceMembership(admission(root))).toThrow(`${prefix}nested/future.rs`);
  });
});

test('native admission refuses directory links and does not follow foreign Rust members', () => {
  fixture((root, source) => {
    const outside = path.join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'foreign.rs'), 'foreign bytes');
    symlinkSync(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertNativeRuleSourceMembership(admission(root))).toThrow('contains a link');
    expect(readFileSync(path.join(outside, 'foreign.rs'), 'utf8')).toBe('foreign bytes');
  });
});

test('native source census consumes cancellation, the existing deadline and finite entry ceiling', () => {
  fixture(root => {
    expect(() => assertNativeRuleSourceMembership({ ...admission(root), deadlineAtMs: performance.now() - 1 })).toThrow();
    expect(() => assertNativeRuleSourceMembership({ ...admission(root), maximumEntries: 1 })).toThrow();
    const controller = new AbortController();
    controller.abort();
    expect(() => assertNativeRuleSourceMembership({ ...admission(root), signal: controller.signal })).toThrow();
  });
});
