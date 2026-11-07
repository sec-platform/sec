import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertRetainedCargoRegistryInputs, prepareCargoRegistryInputs } from './cargo-registry-inputs.ts';

// Independently fixed SHA-256("abc"), without consulting the production parser.
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SOURCE = 'registry+https://github.com/rust-lang/crates.io-index';
function record(name = 'example', checksum = ABC_SHA256, source = SOURCE): string {
  return `[[package]]\nname = "${name}"\nversion = "1.0.0"\nsource = "${source}"\nchecksum = "${checksum}"\n`;
}

async function fixture(run: (input: {
  root: string; home: string; output: string; prepare: () => ReturnType<typeof prepareCargoRegistryInputs>
}) => Promise<void>, lock = record()): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-cargo-registry-'));
  const home = path.join(root, 'source');
  const output = path.join(root, 'output');
  mkdirSync(path.join(home, 'registry', 'cache', 'registry-one'), { recursive: true });
  mkdirSync(path.join(home, 'registry', 'index'), { recursive: true });
  mkdirSync(path.join(home, 'registry', 'src'), { recursive: true });
  mkdirSync(output);
  writeFileSync(path.join(home, 'registry', 'cache', 'registry-one', 'example-1.0.0.crate'), 'abc');
  writeFileSync(path.join(home, 'registry', 'CACHEDIR.TAG'), 'signature');
  writeFileSync(path.join(home, 'registry', 'src', 'unpacked.rs'), 'untrusted unpacked bytes');
  for (const name of ['credentials.toml', 'config.toml', '.global-cache', '.package-cache']) writeFileSync(path.join(home, name), 'must not copy');
  writeFileSync(path.join(root, 'Cargo.lock'), `version = 4\n${lock}`);
  const lockFile = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root), 'Cargo.lock');
  try {
    await run({ root, home, output, prepare: () => prepareCargoRegistryInputs({
      sourceCargoHome: inspectNoFollowDirectoryChain(home).target,
      lockFile, outputRoot: inspectNoFollowDirectoryChain(output).target,
      deadlineAtUnixMs: Date.now() + 30_000, assertCurrent: () => lockFile.assertCurrent()
    }) });
  } finally {
    lockFile.dispose();
    expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
    expect(path.basename(root).startsWith('sec-cargo-registry-')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== 'win32')('Cargo private registry validates fixed archive bytes and pins every matching occurrence until retirement', async () => {
  await fixture(async ({ home, prepare }) => {
    mkdirSync(path.join(home, 'registry', 'cache', 'registry-two'));
    writeFileSync(path.join(home, 'registry', 'cache', 'registry-two', 'example-1.0.0.crate'), 'abc');
    const inputs = await prepare();
    const first = path.join(inputs.cargoHome.path, 'registry', 'cache', 'registry-one', 'example-1.0.0.crate');
    const second = path.join(inputs.cargoHome.path, 'registry', 'cache', 'registry-two', 'example-1.0.0.crate');
    try {
      assertRetainedCargoRegistryInputs(inputs);
      inputs.assertCurrent();
      expect(inputs.identityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(readFileSync(first, 'utf8')).toBe('abc');
      expect(readFileSync(second, 'utf8')).toBe('abc');
      expect(readdirSync(inputs.cargoHome.path)).toEqual(['registry']);
      expect(existsSync(path.join(inputs.cargoHome.path, 'registry', 'src'))).toBe(false);
      expect(() => writeFileSync(first, 'bad')).toThrow();
      expect(() => writeFileSync(second, 'bad')).toThrow();
      expect(() => assertRetainedCargoRegistryInputs({ ...inputs })).toThrow('original-issued');
    } finally { inputs.retire(); }
    expect(() => inputs.assertCurrent()).toThrow('original-issued');
    expect(() => inputs.retire()).not.toThrow();
    writeFileSync(first, 'released');
    writeFileSync(second, 'released');
  });
});

test.skipIf(process.platform !== 'win32')('Cargo preparation refuses corrupt and missing locked archives and releases earlier acquired pins', async () => {
  await fixture(async ({ home, output, prepare }) => {
    writeFileSync(path.join(home, 'registry', 'cache', 'registry-one', 'later-1.0.0.crate'), 'corrupt');
    await expect(prepare()).rejects.toThrow('locked SHA256');
    const partial = path.join(output, readdirSync(output)[0]!, 'registry', 'cache', 'registry-one', 'example-1.0.0.crate');
    writeFileSync(partial, 'released after failure');
  }, record() + record('later'));
  await fixture(async ({ prepare }) => { await expect(prepare()).rejects.toThrow('absent'); }, record('missing'));
  await fixture(async ({ home, prepare }) => {
    writeFileSync(path.join(home, 'registry', 'cache', 'registry-one', 'example-1.0.0.crate'), 'wrong');
    await expect(prepare()).rejects.toThrow('locked SHA256');
  });
});

test.skipIf(process.platform !== 'win32')('Cargo preparation rejects ambiguous source checksums nonregistry sources and unsafe registry members', async () => {
  await fixture(async ({ prepare }) => { await expect(prepare()).rejects.toThrow('conflicting checksums'); },
    record() + record('example', '0'.repeat(64), 'registry+https://other.invalid/index'));
  await fixture(async ({ prepare }) => { await expect(prepare()).rejects.toThrow('another package source'); },
    record('example', ABC_SHA256, 'git+https://example.invalid/repo#0123'));
  await fixture(async ({ prepare }) => { await expect(prepare()).rejects.toThrow('unsafe or absent'); }, record('../escape'));
  await fixture(async ({ home, prepare }) => {
    writeFileSync(path.join(home, 'registry', 'config.toml'), 'unsafe direct member');
    await expect(prepare()).rejects.toThrow('unknown or unsafe');
  });
});

test('Cargo registry generations cannot be reconstructed from physical identity or diagnostics', () => {
  expect(() => assertRetainedCargoRegistryInputs({ cargoHome: { path: tmpdir() },
    identityDigest: `sha256:${'0'.repeat(64)}`, assertCurrent() {}, retire() {} })).toThrow('original-issued');
});
