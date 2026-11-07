import path from 'node:path';
import { sha256 } from '../../../contracts/canonical.ts';
import { CodedFailure } from '../../../contracts/failure.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { settleResources } from '../../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8 } from '../../runtime-state/physical/runtime/retained-file-read.ts';

const CONFIG_NAMES = Object.freeze(['config', 'config.toml']);
const MAXIMUM_CONFIG_BYTES = 256 * 1024;
const MAXIMUM_ANCESTORS = 128;
const configurationBrand: unique symbol = Symbol('retained-cargo-preparation-configuration');

export interface RetainedCargoPreparationConfiguration {
  readonly [configurationBrand]: never;
  readonly sourceCargoHome: PhysicalDirectoryIdentity;
  readonly configArguments: readonly string[];
  readonly identityDigest: ReturnType<typeof sha256>;
  assertCurrent(): void;
  retire(): void;
}

const issuedConfigurations = new WeakMap<object, { retired: boolean; retirementFailure: unknown }>();

function unavailable(detail: string): CodedFailure {
  return new CodedFailure('CARGO-PREPARATION-CONFIGURATION-UNAVAILABLE', detail);
}

export function assertRetainedCargoPreparationConfiguration(
  value: unknown
): asserts value is RetainedCargoPreparationConfiguration {
  const state = value !== null && typeof value === 'object' ? issuedConfigurations.get(value) : undefined;
  if (state === undefined || state.retired || state.retirementFailure !== undefined) {
    throw unavailable('A live original-issued Cargo preparation configuration is required.');
  }
}

/** Each input layer must be unambiguous; later layers explicitly replace the
 * same native environment key. Windows spelling does not create another key. */
export function composeCargoProcessEnvironment(...environments: readonly NodeJS.ProcessEnv[]): Readonly<Record<string, string>> {
  const captured: Record<string, string> = Object.create(null);
  for (const environment of environments) {
    const names = new Set<string>();
    for (const name of Object.keys(environment)) {
      const descriptor = Object.getOwnPropertyDescriptor(environment, name);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw unavailable('Cargo preparation environment requires own data entries.');
      }
      const value: unknown = descriptor.value;
      const canonical = process.platform === 'win32' ? name.toUpperCase() : name;
      if (name.length === 0 || name.includes('=') || name.includes('\0') || names.has(canonical)
          || value !== undefined && (typeof value !== 'string' || value.includes('\0'))) {
        throw unavailable('Cargo preparation environment is ambiguous or unsafe.');
      }
      names.add(canonical);
      if (value === undefined) delete captured[canonical];
      else captured[canonical] = value as string;
    }
  }
  return Object.freeze(captured);
}

function captureEnvironment(environment: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const captured = composeCargoProcessEnvironment(environment);
  for (const canonical of Object.keys(captured)) {
    const allowedCargo = canonical === 'CARGO_HOME' || canonical === 'CARGO_TARGET_DIR'
      || /^(?:CARGO_HTTP_|CARGO_HTTPS_|CARGO_NET_|CARGO_TERM_)/u.test(canonical);
    const allowedRust = ['RUSTUP_HOME', 'RUSTUP_AUTO_INSTALL', 'RUST_LOG', 'RUST_BACKTRACE', 'RUST_LIB_BACKTRACE']
      .includes(canonical);
    if ((canonical.startsWith('CARGO_') && !allowedCargo)
        || (canonical.startsWith('RUST') && !allowedRust)) {
      throw unavailable(`Cargo preparation environment override ${canonical} requires qualification.`);
    }
  }
  return captured;
}

