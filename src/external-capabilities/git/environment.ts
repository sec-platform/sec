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
  'GIT_TRACE',
  'GIT_TRACE2',
  'GIT_TRACE2_EVENT',
  'GIT_TRACE2_PERF',
  'GIT_TRACE_PERFORMANCE',
  'GIT_TRACE_PACKET',
  'GIT_CURL_VERBOSE',
  'GIT_SSH_VARIANT',
  'GIT_ATTR_NOSYSTEM',
  'GIT_FS_MONITOR'
] as const;

const MANDATORY_GIT_ENV_KEYS = [
  'GH_PROMPT_DISABLED',
  'GIT_TERMINAL_PROMPT',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_NO_LAZY_FETCH',
  'GIT_OPTIONAL_LOCKS',
  'GIT_LITERAL_PATHSPECS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  ...GIT_HELPER_ENV_KEYS
] as const;

function deleteCaseInsensitiveEnvironmentKey(env: NodeJS.ProcessEnv, key: string): void {
  const canonicalKey = key.toUpperCase();
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === canonicalKey) delete env[name];
  }
}

export function gitEnvironmentValue(
  env: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  const canonicalKey = key.toUpperCase();
  for (const [name, value] of Object.entries(env)) {
    if (name.toUpperCase() === canonicalKey) return value;
  }
  return undefined;
}

function enforceMandatoryGitIsolation(env: NodeJS.ProcessEnv): void {
  for (const key of MANDATORY_GIT_ENV_KEYS) deleteCaseInsensitiveEnvironmentKey(env, key);
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  env.GIT_CONFIG_GLOBAL = GIT_NULL_CONFIG_GLOBAL_SINK;
  env.GIT_CONFIG_NOSYSTEM = '1';
}

export function canonicalGitChildEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  const retainedNames = new Set<string>();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const canonicalName = name.toUpperCase();
    if (AMBIENT_GIT_ENV_KEYS.includes(canonicalName as typeof AMBIENT_GIT_ENV_KEYS[number])
        || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(canonicalName)) continue;
    if (retainedNames.has(canonicalName)) continue;
    retainedNames.add(canonicalName);
    env[name] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) deleteCaseInsensitiveEnvironmentKey(env, key);
    else env[key] = value;
  }
  enforceMandatoryGitIsolation(env);
  return Object.freeze(env);
}
