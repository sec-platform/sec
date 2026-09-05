import { devNull } from 'node:os';

const GIT_NULL_CONFIG_GLOBAL_SINK = process.platform === 'win32' ? 'NUL' : devNull;

const AMBIENT_GIT_ENV_KEYS = [
  'GH_PROMPT_DISABLED',
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
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
  'GIT_LITERAL_PATHSPECS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_EXEC_PATH',
  'GIT_GRAFT_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_NO_LAZY_FETCH',
  'GIT_OPTIONAL_LOCKS',
  'GIT_QUARANTINE_PATH',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_ASKPASS',
  'GIT_ASKPASS_REQUIRE',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE'
] as const;

const GIT_HELPER_ENV_KEYS = [
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
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  ...GIT_HELPER_ENV_KEYS
]);

function isMandatoryGitEnvironmentKey(canonicalName: string): boolean {
  // Git trace variables can write arbitrary files (or Trace2 sockets), even
  // during read-only commands. Cover the trace namespace, not a partial list.
  return MANDATORY_GIT_ENV_KEY_SET.has(canonicalName)
    || /^GIT_TRACE(?:2)?(?:_|$)/u.test(canonicalName);
}

function checkedEnvironmentValue(name: string, value: unknown): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  // Child-process coercion must not give a value a different meaning after
  // the provider has captured and hashed its effective environment.
  throw new TypeError(`Git environment ${JSON.stringify(name)} must be a string or undefined.`);
}

export function gitEnvironmentValue(
  env: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  const canonicalKey = key.toUpperCase();
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === canonicalKey) return env[name];
  }
  return undefined;
}

export function canonicalGitChildEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, string>> {
  const env: Record<string, string> = Object.create(null);
  const retainedNames = new Map<string, string>();
  for (const name of Object.keys(source)) {
    const canonicalName = name.toUpperCase();
    if (AMBIENT_GIT_ENV_KEY_SET.has(canonicalName)
        || isMandatoryGitEnvironmentKey(canonicalName)
        || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(canonicalName)) continue;
    if (retainedNames.has(canonicalName)) continue;
    const value = checkedEnvironmentValue(name, source[name]);
    if (value === undefined) continue;
    retainedNames.set(canonicalName, name);
    env[name] = value;
  }
  for (const key of Object.keys(overrides)) {
    const canonicalKey = key.toUpperCase();
    if (isMandatoryGitEnvironmentKey(canonicalKey)) continue;
    const value = checkedEnvironmentValue(key, overrides[key]);
    const previousName = retainedNames.get(canonicalKey);
    if (previousName !== undefined) delete env[previousName];
    if (value === undefined) {
      retainedNames.delete(canonicalKey);
    } else {
      retainedNames.set(canonicalKey, key);
      env[key] = value;
    }
  }
  Object.assign(env, MANDATORY_GIT_ENVIRONMENT);
  return Object.freeze(env);
}
