import path from 'node:path';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from './contract.ts';

const pythonVersion = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.runtime.pythonVersion;
const version = /^(\d+)\.(\d+)\.\d+$/u.exec(pythonVersion);
if (version === null) throw new Error('Linux runtime Python authority must be one exact semantic version.');
const python = Object.freeze({ version: pythonVersion, executablePath: '/usr/bin/python3' as const,
  stdlibDirectory: `/usr/lib/python${version[1]}.${version[2]}` as const });

/** Existing tools and their pure copy recipe. This description issues no runtime authority. */
export const LINUX_RUNTIME_TOOLS = Object.freeze({
  python,
  binaries: Object.freeze([
    '/usr/bin/awk', '/usr/bin/bash', '/usr/bin/basename', '/usr/bin/cat',
    '/usr/bin/chmod', '/usr/bin/chown', '/usr/bin/cmp', '/usr/bin/cp', '/usr/bin/cut',
    '/usr/bin/date', '/usr/bin/diff', '/usr/bin/dirname', '/usr/bin/env', '/usr/bin/find',
    '/usr/bin/git', '/usr/bin/grep', '/usr/bin/head', '/usr/bin/ln', '/usr/bin/mkdir',
    '/usr/bin/mktemp', '/usr/bin/mount', '/usr/bin/prlimit', python.executablePath,
    '/usr/bin/readlink', '/usr/bin/realpath', '/usr/bin/rm', '/usr/bin/rmdir', '/usr/bin/sed',
    '/usr/bin/setpriv', '/usr/bin/sha256sum', '/usr/bin/sleep', '/usr/bin/sort', '/usr/bin/stat',
    '/usr/bin/tail', '/usr/bin/tar', '/usr/bin/tee', '/usr/bin/timeout', '/usr/bin/touch',
    '/usr/bin/tr', '/usr/bin/umount', '/usr/bin/uname', '/usr/bin/wc', '/usr/bin/xargs'
  ] as const),
  directories: Object.freeze(['/usr/lib/git-core', python.stdlibDirectory] as const),
  aliases: Object.freeze([
    Object.freeze({ path: '/bin', target: 'usr/bin' }),
    Object.freeze({ path: '/usr/bin/sh', target: 'bash' }),
    Object.freeze({ path: '/tool/bin/node', target: 'bun' })
  ] as const)
});

const COPY_FUNCTION = Object.freeze([
  'copy_runtime() {',
  '  source="$1"',
  '  destination="$2"',
  '  [ -f "$source" ]',
  '  /usr/bin/install -D -m 0555 -- "$source" "$root$destination"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  `  done < <(/usr/bin/ldd "$source" 2>/dev/null | /usr/bin/awk '$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }' || true)`,
  '}',
  'copy_required_dynamic_dependencies() {',
  '  dependency_source="$1"',
  '  dependency_output="$(/usr/bin/ldd "$dependency_source")"',
  '  if /usr/bin/grep -F "not found" <<< "$dependency_output" >/dev/null; then return 1; fi',
  '  dependency_inventory="$root/tmp/python-extension-dependencies"',
  '  /usr/bin/awk \u0027$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }\u0027 <<< "$dependency_output" > "$dependency_inventory"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  '  done < "$dependency_inventory"',
  '  /usr/bin/rm -- "$dependency_inventory"',
  '}'
] as const);

export function linuxRuntimeToolCopyScript(directoryLinks: 'preserved' | 'independent-files'): readonly string[] {
  return Object.freeze([
    '# runtime-binary-closure', ...COPY_FUNCTION,
    ...LINUX_RUNTIME_TOOLS.binaries.map(runtimePath => `copy_runtime ${runtimePath} ${runtimePath}`),
    ...LINUX_RUNTIME_TOOLS.directories.flatMap(runtimePath => [
      `mkdir -p "$root${path.posix.dirname(runtimePath)}"`,
      `/usr/bin/cp ${directoryLinks === 'preserved' ? '-a' : '-R --preserve=mode,timestamps --no-dereference'} -- ${JSON.stringify(runtimePath)} "$root${runtimePath}"`
    ]),
    'python_extension_inventory="$root/tmp/python-extension-inventory"',
    'python_extension_inventory_sorted="$root/tmp/python-extension-inventory.sorted"',
    `/usr/bin/find ${JSON.stringify(LINUX_RUNTIME_TOOLS.python.stdlibDirectory)} -type f -name '*.so' -print0 > "$python_extension_inventory"`,
    '/usr/bin/sort -z "$python_extension_inventory" > "$python_extension_inventory_sorted"',
    'while IFS= read -r -d \u0027\u0027 extension; do copy_required_dynamic_dependencies "$extension"; done < "$python_extension_inventory_sorted"',
    '/usr/bin/rm -- "$python_extension_inventory" "$python_extension_inventory_sorted"',
    'copy_runtime "$bun_host" "/tool/bin/bun"',
    ...LINUX_RUNTIME_TOOLS.aliases.map(alias => `ln -s ${JSON.stringify(alias.target)} "$root${alias.path}"`)
  ]);
}