function resolveCargoHome(repositoryRoot: string, environment: Readonly<Record<string, string>>): string {
  const cargoHome = environment.CARGO_HOME;
  if (cargoHome !== undefined && cargoHome.length > 0) {
    // A Windows drive-relative prefix depends on a second per-drive cwd.
    if (process.platform === 'win32' && /^[a-z]:(?:[^\\/]|$)/iu.test(cargoHome)) {
      throw unavailable('Drive-relative Cargo home requires its native per-drive cwd input.');
    }
    return path.resolve(repositoryRoot, cargoHome);
  }
  const home = process.platform === 'win32' ? environment.USERPROFILE : environment.HOME;
  if (home === undefined || home.length === 0) {
    throw unavailable('Cargo default home requires the native user-profile fallback input.');
  }
  if (!path.isAbsolute(home)) throw unavailable('Cargo default home must resolve to an absolute user profile.');
  return path.join(home, '.cargo');
}

interface DirectoryObservation {
  readonly path: string;
  readonly chain: PhysicalDirectoryChain | null;
}

interface ConfigObservation {
  readonly parent: PhysicalDirectoryChain;
  readonly name: string;
  readonly capability: RetainedNoFollowOrdinaryFile | null;
  readonly byteDigest: string | null;
}

/**
 * Preserve Cargo's original home config location for a private-home preparation.
 * External absent candidates are finite observations, rechecked before use.
 * They do not grant continuous namespace protection or formal qualification.
 */
