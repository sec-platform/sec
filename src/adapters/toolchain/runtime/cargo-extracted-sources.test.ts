import { expect, test } from 'bun:test';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertRetainedCargoExtractedSources, retainCargoExtractedSources } from './cargo-extracted-sources.ts';
import { prepareCargoRegistryInputs, type RetainedCargoRegistryInputs } from './cargo-registry-inputs.ts';

async function fixture(run: (input: {
  root: string; src: string; file: string; registryInputs: RetainedCargoRegistryInputs;
  setValidation: (validate: () => void) => void
}) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-cargo-extracted-'));
  const home = path.join(root, 'source-home');
  const output = path.join(root, 'output');
  mkdirSync(path.join(home, 'registry', 'cache', 'registry-one'), { recursive: true });
  mkdirSync(output);
  writeFileSync(path.join(home, 'registry', 'cache', 'registry-one', 'example-1.0.0.crate'), 'abc');
  writeFileSync(path.join(root, 'Cargo.lock'), `version = 4\n[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"\n`);
  const lock = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root), 'Cargo.lock');
  let validate = () => {};
  let registryInputs: RetainedCargoRegistryInputs | undefined;
  try {
    registryInputs = await prepareCargoRegistryInputs({ sourceCargoHome: inspectNoFollowDirectoryChain(home).target,
      lockFile: lock, outputRoot: inspectNoFollowDirectoryChain(output).target,
      deadlineAtUnixMs: Date.now() + 60_000, assertCurrent: () => { lock.assertCurrent(); validate(); } });
    const src = path.join(registryInputs.cargoHome.path, 'registry', 'src');
    const file = path.join(src, 'registry-one', 'example-1.0.0', 'src', 'lib.rs');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'pub const VALUE: bool = true;\n');
    await run({ root, src, file, registryInputs, setValidation: fn => { validate = fn; } });
  } finally {
    registryInputs?.retire();
    lock.dispose();
    expect(path.dirname(root)).toBe(path.resolve(tmpdir()));
    expect(path.basename(root).startsWith('sec-cargo-extracted-')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
}

test.skipIf(process.platform !== 'win32')('Cargo extracted sources protect bytes and membership until receipt-backed retirement', async () => {
  await fixture(async ({ src, file, registryInputs }) => {
    const beforeSeal = lstatSync(file, { bigint: true });
    const generation = await retainCargoExtractedSources({ registryInputs, deadlineAtUnixMs: Date.now() + 60_000 });
    try {
      const afterSeal = lstatSync(file, { bigint: true });
      expect({ device: afterSeal.dev, inode: afterSeal.ino }).toEqual({ device: beforeSeal.dev, inode: beforeSeal.ino });
      expect(afterSeal.ctimeNs).not.toBe(beforeSeal.ctimeNs);
      assertRetainedCargoExtractedSources(generation);
      await generation.assertCurrent();
      expect(generation.identityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(readFileSync(file, 'utf8')).toBe('pub const VALUE: bool = true;\n');
      expect(() => writeFileSync(file, 'changed')).toThrow();
      expect(() => unlinkSync(file)).toThrow();
      expect(() => writeFileSync(path.join(src, 'new-file'), 'new')).toThrow();
      expect(() => mkdirSync(path.join(src, 'new-directory'))).toThrow();
      expect(() => assertRetainedCargoExtractedSources({ ...generation })).toThrow('original-issued');
      await generation.assertCurrent();
      await Promise.resolve();
      await generation.assertCurrent();
      expect(() => writeFileSync(file, 'changed after repeated assertions')).toThrow();
      expect(() => writeFileSync(path.join(src, 'later-file'), 'new')).toThrow();
    } finally { await generation.retire(); }
    await expect(generation.assertCurrent()).rejects.toThrow('original-issued');
    await generation.retire();
    writeFileSync(file, 'write restored');
    writeFileSync(path.join(src, 'new-file'), 'membership restored');
    unlinkSync(file);
  });
}, 90_000);

test.skipIf(process.platform !== 'win32')('Cargo extracted sources reject external hardlinks junctions and abnormal root layout before sealing', async () => {
  await fixture(async ({ root, src, file, registryInputs }) => {
    const external = path.join(root, 'external.rs');
    writeFileSync(external, 'external original');
    const alias = path.join(path.dirname(file), 'alias.rs');
    linkSync(external, alias);
    await expect(retainCargoExtractedSources({ registryInputs, deadlineAtUnixMs: Date.now() + 60_000 })).rejects.toThrow('one link');
    writeFileSync(external, 'external still writable');
    unlinkSync(alias);
    const directory = path.join(root, 'external-directory');
    mkdirSync(directory);
    symlinkSync(directory, path.join(src, 'junction'), 'junction');
    await expect(retainCargoExtractedSources({ registryInputs, deadlineAtUnixMs: Date.now() + 60_000 })).rejects.toThrow();
    rmSync(path.join(src, 'junction'));
    writeFileSync(path.join(src, 'unexpected.rs'), 'not a source namespace');
    await expect(retainCargoExtractedSources({ registryInputs, deadlineAtUnixMs: Date.now() + 60_000 })).rejects.toThrow('ordinary source/package directories');
    writeFileSync(file, 'source remains writable');
  });
}, 90_000);

test.skipIf(process.platform !== 'win32')('Cargo extracted-source failed post-seal boundary retires partial authority and restores owner writes', async () => {
  await fixture(async ({ src, file, registryInputs, setValidation }) => {
    let boundaries = 0;
    setValidation(() => {
      boundaries += 1;
      if (boundaries === 3) throw new Error('source input drift after seal');
    });
    await expect(retainCargoExtractedSources({ registryInputs, deadlineAtUnixMs: Date.now() + 60_000 })).rejects.toThrow('source input drift after seal');
    expect(boundaries).toBe(3);
    setValidation(() => {});
    writeFileSync(file, 'failed preparation released');
    writeFileSync(path.join(src, 'after-failed-preparation'), 'writable');
    registryInputs.assertCurrent();
  });
}, 90_000);

test('Cargo extracted-source identity cannot be forged from a digest', () => {
  expect(() => assertRetainedCargoExtractedSources({ identityDigest: `sha256:${'0'.repeat(64)}`,
    async assertCurrent() {}, async retire() {} })).toThrow('original-issued');
});
