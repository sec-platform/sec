import { expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertRetainedCargoPreparationConfiguration,
  composeCargoProcessEnvironment,
  retainCargoPreparationConfiguration,
  type RetainedCargoPreparationConfiguration
} from './cargo-preparation-configuration.ts';

const windowsTest = process.platform === 'win32' ? test : test.skip;

windowsTest('native Cargo environment layers replace Windows aliases exactly once and preserve other values', () => {
  const inherited = { Path: 'accepted-tools', cargo_home: 'shared-home', CaRgO_TaRgEt_DiR: 'old-target',
    cargo_net_offline: 'false', rustup_auto_install: '1', rustc: 'old-proxy', CUSTOM: 'preserved' };
  const preparation = composeCargoProcessEnvironment(inherited, { Cargo_Home: 'selected-seed' }, {
    CARGO_TARGET_DIR: 'owned-target', CARGO_NET_OFFLINE: 'true', RUSTUP_AUTO_INSTALL: '0'
  });
  const execution = composeCargoProcessEnvironment(preparation, { CARGO_HOME: 'private-home', RUSTC: 'retained-rustc' });
  expect({ ...execution }).toEqual({ PATH: 'accepted-tools', CARGO_HOME: 'private-home',
    CARGO_TARGET_DIR: 'owned-target', CARGO_NET_OFFLINE: 'true', RUSTUP_AUTO_INSTALL: '0',
    RUSTC: 'retained-rustc', CUSTOM: 'preserved' });
  expect(new Set(Object.keys(execution).map(key => key.toUpperCase())).size).toBe(Object.keys(execution).length);
  expect(inherited.cargo_home).toBe('shared-home');
  expect(composeCargoProcessEnvironment(execution, { custom: undefined }).CUSTOM).toBeUndefined();
  expect(() => composeCargoProcessEnvironment({ cargo_home: 'one', CARGO_HOME: 'two' })).toThrow('ambiguous');
  expect(() => composeCargoProcessEnvironment({ cargo_home: 'one', CARGO_HOME: undefined })).toThrow('ambiguous');
});

