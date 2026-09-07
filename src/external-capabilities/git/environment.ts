import { devNull } from 'node:os';

const GIT_NULL_CONFIG_GLOBAL_SINK = process.platform === 'win32' ? 'NUL' : devNull;

const AMBIENT_GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_ATTR_SOURCE',
  'GIT_GRAFT_FILE',
  'GIT_QUARANTINE_PATH',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_TEMPLATE_DIR',
] as const;

const GIT_HELPER_ENV_KEYS = [
  'GIT_EXEC_PATH',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_PROXY_COMMAND',
  'GIT_ASKPASS',
  'GIT_ASKPASS_REQUIRE',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'GIT_EXTERNAL_DIFF',
  'GIT_DIFF_OPTS',
  'GIT_PAGER',
  'PAGER',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_CURL_VERBOSE',
  'GIT_SSH_VARIANT',
  'GIT_ATTR_NOSYSTEM',
  'GIT_FS_MONITOR'
] as const;

// The enforced values are the single owner of both spelling and value;
// the rejection set is derived rather than maintained as a second list.
const MANDATORY_GIT_ENVIRONMENT = Object.freeze({
  GH_PROMPT_DISABLED: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_LITERAL_PATHSPECS: '1',
  GIT_CONFIG_GLOBAL: GIT_NULL_CONFIG_GLOBAL_SINK,
  GIT_CONFIG_NOSYSTEM: '1'
});
const AMBIENT_GIT_ENV_KEY_SET: ReadonlySet<string> = new Set(AMBIENT_GIT_ENV_KEYS);
const MANDATORY_GIT_ENV_KEY_SET: ReadonlySet<string> = new Set([
  ...Object.keys(MANDATORY_GIT_ENVIRONMENT),
  ...GIT_HELPER_ENV_KEYS,
  // Literal path selection cannot coexist with a caller's glob/case policy.
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS'
]);

function isMandatoryGitEnvironmentKey(canonicalName: string): boolean {
  // Git trace variables can write arbitrary files (or Trace2 sockets), even
  // during read-only commands. Cover the trace namespace, not a partial list.
  return MANDATORY_GIT_ENV_KEY_SET.has(canonicalName)
    || /^GIT_TRACE(?:2)?(?:_|$)/u.test(canonicalName)
    // Environment-based config injection must not reappear through overrides.
    // Approved per-command -c options still belong to the command grammar.
    || /^GIT_CONFIG(?:_|$)/u.test(canonicalName);
}

/** Preserve native environment identity: POSIX names are case-sensitive.
 * On Windows spelling is folded, and conflicting variants in one input layer
 * are refused rather than resolved by object insertion order. */
function environmentIdentity(name: string): string {
  return process.platform === 'win32' ? name.toUpperCase() : name;
}

function checkedEnvironmentName(name: string): void {
  if (name.length === 0 || name.includes('\0') || name.includes('=') || /\p{Surrogate}/u.test(name)) {
    throw new TypeError('Git environment name cannot be empty, malformed UTF-16, or contain NUL or equals');
  }
}

function checkedEnvironmentValue(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && !value.includes('\0') && !/\p{Surrogate}/u.test(value)) return value;
  // Reject text whose native encoding/coercion would change its accepted value.
  throw new TypeError(`Git environment ${JSON.stringify(name)} must be well-formed text without NUL, or undefined.`);
}

export function gitEnvironmentValue(
  env: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  if (process.platform !== 'win32') return Object.hasOwn(env, key) ? env[key] : undefined;
  const canonicalKey = key.toUpperCase();
  // Match Node's native duplicate-key selection for arbitrary input records.
  // Our own canonical output already contains a single spelling per identity.
  for (const name of Object.keys(env).sort()) {
    if (name.toUpperCase() === canonicalKey) return env[name];
  }
  return undefined;
}

export function canonicalGitChildEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, string>> {
  const env: Record<string, string> = Object.create(null);
  const merge = (values: Readonly<Record<string, string | undefined>>, inherited: boolean): void => {
    if (values === null || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError('Git environment must be a record');
    }
    const selected = new Map<string, string | undefined>();
    for (const name of Object.keys(values)) {
      checkedEnvironmentName(name);
      const policyName = name.toUpperCase();
      if (isMandatoryGitEnvironmentKey(policyName)
          || (inherited && AMBIENT_GIT_ENV_KEY_SET.has(policyName))) continue;
      // Excluded capabilities are not evaluated. Each admitted value is read once.
      const identity = environmentIdentity(name);
      const value = checkedEnvironmentValue(name, values[name]);
      if (selected.has(identity) && selected.get(identity) !== value) {
        throw new TypeError(`Git environment has conflicting case variants of ${JSON.stringify(identity)}`);
      }
      selected.set(identity, value);
    }
    for (const [name, value] of selected) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  };
  merge(source, true);
  merge(overrides, false);
  Object.assign(env, MANDATORY_GIT_ENVIRONMENT);
  return Object.freeze(env);
}
