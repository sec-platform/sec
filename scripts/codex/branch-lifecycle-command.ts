const BRANCH_LIFECYCLE_GIT_ENVIRONMENT_OVERRIDES_V1 = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_EXEC_PATH',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_OPTIONAL_LOCKS',
  'GIT_QUARANTINE_PATH',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT',
  'GIT_WORK_TREE'
]);
const BRANCH_LIFECYCLE_INDEXED_GIT_CONFIG_OVERRIDE_V1 =
  /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u;

type ChildProcessResultLike = Readonly<{
  status: number | null;
  stdout: Buffer | string | null | undefined;
  stderr: Buffer | string | null | undefined;
}>;

/**
 * Build the one canonical environment for trusted Git subprocesses.
 *
 * This module intentionally owns no command dispatcher or runtime capability.
 * Domain owners import only this pure normalization rule and dispatch their
 * finite operation vocabulary privately.
 */
export function createBranchLifecycleGitChildEnvironmentV1(
  environment: Readonly<NodeJS.ProcessEnv>
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const retainedNames = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const canonicalName = name.toUpperCase();
    if (BRANCH_LIFECYCLE_GIT_ENVIRONMENT_OVERRIDES_V1.has(canonicalName) ||
        BRANCH_LIFECYCLE_INDEXED_GIT_CONFIG_OVERRIDE_V1.test(canonicalName)) {
      continue;
    }
    if (retainedNames.has(canonicalName)) continue;
    retainedNames.add(canonicalName);
    result[name] = value;
  }
  result.GIT_TERMINAL_PROMPT = '0';
  result.GIT_OPTIONAL_LOCKS = '0';
  result.GIT_NO_REPLACE_OBJECTS = '1';
  return result;
}

export function decodeBranchLifecycleChildStdoutV1(result: ChildProcessResultLike): string {
  return Buffer.isBuffer(result.stdout)
    ? result.stdout.toString('utf8').trim()
    : String(result.stdout ?? '').trim();
}

export function decodeBranchLifecycleChildErrorV1(result: ChildProcessResultLike): string {
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString('utf8').trim()
    : String(result.stderr ?? '').trim();
  return stderr || `exit ${result.status ?? 'unknown'}`;
}
