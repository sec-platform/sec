import { devNull } from 'node:os';

/**
 * Value bound to GIT_CONFIG_GLOBAL so trusted Git children ignore the
 * user-global config. `os.devNull` resolves to `/dev/null` on POSIX but to
 * `\\.\nul` on Windows, which Git cannot open as a configuration file
 * (`invalid argument`), so Windows binds the `NUL` device name instead. Both
 * values are accepted by Git as an empty configuration source and do not fall
 * back to reading the real user-global config.
 */
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

const MANDATORY_GIT_READ_ENV_KEYS = [
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
  'SSH_ASKPASS_REQUIRE'
] as const;

function deleteCaseInsensitiveEnvironmentKey(env: NodeJS.ProcessEnv, key: string): void {
  const canonicalKey = key.toUpperCase();
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === canonicalKey) delete env[name];
  }
}

function enforceMandatoryGitReadIsolation(env: NodeJS.ProcessEnv): void {
  for (const key of MANDATORY_GIT_READ_ENV_KEYS) {
    deleteCaseInsensitiveEnvironmentKey(env, key);
  }
  env.GH_PROMPT_DISABLED = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_LITERAL_PATHSPECS = '1';
  env.GIT_CONFIG_GLOBAL = GIT_NULL_CONFIG_GLOBAL_SINK;
  env.GIT_CONFIG_NOSYSTEM = '1';
}

/**
 * Build the single canonical SEC environment for trusted local Git
 * observations. Repository selection is supplied by cwd/argv, never inherited
 * from ambient Git redirection, replacement-object, config-injection,
 * credential-prompt, SSH-command or repository-discovery state.
 *
 * Repository-local config remains observable. User-global and system config
 * are excluded by default so HOME/XDG state cannot silently change a trusted
 * observation. Explicit overrides may bind a narrower subject/environment, but
 * mandatory no-prompt/no-replace/no-global-config guards are reasserted after
 * overrides and therefore cannot be weakened by a caller, including through
 * case-variant environment names on Windows.
 */
export function isolatedGitReadEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  const retainedNames = new Set<string>();
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const canonicalName = name.toUpperCase();
    if (AMBIENT_GIT_ENV_KEYS.includes(canonicalName as typeof AMBIENT_GIT_ENV_KEYS[number]) ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(canonicalName)) {
      continue;
    }
    if (retainedNames.has(canonicalName)) continue;
    retainedNames.add(canonicalName);
    env[name] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  enforceMandatoryGitReadIsolation(env);
  return env;
}

/** Historical child-process callers use the same mechanics as Git reads. */
export function isolatedGitChildEnvironment(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return isolatedGitReadEnvironment({}, source);
}