export function retainCargoPreparationConfiguration(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): RetainedCargoPreparationConfiguration {
  const deadlineAtUnixMs = input.deadlineAtUnixMs;
  const signal = input.signal;
  const acquiredAtUnixMs = Date.now();
  const monotonicDeadlineMs = performance.now() + (deadlineAtUnixMs - acquiredAtUnixMs);
  const checkBudget = (): void => {
    throwIfNativeAborted(signal);
    if (!Number.isSafeInteger(deadlineAtUnixMs) || Date.now() >= deadlineAtUnixMs
        || performance.now() >= monotonicDeadlineMs) {
      throw unavailable('Cargo preparation configuration requires a live absolute deadline.');
    }
  };
  checkBudget();
  if (process.platform !== 'win32') {
    throw unavailable('Cargo preparation configuration requires the Windows retained-file protection provider.');
  }
  if (!path.isAbsolute(input.repositoryRoot) || path.normalize(input.repositoryRoot) !== input.repositoryRoot) {
    throw unavailable('Cargo preparation requires its canonical absolute repository cwd.');
  }
  const environment = captureEnvironment(input.environment);
  const repository = inspectNoFollowDirectoryChain(input.repositoryRoot, 'Cargo preparation cwd');
  const home = inspectNoFollowDirectoryChain(resolveCargoHome(input.repositoryRoot, environment), 'Cargo source home');
  const directories: DirectoryObservation[] = [];
  const configs: ConfigObservation[] = [];
  const retained: RetainedNoFollowOrdinaryFile[] = [];
  const cleanup = () => [...retained].reverse().map((capability) => ({
    label: 'Cargo configuration retained file', settle: () => capability.dispose()
  }));
  try {
    let ancestor = repository.target.path;
    for (let count = 0; ; count += 1) {
      checkBudget();
      if (count >= MAXIMUM_ANCESTORS) throw unavailable('Cargo cwd ancestor domain exceeds its bounded limit.');
      const candidate = path.join(ancestor, '.cargo');
      const presence = inspectExactNoFollowDirectoryPresence(candidate, 'Cargo ancestor config directory');
      const chain = presence.state === 'present' ? presence.directory : null;
      directories.push({ path: candidate, chain });
      if (chain !== null) {
        for (const name of CONFIG_NAMES) {
          if (inspectNoFollowOrdinaryFileEntry(chain.target, name, { maximumBytes: MAXIMUM_CONFIG_BYTES }) !== null) {
            throw unavailable('Cargo cwd ancestor configuration requires its original precedence qualification.');
          }
          configs.push({ parent: chain, name, capability: null, byteDigest: null });
        }
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    for (const name of CONFIG_NAMES) {
      checkBudget();
      const entry = inspectNoFollowOrdinaryFileEntry(home.target, name, { maximumBytes: MAXIMUM_CONFIG_BYTES });
      if (entry === null) {
        configs.push({ parent: home, name, capability: null, byteDigest: null });
        continue;
      }
      const capability = retainNoFollowOrdinaryFile(home, name, { device: entry.device, inode: entry.inode }, 'Cargo home configuration');
      retained.push(capability);
      if (capability.size > MAXIMUM_CONFIG_BYTES) throw unavailable('Cargo home configuration exceeds its byte budget.');
      configs.push({ parent: home, name, capability, byteDigest: capability.digest().byteDigest });
    }
    const selected = configs.find((entry) => entry.parent === home && entry.capability !== null)?.capability;
    if (selected !== undefined && selected !== null) {
      let parsed: ReturnType<typeof Bun.TOML.parse>;
      try {
        parsed = Bun.TOML.parse(decodeExactUtf8(selected.readBytes(), 'Cargo home configuration'));
      } catch {
        throw unavailable('Cargo home configuration must contain valid UTF-8 TOML.');
      }
      for (const [name, value] of Object.entries(parsed)) {
        if (!['http', 'https', 'net', 'term'].includes(name)
            || value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw unavailable('Cargo configuration contains semantics outside qualified transport/display roots.');
        }
      }
    }
    const state = { retired: false, retirementFailure: undefined as unknown };
    const generation = Object.freeze({
      sourceCargoHome: home.target,
      configArguments: Object.freeze(selected === undefined || selected === null ? [] : ['--config', selected.path]),
      identityDigest: sha256({ domain: 'cargo-preparation-configuration-v1', repository: repository.target,
        home: home.target, environment, directories: directories.map(({ path: location, chain }) => ({
          path: location, identity: chain?.target ?? null
        })), configs: configs.map(({ parent, name, capability, byteDigest }) => ({
          parent: parent.target, name, physical: capability?.physical ?? null, byteDigest
        })) }),
      assertCurrent(): void {
        assertRetainedCargoPreparationConfiguration(generation);
        checkBudget();
        assertSameNoFollowDirectoryIdentity(repository.target, 'Cargo preparation cwd');
        assertSameNoFollowDirectoryIdentity(home.target, 'Cargo source home');
        for (const observation of directories) {
          checkBudget();
          const current = inspectExactNoFollowDirectoryPresence(observation.path, 'Cargo config directory observation');
          if (observation.chain === null) {
            if (current.state !== 'absent') throw unavailable('An absent Cargo config directory became present.');
          } else {
            if (current.state !== 'present') throw unavailable('A Cargo config directory became absent.');
            assertSameNoFollowDirectoryIdentity(observation.chain.target, 'Cargo config directory');
          }
        }
        for (const observation of configs) {
          checkBudget();
          const entry = inspectNoFollowOrdinaryFileEntry(observation.parent.target, observation.name,
            { maximumBytes: MAXIMUM_CONFIG_BYTES });
          if (observation.capability === null) {
            if (entry !== null) throw unavailable('An absent Cargo configuration became present.');
          } else {
            observation.capability.assertCurrent();
            if (entry === null || entry.device !== observation.capability.physical.device
                || entry.inode !== observation.capability.physical.inode
                || observation.capability.digest().byteDigest !== observation.byteDigest) {
              throw unavailable('Cargo configuration identity changed.');
            }
          }
        }
      },
      retire(): void {
        if (state.retired) return;
        if (state.retirementFailure !== undefined) throw state.retirementFailure;
        try {
          settleResources({ cleanup: cleanup() });
          state.retired = true;
        } catch (error) {
          state.retirementFailure = error;
          throw error;
        }
      }
    }) as RetainedCargoPreparationConfiguration;
    issuedConfigurations.set(generation, state);
    generation.assertCurrent();
    return generation;
  } catch (error) {
    settleResources({ primary: { label: 'Cargo preparation configuration acquisition', error }, cleanup: cleanup() });
    throw error;
  }
}