function fixture(use: (input: {
  root: string;
  repositoryRoot: string;
  home: string;
  retain(environment?: NodeJS.ProcessEnv): RetainedCargoPreparationConfiguration;
}) => void): void {
  const parent = path.join(process.cwd(), '.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'cargo-configuration-test-'));
  const repositoryRoot = path.join(root, 'work', 'repository');
  const home = path.join(root, 'home');
  mkdirSync(repositoryRoot, { recursive: true });
  mkdirSync(home);
  const generations: RetainedCargoPreparationConfiguration[] = [];
  try {
    use({ root, repositoryRoot, home, retain(environment = { CARGO_HOME: home }) {
      const generation = retainCargoPreparationConfiguration({ repositoryRoot, environment,
        deadlineAtUnixMs: Date.now() + 20_000 });
      generations.push(generation);
      return generation;
    } });
  } finally {
    try {
      for (const generation of [...generations].reverse()) generation.retire();
    } finally {
      if (path.dirname(root) !== parent || !path.basename(root).startsWith('cargo-configuration-test-')) {
        throw new Error('Unexpected test fixture cleanup target');
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
}

windowsTest('Cargo preparation retains transport config at its original absolute path and bounds its lifetime', () => {
  fixture(({ home, retain }) => {
    const config = path.join(home, 'config.toml');
    const bytes = '[http]\nproxy = "http://fixture.invalid:1234"\n[https]\nproxy = "fixture"\n[net]\nretry = 2\n[term]\nverbose = false\n';
    writeFileSync(config, bytes);
    const environment = { CARGO_HOME: home, CARGO_NET_OFFLINE: 'true', CARGO_TARGET_DIR: path.join(home, 'target'),
      RUSTUP_AUTO_INSTALL: '0', RUSTUP_HOME: path.join(home, 'rustup'), RUST_LOG: 'warn' };
    const generation = retain(environment);
    assertRetainedCargoPreparationConfiguration(generation);
    expect(generation.sourceCargoHome.path).toBe(home);
    expect(generation.configArguments).toEqual(['--config', config]);
    expect(Object.isFrozen(generation)).toBe(true);
    expect(Object.isFrozen(generation.configArguments)).toBe(true);
    expect(generation.identityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    generation.assertCurrent();
    expect(readFileSync(config, 'utf8')).toBe(bytes);
    expect(environment.CARGO_NET_OFFLINE).toBe('true');
    expect(environment.CARGO_TARGET_DIR).toBe(path.join(home, 'target'));
    expect(() => assertRetainedCargoPreparationConfiguration({ ...generation })).toThrow('original-issued');
    if (process.platform === 'win32') {
      expect(() => writeFileSync(config, '[http]\nproxy = "changed"\n')).toThrow();
      expect(readFileSync(config, 'utf8')).toBe(bytes);
      generation.assertCurrent();
    }
    generation.retire();
    expect(() => generation.assertCurrent()).toThrow('live');
    expect(() => assertRetainedCargoPreparationConfiguration(generation)).toThrow('live');
    expect(() => generation.retire()).not.toThrow();
    writeFileSync(config, '[http]\nproxy = "after-retirement"\n');
  });
});

windowsTest('Cargo home legacy configuration wins while both physical candidates stay retained', () => {
  fixture(({ home, retain }) => {
    const legacy = path.join(home, 'config');
    const modern = path.join(home, 'config.toml');
    writeFileSync(legacy, '[net]\nretry = 3\n');
    // Cargo ignores the lower-priority file's semantics when the legacy file exists.
    writeFileSync(modern, 'not valid TOML = [');
    const generation = retain();
    expect(generation.configArguments).toEqual(['--config', legacy]);
    generation.assertCurrent();
    if (process.platform === 'win32') {
      expect(() => writeFileSync(legacy, '')).toThrow();
      expect(() => writeFileSync(modern, '')).toThrow();
    }
  });
});

windowsTest('Cargo home resolution uses the actual cwd and Windows canonical environment keys', () => {
  fixture(({ root, home, retain }) => {
    const relative = retain({ CARGO_HOME: path.join('..', '..', 'home') });
    expect(relative.sourceCargoHome.path).toBe(home);
    expect(relative.configArguments).toEqual([]);
    relative.retire();
    const profile = path.join(root, 'profile');
    mkdirSync(path.join(profile, '.cargo'), { recursive: true });
    const environment = process.platform === 'win32'
      ? { cargo_home: '', userprofile: profile, HOME: path.join(root, 'ignored-home') }
      : { CARGO_HOME: '', HOME: profile };
    const defaults = retain(environment);
    expect(defaults.sourceCargoHome.path).toBe(path.join(profile, '.cargo'));
    if (process.platform === 'win32') {
      expect(() => retain({ CARGO_HOME: home, cargo_home: home })).toThrow('ambiguous');
      expect(() => retain({ CARGO_HOME: 'D:relative' })).toThrow('per-drive');
      expect(() => retain({ CARGO_HOME: 'D:' })).toThrow('per-drive');
      expect(() => retain({ HOME: profile })).toThrow('native user-profile');
    }
  });
});

windowsTest('Cargo preparation rejects unqualified source and unknown config roots without leaking content', () => {
  for (const source of ['[source.fixture]\ndirectory = "secret-marker"\n', '[build]\nrustflags = ["secret-marker"]\n',
    '[registry]\ntoken = "secret-marker"\n', '[unknown]\nvalue = "secret-marker"\n',
    'http = "secret-marker"\n', '[http\nsecret-marker']) {
    fixture(({ home, retain }) => {
      writeFileSync(path.join(home, 'config.toml'), source);
      let failure: unknown;
      try { retain(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain('secret-marker');
      // Failed acquisition released every file pin.
      writeFileSync(path.join(home, 'config.toml'), '[net]\nretry = 1\n');
      const recovered = retain();
      recovered.assertCurrent();
    });
  }
});

windowsTest('Cargo preparation refuses compiler registry source and profile environment overrides', () => {
  fixture(({ home, retain }) => {
    for (const name of ['RUSTC', 'RUSTDOC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTFLAGS', 'RUSTDOCFLAGS',
      'RUSTUP_TOOLCHAIN', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS', 'CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER',
      'CARGO_PROFILE_RELEASE_OPT_LEVEL', 'CARGO_REGISTRY_TOKEN', 'CARGO_REGISTRIES_FIXTURE_INDEX', 'CARGO_SOURCE_FIXTURE_DIRECTORY']) {
      expect(() => retain({ CARGO_HOME: home, [name]: 'private-marker' })).toThrow('requires qualification');
    }
    expect(() => retain({ CARGO_HOME: `${home}\0` })).toThrow('unsafe');
    const accessor = Object.defineProperty({}, 'CARGO_HOME', { enumerable: true,
      get() { throw new Error('getter must not execute'); } });
    expect(() => retain(accessor)).toThrow('own data');
  });
});

windowsTest('Cargo ancestor configuration is rejected before home replay can change precedence', () => {
  fixture(({ repositoryRoot, retain }) => {
    mkdirSync(path.join(repositoryRoot, '.cargo'));
    writeFileSync(path.join(repositoryRoot, '.cargo', 'config.toml'), '[net]\nretry = 2\n');
    expect(() => retain()).toThrow('original precedence');
  });
});

windowsTest('Cargo finite absence observations reject later directory file and home candidate creation', () => {
  fixture(({ repositoryRoot, retain }) => {
    const generation = retain();
    mkdirSync(path.join(repositoryRoot, '.cargo'));
    expect(() => generation.assertCurrent()).toThrow('became present');
  });
  fixture(({ repositoryRoot, retain }) => {
    mkdirSync(path.join(repositoryRoot, '.cargo'));
    const generation = retain();
    writeFileSync(path.join(repositoryRoot, '.cargo', 'config'), '[net]\nretry = 1\n');
    expect(() => generation.assertCurrent()).toThrow('became present');
  });
  fixture(({ home, retain }) => {
    writeFileSync(path.join(home, 'config.toml'), '[net]\nretry = 1\n');
    const generation = retain();
    writeFileSync(path.join(home, 'config'), '[net]\nretry = 2\n');
    expect(() => generation.assertCurrent()).toThrow('became present');
  });
});

windowsTest('Cargo preparation rejects unsafe directories oversized files expired and cancelled requests', () => {
  fixture(({ root, repositoryRoot, home, retain }) => {
    mkdirSync(path.join(home, 'config.toml'));
    expect(() => retain()).toThrow();
    rmSync(path.join(home, 'config.toml'), { recursive: true });
    writeFileSync(path.join(home, 'config.toml'), Buffer.alloc(256 * 1024 + 1));
    expect(() => retain()).toThrow();
    const linked = path.join(root, 'linked-home');
    symlinkSync(home, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => retain({ CARGO_HOME: linked })).toThrow();
    expect(() => retainCargoPreparationConfiguration({ repositoryRoot, environment: { CARGO_HOME: home },
      deadlineAtUnixMs: Date.now() - 1 })).toThrow('live absolute deadline');
    const controller = new AbortController();
    controller.abort(new Error('cancelled configuration fixture'));
    expect(() => retainCargoPreparationConfiguration({ repositoryRoot, environment: { CARGO_HOME: home },
      deadlineAtUnixMs: Date.now() + 20_000, signal: controller.signal })).toThrow('cancelled configuration fixture');
  });
});

windowsTest('Cargo configuration monotonic deadline cannot be extended by wall-clock rollback', () => {
  fixture(({ retain }) => {
    const generation = retain();
    const wallBeforeRollback = Date.now();
    const monotonicAfterDeadline = performance.now() + 60_000;
    const wall = spyOn(Date, 'now').mockReturnValue(wallBeforeRollback - 60_000);
    const monotonic = spyOn(performance, 'now').mockReturnValue(monotonicAfterDeadline);
    try {
      expect(() => generation.assertCurrent()).toThrow('live absolute deadline');
    } finally {
      monotonic.mockRestore();
      wall.mockRestore();
    }
  });
});

test('Cargo configuration rejects reconstructed generations independently of platform', () => {
  expect(() => assertRetainedCargoPreparationConfiguration({ sourceCargoHome: {}, configArguments: [],
    identityDigest: `sha256:${'a'.repeat(64)}`, assertCurrent() {}, retire() {} })).toThrow('original-issued');
  if (process.platform !== 'win32') {
    expect(() => retainCargoPreparationConfiguration({ repositoryRoot: process.cwd(), environment: {},
      deadlineAtUnixMs: Date.now() + 20_000 })).toThrow('Windows retained-file');
  }
});
