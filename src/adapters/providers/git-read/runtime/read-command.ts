/** Capture the actual dense argv and its byte charge before grammar checks or
 * provider callbacks. A custom iterator/getter is not a second command source.
 * Stop at the existing caller-owned byte ceiling; this issues no capability.
 */
export function captureGitReadArguments(
  input: readonly string[], maximumBytes: number
): Readonly<{ status: 'ready'; args: readonly string[]; bytes: number }>
  | Readonly<{ status: 'invalid' | 'exhausted' }> {
  if (!Array.isArray(input)) return { status: 'invalid' };
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) return { status: 'exhausted' };
  const args: string[] = [];
  let bytes = 0;
  const length = Object.getOwnPropertyDescriptor(input, 'length')!.value as number;
  // Each argument costs at least its terminating NUL byte. Reject an
  // impossible array length before touching any element or allocating copies.
  if (length > maximumBytes) return { status: 'exhausted' };
  for (let index = 0; index < length; index++) {
    const slot = Object.getOwnPropertyDescriptor(input, String(index));
    if (slot === undefined || !('value' in slot) || typeof slot.value !== 'string' || /[\0\p{Surrogate}]/u.test(slot.value)) {
      return { status: 'invalid' };
    }
    bytes += Buffer.byteLength(slot.value, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) return { status: 'exhausted' };
    args.push(slot.value);
  }
  return Object.freeze({ status: 'ready', args: Object.freeze(args), bytes });
}

const REV_LIST_FLAGS = new Set([
      '--parents', '--walk-reflogs', '-n', '1', '--count', '--not',
      '--first-parent', '--ancestry-path', '--reverse'
    ]);

const REV_PARSE_FLAGS = new Set([
      '--verify', '--quiet', '-q', '--revs-only', '--end-of-options', '--show-toplevel', '--git-common-dir',
      '--absolute-git-dir', '--is-inside-work-tree', '--path-format=absolute', '--git-path',
      '--show-object-format'
    ]);

const LS_TREE_FLAGS = new Set(['-r', '-z', '-l', '--full-tree', '--name-only', '--']);

const LS_FILES_FLAGS = new Set([
      '-z', '--stage', '--unmerged', '--cached', '--others', '--exclude-standard', '--ignored',
      '--deleted', '--'
    ]);

const DIFF_FLAGS = new Set([
      '--no-ext-diff', '--no-textconv', '--binary', '--full-index', '--no-renames',
      '--name-status', '--name-only', '--exit-code', '-z', '--find-renames',
      '--find-copies', '--cached', '--'
    ]);

const GIT_READ_ONLY_COMMANDS = new Set([
  'cat-file',
  'branch',
  'check-attr',
  'config',
  'diff',
  'diff-files',
  'diff-index',
  'for-each-ref',
  'grep',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'remote',
  'rev-list',
  'rev-parse',
  'show',
  'show-ref',
  'status',
  'symbolic-ref',
  'var',
  'worktree'
]);

// These commands stop option parsing at --; following tokens are literal
// pathspecs, even when a tracked filename happens to spell a forbidden flag.
const GIT_PATHSPEC_COMMANDS = new Set(['status', 'diff', 'diff-files', 'diff-index', 'ls-files', 'ls-tree']);

const GIT_READ_FORBIDDEN_HELPER_ARGUMENTS = new Set([
  '--ext-diff',
  '--textconv',
  '--filters',
  '--use-bitmap-index',
  '--exec',
  '--recurse-submodules',
  '--submodule'
]);

function gitReadArgumentsInvokeHelper(args: readonly string[]): boolean {
  return args.some((argument) => (
    GIT_READ_FORBIDDEN_HELPER_ARGUMENTS.has(argument)
    || argument.startsWith('--filter=')
    || argument.startsWith('--upload-pack=')
    || argument.startsWith('--receive-pack=')
  ));
}

const GIT_READ_SAFE_CONFIG_OVERRIDES = new Set([
  'core.attributesFile=',
  'core.fsmonitor=false',
  'core.quotepath=false',
  'core.untrackedCache=false'
]);

