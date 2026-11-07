import { expect, test } from 'bun:test';
import path from 'node:path';
import {
  assertRetainedRustupCompilerTools,
  parseRustupCompilerToolPath,
  retainRustupCompilerTools,
  rustupCompilerToolFailureHasPendingResources
} from './rustup-compiler-tools.ts';

test('Rustup which path parser accepts only its bounded single-line native path protocol', () => {
  const absolute = path.join(process.cwd(), 'private-protocol-fixture', 'cargo.exe');
  expect(parseRustupCompilerToolPath(Buffer.from(absolute))).toBe(absolute);
  expect(parseRustupCompilerToolPath(Buffer.from(`${absolute}\n`))).toBe(absolute);
  expect(parseRustupCompilerToolPath(Buffer.from(`${absolute}\r\n`))).toBe(absolute);
  for (const value of ['', 'cargo.exe', './cargo.exe', ` ${absolute}`, `${absolute} `,
    `${absolute}\n${absolute}\n`, `${absolute}\n\n`, `${absolute}\0`, `${absolute}\r`,
    `${absolute}\t`, path.join(process.cwd(), 'private-protocol-fixture') + `${path.sep}..${path.sep}cargo.exe`,
    path.parse(absolute).root]) {
    expect(() => parseRustupCompilerToolPath(Buffer.from(value))).toThrow();
  }
  expect(() => parseRustupCompilerToolPath(new Uint8Array([0xc3, 0x28]))).toThrow();
  expect(() => parseRustupCompilerToolPath(new Uint8Array(64 * 1024 + 1))).toThrow();
});

test('Rustup tool generations and pending failures cannot be reconstructed from paths or diagnostic fields', () => {
  const locator = parseRustupCompilerToolPath(Buffer.from(path.join(process.cwd(), 'cargo.exe')));
  expect(() => assertRetainedRustupCompilerTools({ cargo: { path: locator }, rustc: { path: locator },
    identityDigest: `sha256:${'a'.repeat(64)}`, assertCurrent() {}, retire() {} })).toThrow('original-issued');
  for (const error of [undefined, null, 'RUSTUP-COMPILER-TOOLS-PENDING',
    new Error('Rustup selection process-tree settlement is unproven'),
    { code: 'RUSTUP-COMPILER-TOOLS-PENDING', resources: { selector: locator, cwd: process.cwd() } }]) {
    expect(rustupCompilerToolFailureHasPendingResources(error)).toBe(false);
  }
});

test('Rustup selection rejects expired cancelled and absent-provider requests before tool selection', async () => {
  await expect(retainRustupCompilerTools({ repositoryRoot: process.cwd(), environment: { ...process.env },
    deadlineAtUnixMs: Date.now() - 1 })).rejects.toThrow('live absolute deadline');
  const controller = new AbortController();
  controller.abort(new Error('selection cancelled before admission'));
  await expect(retainRustupCompilerTools({ repositoryRoot: process.cwd(), environment: { ...process.env },
    deadlineAtUnixMs: Date.now() + 20_000, signal: controller.signal })).rejects.toThrow('selection cancelled before admission');
  await expect(retainRustupCompilerTools({ repositoryRoot: process.cwd(), environment: { PATH: '' },
    deadlineAtUnixMs: Date.now() + 20_000 })).rejects.toThrow('unavailable');
});

test('installed Rustup selects actual retained cargo and rustc with original terminal receipts and bounded lifetime', async () => {
  const environment = { ...process.env, RUSTUP_AUTO_INSTALL: '1' };
  const tools = await retainRustupCompilerTools({ repositoryRoot: process.cwd(), environment,
    deadlineAtUnixMs: Date.now() + 30_000 });
  try {
    assertRetainedRustupCompilerTools(tools);
    tools.assertCurrent();
    expect(environment.RUSTUP_AUTO_INSTALL).toBe('1');
    expect(Object.isFrozen(tools)).toBe(true);
    expect(tools.identityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(path.isAbsolute(tools.cargo.path)).toBe(true);
    expect(path.isAbsolute(tools.rustc.path)).toBe(true);
    expect(path.basename(tools.cargo.path)).toBe(process.platform === 'win32' ? 'cargo.exe' : 'cargo');
    expect(path.basename(tools.rustc.path)).toBe(process.platform === 'win32' ? 'rustc.exe' : 'rustc');
    expect(tools.cargo.digest().byteDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(tools.rustc.digest().byteDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(() => assertRetainedRustupCompilerTools({ ...tools })).toThrow('original-issued');
  } finally { tools.retire(); }
  expect(() => assertRetainedRustupCompilerTools(tools)).toThrow('live');
  expect(() => tools.assertCurrent()).toThrow('live');
  expect(() => tools.cargo.assertCurrent()).toThrow();
  expect(() => tools.rustc.assertCurrent()).toThrow();
  expect(() => tools.retire()).not.toThrow();
});