function gitReadCommandIndex(args: readonly string[]): number {
  if (args.length === 1 && args[0] === '--version') return 0;
  let index = 0;
  while (index < args.length) {
    const argument = args[index]!;
    if (argument === '-c') {
      const value = args[index + 1];
      if (value === undefined || !GIT_READ_SAFE_CONFIG_OVERRIDES.has(value)) return -1;
      index += 2;
      continue;
    }
    if (argument === '--git-dir' || argument === '--work-tree') {
      if (args[index + 1] === undefined) return -1;
      index += 2;
      continue;
    }
    if (argument === '--no-pager' || argument === '--literal-pathspecs') {
      index += 1;
      continue;
    }
    return argument.startsWith('-') ? -1 : index;
  }
  return -1;
}

/**
 * GitRead is an observation capability, not a generic Git process wrapper.
 * Reject mutation grammar before any retained executable is invoked. Commands
 * with read and write modes are narrowed to their observation-only form here;
 * a semantic mutation owner must use a separately issued effect capability.
 */
export function gitReadCommandIsObservation(args: readonly string[]): boolean {
  // The command is identified by grammar position, not a value search: a
  // --git-dir/--work-tree operand may itself be named branch, show or config.
  const commandIndex = gitReadCommandIndex(args);
  if (commandIndex < 0) return false;
  const command = args[commandIndex]!;
  if (command === '--version') return true;
  if (!GIT_READ_ONLY_COMMANDS.has(command)) return false;
  const commandArgs = args.slice(commandIndex + 1);
  const separator = GIT_PATHSPEC_COMMANDS.has(command) ? commandArgs.indexOf('--') : -1;
  const optionArgs = separator < 0 ? commandArgs : commandArgs.slice(0, separator);
  // grep owns a closed grammar below, including -e's one literal operand.
  // Scanning that operand as another switch confuses data with an option.
  if (command !== 'grep' && gitReadArgumentsInvokeHelper(optionArgs)) return false;
  if (command === 'branch') return commandArgs.length === 1 && commandArgs[0] === '--show-current';
  if (command === 'cat-file') {
    return (commandArgs.length === 1 && ['--batch', '--batch-check'].includes(commandArgs[0]!))
      || (commandArgs.length === 2
        && ['-e', '-s', '-t', 'blob', 'commit'].includes(commandArgs[0]!));
  }
  if (command === 'grep') {
    let patternCount = 0;
    let revisionCount = 0;
    let separatorIndex = -1;
    for (let index = 0; index < commandArgs.length; index += 1) {
      const argument = commandArgs[index]!;
      if (argument === '--') {
        if (separatorIndex !== -1) return false;
        separatorIndex = index;
        continue;
      }
      if (separatorIndex !== -1) {
        if (argument !== '.') return false;
        continue;
      }
      if (argument === '-e') {
        const pattern = commandArgs[index + 1];
        if (pattern === undefined || pattern.length === 0 || pattern.includes('\0')) return false;
        patternCount += 1;
        index += 1;
        continue;
      }
      if (argument === '-l' || argument === '-F' || argument === '-z') continue;
      if (argument.startsWith('-')) return false;
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(argument)) return false;
      revisionCount += 1;
    }
    return patternCount > 0
      && revisionCount === 1
      && separatorIndex >= 0
      && separatorIndex === commandArgs.length - 2
      && commandArgs.at(-1) === '.';
  }
  if (command === 'check-attr') {
    return commandArgs.length === 6
      && commandArgs[0] === '-z'
      && commandArgs[1] === '--stdin'
      && commandArgs[2] === '--source'
      && !commandArgs[3]!.startsWith('-')
      && commandArgs[4] === 'text'
      && commandArgs[5] === 'eol';
  }
  if (command === 'config') {
    if (commandArgs.length === 2) {
      return commandArgs[0] === '--get'
        && !commandArgs[1]!.startsWith('-');
    }
    if (commandArgs.length === 4
        && commandArgs[0] === '--local'
        && commandArgs[1] === '--null'
        && commandArgs[2] === '--get-regexp') {
      return commandArgs[3] === '^(extensions\\.worktreeconfig|core\\.hookspath)$';
    }
    if (commandArgs.length === 5
        && commandArgs[0] === '--file'
        && commandArgs[2] === '--null'
        && commandArgs[3] === '--get'
        && (commandArgs[4] === 'core.hooksPath'
          || commandArgs[4] === 'extensions.worktreeConfig')) {
      const configPath = commandArgs[1]!;
      return configPath.length > 0
        && !configPath.startsWith('-')
        && !/[\0\r\n]/u.test(configPath);
    }
    return false;
  }
  if (command === 'remote') {
    return commandArgs.length >= 2
      && commandArgs[0] === 'get-url'
      && commandArgs.slice(1, -1).every((argument) => argument === '--all' || argument === '--push')
      && !commandArgs.at(-1)!.startsWith('-');
  }
  if (command === 'worktree') {
    return commandArgs[0] === 'list'
      && commandArgs.slice(1).every((argument) => (
        argument === '--porcelain' || argument === '-z' || argument === '-v'
      ));
  }
  if (command === 'symbolic-ref') {
    const positional = commandArgs.filter((argument) => !argument.startsWith('-'));
    return positional.length === 1
      && commandArgs.every((argument) => (
        !argument.startsWith('-')
        || argument === '--short'
        || argument === '--quiet'
        || argument === '-q'
      ));
  }
  if (command === 'status') {
    return optionArgs.every((argument) => (
      argument === '--short'
      || argument === '--branch'
      || argument === '--porcelain'
      || argument === '--porcelain=v1'
      || argument === '--porcelain=v2'
      || argument === '-z'
      || argument === '--untracked-files=all'
      || argument === '--untracked-files=no'
      || argument === '--ignored=no'
      || argument === '--ignored=matching'
      || argument === '--'
      || !argument.startsWith('-')
    ));
  }
  if (command === 'var') {
    return commandArgs.length === 1
      && (commandArgs[0] === 'GIT_AUTHOR_IDENT' || commandArgs[0] === 'GIT_COMMITTER_IDENT');
  }
  if (command === 'show') {
    return commandArgs.length === 1 && !commandArgs[0]!.startsWith('-');
  }
  if (command === 'show-ref') {
    return commandArgs.length === 3
      && commandArgs[0] === '--verify'
      && commandArgs[1] === '--quiet'
      && /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u.test(commandArgs[2]!)
      && !commandArgs[2]!.includes('..')
      && !commandArgs[2]!.includes('//');
  }
  if (command === 'merge-base') {
    return (commandArgs.length === 2 && commandArgs.every((argument) => !argument.startsWith('-')))
      || (commandArgs.length === 3
        && commandArgs[0] === '--is-ancestor'
        && commandArgs.slice(1).every((argument) => !argument.startsWith('-')));
  }
  if (command === 'for-each-ref') {
    const contains = commandArgs[0]?.startsWith('--contains=') === true
      ? commandArgs[0]!.slice('--contains='.length)
      : null;
    const offset = contains === null ? 0 : 1;
    if (contains !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(contains)) return false;
    return commandArgs.length === offset + 2
      && commandArgs[offset]!.startsWith('--format=')
      && !commandArgs[offset + 1]!.startsWith('-');
  }
  if (command === 'diff' || command === 'diff-files' || command === 'diff-index') {
    const allowed = DIFF_FLAGS;
    return optionArgs.every((argument) => (
      allowed.has(argument)
      || argument.startsWith('--diff-filter=')
      || !argument.startsWith('-')
    )) && (command !== 'diff-files' || !optionArgs.includes('--cached'));
  }
  if (command === 'ls-files') {
    const allowed = LS_FILES_FLAGS;
    return optionArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'ls-tree') {
    const allowed = LS_TREE_FLAGS;
    return optionArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'ls-remote') {
    const positional = commandArgs[0] === '--exit-code' ? commandArgs.slice(1) : commandArgs;
    return positional.length === 2
      && positional.every((argument) => argument.length > 0 && !argument.startsWith('-'))
      && positional[1]!.startsWith('refs/heads/');
  }
  if (command === 'rev-parse') {
    const allowed = REV_PARSE_FLAGS;
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  if (command === 'rev-list') {
    // These flags only constrain/shape the commit walk; they do not mutate
    // repository state.  The freeze/replan reader relies on the ancestry
    // path walk, so keep the allowlist explicit instead of treating every
    // rev-list option as a read capability.
    const allowed = REV_LIST_FLAGS;
    return commandArgs.every((argument) => allowed.has(argument) || !argument.startsWith('-'));
  }
  return false;
}

