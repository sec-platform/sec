import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync, mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import { encodeVerificationActionData } from '../action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget } from '../action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../action/contract/environment.ts';
import {
  CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT,
  CodexDevelopmentCreateHostedSutExecutionAuthorization,
  CodexDevelopmentFinalizeHostedActionRawResult,
  CodexDevelopmentHostedSutCandidateEnvironment,
  CodexDevelopmentParseHostedSutSandboxReceipt,
  hostedSutCleanupComplete, hostedSutLifecycleComplete,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutExecutionAuthorization,
  type CodexDevelopmentHostedSutInventoryClosure, type CodexDevelopmentHostedSutProcessLifecycle,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
} from './contract/revision.ts';
import {
  CodexDevelopmentFailureTail
} from './runtime/ci-orchestration-core.ts';
import type { CodexDevelopmentHostedActionExecutionTicket, CodexDevelopmentHostedActionResolution, CodexDevelopmentHostedSutSandboxCommandPlan, CodexDevelopmentHostedSutSandboxProcess, CodexDevelopmentHostedSutSandboxProcessObservation } from './verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, ciActionDigest, exactObject } from './verification-hosted-action-contract.ts';
import type { CodexDevelopmentHostedActionArchiveInventory, CodexDevelopmentPreparedTrustedBootstrapSutInputs, CodexDevelopmentRetainedHostedSutArchive } from './verification-materialization.ts';
import { CodexDevelopmentPrepareTrustedBootstrapSutInputs, assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive } from './verification-materialization.ts';
import { writeHostedActionJson } from './verification-shared.ts';

const HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES = Object.freeze([
  'SEC_ACTION_PLAN_DIGEST',
  'SEC_AFFECTED_TESTS_BASE',
  'SEC_BASE_TREE_SHA',
  'SEC_BOOTSTRAP_BASE',
  'SEC_BOOTSTRAP_HEAD',
  'SEC_BOOTSTRAP_TREE',
  'SEC_CHANGED_BASE',
  'SEC_MAIN_HEALTH_DIGEST',
  'SEC_MAIN_HEALTH_REVISION',
  'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_REVIEW_RECEIPT_DIGEST',
  'SEC_REPOSITORY_AUDIT_DEFAULT_REF',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SESSION_PROPOSAL_DIGEST',
  'SEC_SESSION_REVISION',
  'SEC_TEST_WORKSPACE_NAMESPACE',
  'SEC_TRUST_REVISION',
  'SEC_TRUSTED_WORKFLOW_REF',
  'SEC_WORKFLOW_ACTOR_NODE_ID',
  'SEC_WORK_PACKAGE_MANIFEST_PATH'
] as const);

export function CodexDevelopmentCandidateProcessEnvironment(
  source: NodeJS.ProcessEnv,
  semanticBindings: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PATH: '/tool/bin:/usr/bin:/bin',
    HOME: '/home/sut',
    TMPDIR: '/tmp',
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    SEC_FORMAL_HOSTED_MODE: '1',
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION
  };
  for (const name of HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES) {
    const value = semanticBindings[name] ?? source[name];
    if (value !== undefined) result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

const HOSTED_SUT_RUNTIME_COPY_FUNCTION = Object.freeze([
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

const HOSTED_SUT_RUNTIME_TOOL_CLOSURE = Object.freeze([
  '# runtime-binary-closure',
  ...HOSTED_SUT_RUNTIME_COPY_FUNCTION,
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map(
    (runtimePath) => `copy_runtime ${runtimePath} ${runtimePath}`
  ),
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeDirectories.flatMap((runtimePath) => [
    `mkdir -p "$root${path.posix.dirname(runtimePath)}"`,
    `/usr/bin/cp -a -- ${JSON.stringify(runtimePath)} "$root${runtimePath}"`
  ]),
  'python_extension_inventory="$root/tmp/python-extension-inventory"',
  'python_extension_inventory_sorted="$root/tmp/python-extension-inventory.sorted"',
  `/usr/bin/find ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)} -type f -name '*.so' -print0 > "$python_extension_inventory"`,
  '/usr/bin/sort -z "$python_extension_inventory" > "$python_extension_inventory_sorted"',
  'while IFS= read -r -d \u0027\u0027 extension; do copy_required_dynamic_dependencies "$extension"; done < "$python_extension_inventory_sorted"',
  '/usr/bin/rm -- "$python_extension_inventory" "$python_extension_inventory_sorted"',
  'copy_runtime "$bun_host" "/tool/bin/bun"',
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeAliases.map(
    (alias) => `ln -s ${JSON.stringify(alias.target)} "$root${alias.path}"`
  )
]);

const HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT = [
  'import hashlib,html,json,locale,pathlib,platform,re,sys,tempfile,unittest',
  'def normalized_encoding(value):',
  "    return value.lower().replace('_', '-')",
  "if normalized_encoding(sys.getfilesystemencoding()) != 'utf-8':",
  "    raise RuntimeError('filesystem encoding is not UTF-8')",
  "if normalized_encoding(locale.getpreferredencoding(False)) != 'utf-8':",
  "    raise RuntimeError('preferred encoding is not UTF-8')",
  "with tempfile.TemporaryDirectory(dir='/tmp') as temporary_directory:",
  "    probe = pathlib.Path(temporary_directory) / '文档能力.txt'",
  "    expected = 'SEC 中文文档能力'",
  "    probe.write_text(expected, encoding='utf-8')",
  "    if probe.read_text(encoding='utf-8') != expected:",
  "        raise RuntimeError('non-ASCII path/content roundtrip failed')",
  'print(platform.python_version())'
].join('\n');

const HOSTED_SUT_CHROOT_EXECUTION_SCRIPT = [
  'expected_archive_digest="$1"',
  'base_sha="$2"',
  'head_sha="$3"',
  'environment_count="$4"',
  'shift 4',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 1 ]',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  '[ "sha256:$(/usr/bin/sha256sum /authenticated-input/prepared-candidate.tar | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/tar --extract --file=/authenticated-input/prepared-candidate.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore',
  'rm -f /authenticated-input/prepared-candidate.tar',
  'rmdir /authenticated-input',
  '[ -f /workspace/.sec-trusted-input/candidate.bundle ]',
  '/usr/bin/git -C /workspace init --quiet',
  '/usr/bin/git -C /workspace -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/base)" = "$base_sha" ]',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/head)" = "$head_sha" ]',
  '/usr/bin/git -C /workspace reset --hard --quiet refs/sec/head',
  'rm -rf -- /workspace/.sec-trusted-input',
  '[ -z "$(/usr/bin/git -C /workspace config --local --get-regexp \u0027^(credential\\.|remote\\.|http\\.|core\\.(worktree|sshCommand)|include)\u0027 || true)" ]',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} /workspace`,
  'cd /workspace',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i "\${environment[@]}" /tool/bin/bun "$@"`
].join('\n');

const HOSTED_SUT_NAMESPACE_SCRIPT = [
  'unit_name="$1"',
  'candidate_archive="$2"',
  'expected_archive_digest="$3"',
  'bun_host="$4"',
  'base_sha="$5"',
  'head_sha="$6"',
  'environment_count="$7"',
  'shift 7',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 2 ]',
  '[ "$1" = "bun" ]',
  'shift',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true\u0027 EXIT',
  `mount -t tmpfs -o nodev,nosuid,mode=0755,size=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes} tmpfs "$root"`,
  'mkdir -p "$root/tool/bin" "$root/authenticated-input" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/etc"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  '[ "$candidate_archive" = "/proc/self/fd/3" ]',
  '/usr/bin/cat -- "$candidate_archive" > "$root/authenticated-input/prepared-candidate.tar"',
  '[ "sha256:$(/usr/bin/sha256sum "$root/authenticated-input/prepared-candidate.tar" | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/chmod 0400 "$root/authenticated-input/prepared-candidate.tar"',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=' +
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes + ' tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=268435456 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=268435456 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'printf \u0027sut:x:65532:65532:SEC hosted SUT:/home/sut:/usr/sbin/nologin\\n\u0027 > "$root/etc/passwd"',
  'printf \u0027sut:x:65532:\\n\u0027 > "$root/etc/group"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/workspace" "$root/home/sut" "$root/tmp"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT)} sec-hosted-sut-root "$expected_archive_digest" "$base_sha" "$head_sha" "\${#environment[@]}" "\${environment[@]}" "$@"`
].join('\n');

const TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS = Object.freeze([
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/test-runner.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/ci-lanes.test.ts'
] as const);

// This program is frozen in the trusted base CLI and is the only command the
// bootstrap candidate may execute. Child output is streamed into bounded
// digest/tail observations; it never reaches GitHub command files or the host
// runner's inherited stdout directly.
export const CodexDevelopmentTrustedBootstrapSutHarness = [
  '(async () => {',
  'const { createHash } = require("node:crypto");',
  'const CAP = 2097152;',
  'const TAIL = 512;',
  'const required = (name) => process.env[name] ?? (() => { throw new Error(`missing:${name}`); })();',
  'const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;',
  'const results = [];',
  'const collect = async (stream, state, child) => {',
  '  const reader = stream.getReader();',
  '  try {',
  '    for (;;) {',
  '      const { done, value } = await reader.read();',
  '      if (done) break;',
  '      const chunk = Buffer.from(value);',
  '      state.bytes += chunk.byteLength;',
  '      const remaining = Math.max(0, CAP - state.hashed);',
  '      if (remaining > 0) { const retained = chunk.subarray(0, remaining); state.hash.update(retained); state.hashed += retained.byteLength; }',
  '      state.tail = Buffer.concat([state.tail, chunk]).subarray(-TAIL);',
  '      if (state.bytes > CAP && !state.truncated) { state.truncated = true; child.kill(9); }',
  '    }',
  '  } catch (error) {',
  '    try { await reader.cancel(error); } catch {}',
  '    throw error;',
  '  } finally {',
  '    try { reader.releaseLock(); } catch {}',
  '  }',
  '};',
  'const run = async (label, argv) => {',
  '  const child = Bun.spawn(argv, { cwd: "/workspace", env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });',
  '  const stdout = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const stderr = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const exitPromise = child.exited;',
  '  const stdoutCollection = collect(child.stdout, stdout, child);',
  '  const stderrCollection = collect(child.stderr, stderr, child);',
  '  let exitCode;',
  '  try {',
  '    await Promise.all([stdoutCollection, stderrCollection]);',
  '    exitCode = await exitPromise;',
  '  } catch (error) {',
  '    try { child.kill(9); } catch {}',
  '    await Promise.allSettled([stdoutCollection, stderrCollection, exitPromise]);',
  '    throw error;',
  '  }',
  '  const result = { label, argvDigest: digest(JSON.stringify(argv)), exitCode, stdoutDigest: `sha256:${stdout.hash.digest("hex")}`, stderrDigest: `sha256:${stderr.hash.digest("hex")}`, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes, truncated: stdout.truncated || stderr.truncated, stdoutTail: stdout.tail.toString("utf8"), stderrTail: stderr.tail.toString("utf8") };',
  '  results.push(result);',
  '  return result;',
  '};',
  'const execute = async (label, argv) => { const result = await run(label, argv); if (result.exitCode !== 0 || result.truncated) throw new Error(`${label}:${result.exitCode}:${result.truncated}`); return result; };',
  'const baseSha = required("SEC_BOOTSTRAP_BASE");',
  'const expectedHead = required("SEC_BOOTSTRAP_HEAD");',
  'const expectedTree = required("SEC_BOOTSTRAP_TREE");',
  'let status = "passed";',
  'let diagnostic = null;',
  'let parentSha = null;',
  'try {',
  '  const head = (await execute("identity-head", ["git", "rev-parse", "--verify", "HEAD^{commit}"])).stdoutTail.trim();',
  '  const tree = (await execute("identity-tree", ["git", "rev-parse", "--verify", "HEAD^{tree}"])).stdoutTail.trim();',
  '  const parents = (await execute("identity-parents", ["git", "rev-list", "--parents", "-n", "1", "HEAD"])).stdoutTail.trim().split(/\\s+/u);',
  '  if (head !== expectedHead || tree !== expectedTree || parents.length !== 2 || parents[0] !== expectedHead || parents[1] !== baseSha) throw new Error("candidate-identity");',
  '  parentSha = parents[1];',
  '  await execute("bind-origin-main", ["git", "update-ref", "refs/remotes/origin/main", baseSha]);',
  '  await execute("imports", ["bun", "run", "imports:check"]);',
  '  await execute("docs-doctor", ["bun", "run", "docs:doctor"]);',
  '  await execute("typecheck", ["bun", "run", "typecheck:verified"]);',
  '  await execute("diff-check", ["git", "diff", "--check", `${baseSha}..${expectedHead}`]);',
  `  await execute("focused-tests", ${JSON.stringify([
    'bun', 'test', '--timeout', '180000', ...TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS
  ])});`,
  '  await execute("repository-audit", ["bun", "src/adapters/repository/repository-audit/cli.ts", "--json"]);',
  '  await execute("affected-plan", ["bun", "run", "check", "--", "--affected", "--plan"]);',
  '  await execute("affected-tests", ["bun", "run", "test", "--", "--affected"]);',
  '  const worktree = await execute("worktree-readback", ["git", "status", "--porcelain=v1"]);',
  '  if (worktree.stdoutTail.length !== 0) throw new Error("tracked-worktree-not-clean");',
  '} catch (error) { status = "failed"; diagnostic = error instanceof Error ? error.message : String(error); }',
  'const summary = { schema: "sec-trusted-bootstrap-sandbox-summary-v1", baseSha, headSha: expectedHead, treeSha: expectedTree, parentSha, status, diagnostic, results };',
  'process.stdout.write(`${JSON.stringify(summary)}\\n`);',
  'if (status !== "passed") process.exitCode = 1;',
  '})().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: "sec-trusted-bootstrap-sandbox-summary-v1", status: "failed", diagnostic: error instanceof Error ? error.message : String(error), results: [] })}\\n`); process.exitCode = 1; });'
].join('');

export const CodexDevelopmentHostedSutCapabilityAssertion = [
  '(async () => {',
  'const fs = require("node:fs");',
  'const { execFileSync, spawn } = require("node:child_process");',
  'const fail = (message) => { throw new Error(message); };',
  'if (process.getuid() !== 65532 || process.getgid() !== 65532) fail(`uid-gid:${process.getuid()}:${process.getgid()}`);',
  'const status = fs.readFileSync("/proc/self/status", "utf8");',
  'if (!/^CapEff:\\s+0+$/m.test(status) || !/^NoNewPrivs:\\s+1$/m.test(status)) fail("privileges");',
  'try { const parentEnvironment = fs.readFileSync("/proc/1/environ"); if (parentEnvironment.includes(Buffer.from("SEC_HOST_SANDBOX_SENTINEL"))) fail("parent-environment"); } catch (error) { if (error?.code !== "ENOENT" && error?.code !== "EACCES") throw error; }',
  'for (const hidden of ["/.oldroot", "/actions-runner", "/actions-runner/_work/_actions", "/home/runner/work", "/runner/_work", "/run", "/var/run", "/tmp/sec-host-sentinel"]) if (fs.existsSync(hidden)) fail(`host-path:${hidden}`);',
  'const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split(/\\r?\\n/);',
  'if (routes.length > 1) fail("network-route");',
  'const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8");',
  'const mountLines = mounts.trim().split(/\\r?\\n/);',
  'const mountAt = (mountpoint) => mountLines.find((line) => line.split(" ")[4] === mountpoint);',
  'for (const mountpoint of ["/", "/workspace", "/tmp", "/home", "/dev"]) { const line = mountAt(mountpoint); if (!line || !line.includes(" - tmpfs ")) fail(`tmpfs:${mountpoint}`); }',
  'if (mountAt("/usr") || !mountAt("/proc")?.includes(" - proc ")) fail("host-usr-or-proc-mount");',
  `const expectedUsrBin = ${JSON.stringify(Object.freeze([
    ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map((entry) => path.posix.basename(entry)),
    'sh'
  ].sort()))};`,
  'const actualUsrBin = fs.readdirSync("/usr/bin").sort();',
  'if (JSON.stringify(actualUsrBin) !== JSON.stringify(expectedUsrBin)) fail("runtime-binary-closure");',
  'if (JSON.stringify(fs.readdirSync("/tool/bin").sort()) !== JSON.stringify(["bun", "node"])) fail("runtime-tool-aliases");',
  'if (!fs.statSync("/usr/lib/git-core").isDirectory()) fail("git-runtime-closure");',
  `if (!fs.statSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)}).isDirectory()) fail("python-stdlib-closure");`,
  `const pythonVersion = execFileSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath)}, ["-B", "-c", ${JSON.stringify(HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT)}], { encoding: "utf8" }).trim();`,
  `if (pythonVersion !== ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version)}) fail("python-runtime-closure");`,
  'for (const descriptor of fs.readdirSync("/proc/self/fd")) {',
  '  let target;',
  '  try { target = fs.readlinkSync(`/proc/self/fd/${descriptor}`); }',
  // The directory scan can include a descriptor closed before readlink. Only
  // that ENOENT race is ignorable; read failures and forbidden targets reject.
  '  catch (error) { if (error?.code === "ENOENT") continue; throw error; }',
  '  if (/\\/(?:actions-runner|home\\/runner|runner\\/_work|run|var\\/run|workspace)|\\.oldroot|prepared-candidate\\.tar/u.test(target)) fail(`inherited-fd:${descriptor}`);',
  '}',
  'const cgroup = JSON.parse(fs.readFileSync("/capability/cgroup.json", "utf8"));',
  'if (cgroup.memoryMax !== "4294967296" || cgroup.pidsMax !== "256" || cgroup.cpuMax !== "200000 100000") fail("cgroup-limits");',
  'const softLimit = (name) => execFileSync("/usr/bin/prlimit", ["--pid", String(process.pid), `--${name}`, "--noheadings", "--output", "SOFT"], { encoding: "utf8" }).trim();',
  `if (softLimit("cpu") !== "${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds}" || softLimit("as") !== "4294967296" || softLimit("fsize") !== "268435456" || softLimit("nofile") !== "1024" || softLimit("nproc") !== "256") fail("prlimit-limits");`,
  'let connected = false;',
  'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(200) }); connected = true; } catch {}',
  'if (connected) fail("network-egress");',
  'const descendant = spawn("/usr/bin/sleep", ["300"], { detached: true, stdio: "ignore" });',
  'descendant.unref();',
  `process.stdout.write("${CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER}\\n");`,
  '})().catch((error) => { console.error(error); process.exitCode = 1; });'
].join('');

const HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT = [
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${shellSingleQuote(CodexDevelopmentHostedSutCapabilityAssertion)}`
].join('\n');

const HOSTED_SUT_CAPABILITY_SCRIPT = [
  'unit_name="$1"',
  'bun_host="$2"',
  'export SEC_HOST_SANDBOX_SENTINEL=must-not-cross-boundary',
  'touch /tmp/sec-host-sentinel',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true; rm -f -- /tmp/sec-host-sentinel\u0027 EXIT',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=268435456 tmpfs "$root"',
  'mkdir -p "$root/tool/bin" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/capability"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=67108864 tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=16777216 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'cgroup_path="$(/usr/bin/awk -F: \u0027$1 == "0" { print $3 }\u0027 /proc/self/cgroup)"',
  'memory_max="$(cat "/sys/fs/cgroup${cgroup_path}/memory.max")"',
  'pids_max="$(cat "/sys/fs/cgroup${cgroup_path}/pids.max")"',
  'cpu_max="$(cat "/sys/fs/cgroup${cgroup_path}/cpu.max")"',
  'printf \u0027{"cpuMax":"%s","memoryMax":"%s","pidsMax":"%s"}\\n\u0027 "$cpu_max" "$memory_max" "$pids_max" > "$root/capability/cgroup.json"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/home/sut" "$root/tmp" "$root/workspace"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT)} sec-hosted-capability-root`
].join('\n');

const HOSTED_SUT_TEARDOWN_SCRIPT = [
  'unit_name="$1"',
  'root="/tmp/$unit_name"',
  'if [ -e "$root" ]; then [ -d "$root" ] && [ ! -L "$root" ]; rmdir -- "$root"; fi',
  '[ ! -e "$root" ]',
  'rm -f -- /tmp/sec-host-sentinel'
].join('\n');

function hostedSutSandboxUnitName(actionKey: VerificationActionKeyDigest, nonce: string): string {
  if (!/^[A-Za-z0-9_.-]{1,32}$/u.test(nonce)) {
    throw new Error('Hosted SUT sandbox unit nonce is invalid.');
  }
  return `sec-sut-${actionKey.slice('sha256:'.length, 'sha256:'.length + 16)}-${nonce}`;
}

function finalizeHostedSutSandboxCommandPlan(input: Readonly<{
  phase: CodexDevelopmentHostedSutSandboxCommandPlan['phase'];
  command: CodexDevelopmentHostedSutSandboxCommandPlan['command'];
  unitName: string;
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(input.unitName) ||
      input.argv.length === 0 || input.argv.some((entry) => typeof entry !== 'string' || entry.includes('\0'))) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const candidateEnvironmentNames = Object.freeze([...input.candidateEnvironmentNames].sort());
  if (new Set(candidateEnvironmentNames).size !== candidateEnvironmentNames.length ||
      candidateEnvironmentNames.some((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
    throw new Error('Hosted SUT sandbox candidate environment allowlist is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    phase: input.phase,
    unitName: input.unitName,
    command: input.command,
    argv: Object.freeze([...input.argv]),
    candidateEnvironmentNames,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    physicalCommandProjectionDigest: input.physicalCommandProjectionDigest
  });
  return Object.freeze({ ...withoutDigest, planDigest: ciActionDigest(withoutDigest) });
}

export function CodexDevelopmentAssertHostedSutSandboxCommandPlan(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan
): void {
  const value = exactObject(plan, [
    'schema', 'policyDigest', 'phase', 'unitName', 'command', 'argv',
    'candidateEnvironmentNames', 'executionAuthorizationDigest',
    'physicalCommandProjectionDigest', 'planDigest'
  ], 'Hosted SUT sandbox command plan V1');
  const phase = String(value.phase);
  const commandMatchesPhase = phase === 'teardown'
    ? value.command === '/usr/bin/bash'
    : value.command === '/usr/bin/unshare';
  if (value.schema !== CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA ||
      value.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      !commandMatchesPhase ||
      !['capability-self-test', 'execute', 'bootstrap-execute', 'teardown'].includes(phase) ||
      typeof value.unitName !== 'string' ||
      !/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(value.unitName) ||
      !Array.isArray(value.argv) || value.argv.some((entry) => typeof entry !== 'string') ||
      !Array.isArray(value.candidateEnvironmentNames) ||
      value.candidateEnvironmentNames.some((entry) => typeof entry !== 'string') ||
      (value.executionAuthorizationDigest !== null &&
        (typeof value.executionAuthorizationDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.executionAuthorizationDigest))) ||
      (value.physicalCommandProjectionDigest !== null &&
        (typeof value.physicalCommandProjectionDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.physicalCommandProjectionDigest))) ||
      typeof value.planDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.planDigest)) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const { planDigest, ...withoutDigest } = value;
  if (planDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted SUT sandbox command plan digest mismatch.');
  }
  if (value.phase === 'execute' || value.phase === 'bootstrap-execute') {
    if (value.phase === 'execute' &&
        (value.executionAuthorizationDigest === null || value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT execution command plan is not bound to its authorization.');
    }
    if (value.phase === 'bootstrap-execute' &&
        (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null)) {
      throw new Error('Trusted bootstrap SUT command plan cannot claim Action authorization.');
    }
    const encoded = encodeVerificationActionData(value.argv);
    for (const invariant of [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/sbin/chroot', 'mount -t proc', '--no-new-privs', '--bounding-set=-all',
      '/usr/bin/env -i', '/authenticated-input/prepared-candidate.tar',
      HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, '/usr/bin/sha256sum',
      '/usr/bin/cat --', '$candidate_archive',
      'copy_runtime /usr/bin/bash /usr/bin/bash',
      'copy_runtime /usr/bin/tar /usr/bin/tar',
      'runtime-binary-closure'
    ]) {
      if (!encoded.includes(invariant)) throw new Error(`Hosted SUT sandbox command plan omits ${invariant}.`);
    }
    for (const forbidden of [
      'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_STEP_SUMMARY', 'ACTIONS_RUNTIME_TOKEN',
      '/var/run/docker.sock', '/run/docker.sock', '${RUNNER_TEMP}', 'mount --bind /usr',
      '/usr/bin/sudo', '/usr/bin/systemd-run'
    ]) {
      if (encoded.includes(forbidden)) throw new Error(`Hosted SUT sandbox command plan exposes ${forbidden}.`);
    }
  } else if (value.phase === 'capability-self-test') {
    if ((value.executionAuthorizationDigest === null) !==
        (value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT capability command plan has a partial authorization binding.');
    }
  } else if (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null) {
    throw new Error('Hosted SUT auxiliary command plan cannot claim candidate authorization.');
  }
}

export function CodexDevelopmentBuildHostedSutSandboxCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: CodexDevelopmentHostedSutExecutionAuthorization;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.actionKey) || input.normalizedArgv[0] !== 'bun' ||
      input.normalizedArgv.length < 2 || !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) || !/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Hosted SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const names = environment.map(([name]) => name);
  const environmentProjection = environment.map(([name, value]) => Object.freeze({
    name,
    valueDigest: ciActionDigest(value)
  }));
  const authorization = input.executionAuthorization;
  const { authorizationDigest, ...authorizationWithoutDigest } = authorization;
  const { projectionDigest, ...physicalCommandWithoutDigest } = authorization.physicalCommand;
  const expectedUnitName = `sec-sut-${authorization.actionKey.slice(7, 23)}-${authorization.ticketDigest.slice(7, 23)}`;
  if (authorization.schema !== CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA ||
      authorizationDigest !== ciActionDigest(authorizationWithoutDigest) ||
      authorization.actionKey !== input.actionKey ||
      authorization.physicalCommand.actionKey !== input.actionKey ||
      authorization.physicalCommand.schema !== CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA ||
      projectionDigest !== ciActionDigest(physicalCommandWithoutDigest) ||
      authorization.physicalCommand.operationSemanticDigest !== authorization.operationSemanticDigest ||
      authorization.physicalCommand.unitName !== expectedUnitName ||
      input.baseSha !== authorization.providerOrigin.workflowSha ||
      input.headSha !== authorization.candidateSha ||
      authorization.physicalCommand.canonicalArgvDigest !== ciActionDigest(input.normalizedArgv) ||
      authorization.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.providerRevision !== CI_VERIFICATION_HOSTED_PROVIDER_REVISION ||
      encodeVerificationActionData(authorization.normalizedArgv) !==
        encodeVerificationActionData(input.normalizedArgv) ||
      encodeVerificationActionData(authorization.physicalCommand.fixedSandboxEnvironment) !==
        encodeVerificationActionData(environmentProjection)) {
    throw new Error('Hosted SUT physical command differs from its Action-bound execution authorization.');
  }
  const unitName = authorization.physicalCommand.unitName;
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_NAMESPACE_SCRIPT, 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan(input: Readonly<{
  bootstrapDigest: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  candidateEnvironment: NodeJS.ProcessEnv;
  unitNonce: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.bootstrapDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) ||
      !/^[0-9a-f]{40}$/u.test(input.baseSha) || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Trusted bootstrap SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const unitName = hostedSutSandboxUnitName(input.bootstrapDigest, input.unitNonce);
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'bootstrap-execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: environment.map(([name]) => name),
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_NAMESPACE_SCRIPT, 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`),
      'bun', '-e', CodexDevelopmentTrustedBootstrapSutHarness
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

function hostedSutCapabilityCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  bunExecutable: string;
  unitNonce: string;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (input.executionAuthorization !== undefined &&
      input.executionAuthorization.actionKey !== input.actionKey) {
    throw new Error('Hosted SUT capability plan authorization differs from its ActionKey.');
  }
  const unitName = input.executionAuthorization?.physicalCommand.unitName ??
    hostedSutSandboxUnitName(input.actionKey, input.unitNonce);
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'capability-self-test',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: input.executionAuthorization?.authorizationDigest ?? null,
    physicalCommandProjectionDigest: input.executionAuthorization?.physicalCommand.projectionDigest ?? null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_CAPABILITY_SCRIPT, 'sec-hosted-capability',
      unitName, input.bunExecutable
    ]
  });
}

function hostedSutTeardownCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  unitName: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'teardown',
    command: '/usr/bin/bash',
    unitName: input.unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '-ceu', HOSTED_SUT_TEARDOWN_SCRIPT, 'sec-hosted-teardown', input.unitName
    ]
  });
}

function defaultHostedSutSandboxProcess(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchive
): Promise<CodexDevelopmentHostedSutSandboxProcessObservation> {
  const consumesArchive = plan.phase === 'execute' || plan.phase === 'bootstrap-execute';
  if (consumesArchive !== (retainedArchive !== undefined)) {
    throw new Error('Hosted SUT process has a missing or extraneous retained archive descriptor.');
  }
  if (retainedArchive !== undefined) {
    assertRetainedHostedSutArchive(retainedArchive);
    if (plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH).length !== 1 ||
        plan.argv.filter((entry) => entry === retainedArchive.archiveDigest).length !== 1) {
      throw new Error('Hosted SUT process plan differs from its retained archive binding.');
    }
  }
  const child = spawn(plan.command, plan.argv, {
    cwd: process.cwd(),
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    stdio: retainedArchive === undefined
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'pipe', 'pipe', retainedArchive.fileDescriptor],
    windowsHide: true
  });
  return observeHostedSutSandboxChild(child);
}

/** Observes only child_process events. It cannot attest inner namespace or candidate facts. */
export function observeHostedSutSandboxChild(
  child: ChildProcess
): Promise<CodexDevelopmentHostedSutSandboxProcessObservation> {
  const outputByteLimit = CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT;
  const tailByteLimit = 64 * 1024;
  return new Promise((resolve) => {
    const streams = {
      stdout: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) },
      stderr: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) }
    };
    let outputTruncated = false;
    let wallTimedOut = false;
    let supervisorSpawned = false;
    let processError = false;
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | null = null;
    const observe = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      const stream = streams[kind];
      stream.bytes += chunk.byteLength;
      const remaining = Math.max(0, outputByteLimit - stream.hashed);
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        stream.hash.update(retained);
        stream.hashed += retained.byteLength;
      }
      const tail = Buffer.concat([stream.tail, chunk]);
      stream.tail = tail.subarray(Math.max(0, tail.byteLength - tailByteLimit));
      if (stream.bytes > outputByteLimit && !outputTruncated) {
        outputTruncated = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => observe('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => observe('stderr', chunk));
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (wallTimer !== null) clearTimeout(wallTimer);
      const stdoutDigest = `sha256:${streams.stdout.hash.digest('hex')}` as VerificationActionKeyDigest;
      const stderrDigest = `sha256:${streams.stderr.hash.digest('hex')}` as VerificationActionKeyDigest;
      const failureTail = wallTimedOut
        ? 'Hosted SUT exceeded the trusted wall-clock bound and the unshare process was terminated.'
        : outputTruncated
        ? 'Hosted SUT stdout/stderr exceeded the trusted capture bound; SIGKILL was requested for the supervisor.'
        : [streams.stdout.tail.toString('utf8'), streams.stderr.tail.toString('utf8')]
            .filter((entry) => entry.length > 0).join('\n').trim();
      const outputProjection = Object.freeze({
        stdoutDigest, stderrDigest,
        stdoutBytesObserved: streams.stdout.bytes,
        stderrBytesObserved: streams.stderr.bytes,
        outputTruncated,
        lifecycle: Object.freeze({
          supervisorSpawned, supervisorClosed: true,
          supervisorCloseCode: code, supervisorSignal: signal,
          namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
          observationGap: 'unsupported-source' as const
        })
      });
      resolve(Object.freeze({
        code: wallTimedOut ? 124 : outputTruncated ? 125 : processError ? 1 : code ?? 1,
        rawOutputDigest: ciActionDigest({ ...outputProjection, wallTimedOut }),
        failureTail,
        ...outputProjection
      }));
    };
    child.on('spawn', () => { supervisorSpawned = true; });
    child.on('error', (error) => {
      observe('stderr', Buffer.from(error instanceof Error ? error.message : String(error)));
      processError = true;
      // An error event is not process/pipe settlement. Only close resolves this owner.
    });
    child.on('close', (code, signal) => finish(code, signal));
    wallTimer = setTimeout(() => {
      if (settled) return;
      wallTimedOut = true;
      child.kill('SIGKILL');
    }, CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000);
    wallTimer.unref();
  });
}

function syntheticHostedSutSandboxProcessObservation(
  code: number,
  diagnostic: string
): CodexDevelopmentHostedSutSandboxProcessObservation {
  const stdoutDigest = ciActionDigest('');
  const stderrDigest = ciActionDigest(diagnostic);
  return Object.freeze({
    code,
    rawOutputDigest: ciActionDigest({ stdoutDigest, stderrDigest, diagnostic }),
    failureTail: diagnostic,
    stdoutDigest,
    stderrDigest,
    stdoutBytesObserved: 0,
    stderrBytesObserved: Buffer.byteLength(diagnostic, 'utf8'),
    outputTruncated: false,
    lifecycle: Object.freeze({
      supervisorSpawned: null, supervisorClosed: null, supervisorCloseCode: null, supervisorSignal: null,
      namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
      observationGap: 'observation-lost'
    })
  });
}

const HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE: CodexDevelopmentHostedSutProcessLifecycle = Object.freeze({
  supervisorSpawned: false, supervisorClosed: false, supervisorCloseCode: null, supervisorSignal: null,
  namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: null,
  observationGap: null
});

function hostedSutDirectoryCleanup(observed: CodexDevelopmentHostedSutSandboxProcessObservation):
CodexDevelopmentHostedSutSandboxReceipt['cleanup'] {
  return Object.freeze({
    supervisorSpawned: observed.lifecycle.supervisorSpawned,
    supervisorClosed: observed.lifecycle.supervisorClosed,
    exitCode: observed.lifecycle.supervisorClosed === true &&
      observed.lifecycle.supervisorCloseCode !== null && observed.lifecycle.supervisorCloseCode >= 0
      ? observed.lifecycle.supervisorCloseCode : null,
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest
  });
}

function hostedSutCleanupNotAttempted(): CodexDevelopmentHostedSutSandboxReceipt['cleanup'] {
  return Object.freeze({
    supervisorSpawned: false, supervisorClosed: false, exitCode: null,
    outputDigest: ciActionDigest('directory-cleanup-not-attempted')
  });
}

const HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC =
  'Hosted SUT unsupported observation source: child_process events cannot attest namespace establishment, candidate start, or candidate-unit settlement.';

const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES = Object.freeze([
  ['tcb-lock-pre.json', 'tcb-lock-pre'],
  ['imports.log', 'imports'],
  ['docs-doctor.log', 'docs-doctor'],
  ['typecheck.log', 'typecheck'],
  ['diff-check.log', 'diff-check'],
  ['focused-tests.log', 'focused-tests'],
  ['repository-audit.json', 'repository-audit'],
  ['affected-plan.json', 'affected-plan'],
  ['affected-tests.log', 'affected-tests'],
  ['tcb-lock-post.json', 'tcb-lock-post']
] as const);

export async function CodexDevelopmentExecuteTrustedBootstrapSut(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
  manifestPath: string;
}>): Promise<Readonly<{
  status: 'passed' | 'failed';
  bootstrapDigest: VerificationActionKeyDigest;
  receiptDigest: VerificationActionKeyDigest;
}>> {
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(input.manifestPath)) {
    throw new Error('Trusted bootstrap SUT manifest path is invalid.');
  }
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey: ciActionDigest({
      baseSha: input.baseSha, headSha: input.headSha, treeSha: input.treeSha,
      manifestPath: input.manifestPath, sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
    })
  });
  if (capability.state !== 'supported') {
    throw new Error(`Trusted bootstrap SUT cannot start: ${capability.diagnostic ?? capability.state}`);
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) {
    throw new Error('Trusted bootstrap SUT evidence root must begin empty.');
  }
  mkdirSync(outputDirectory, { recursive: true });
  const transportDirectory = path.resolve(outputDirectory, '.transport');
  const candidateNodeModules = path.resolve(input.candidateRoot, 'node_modules');
  let prepared: CodexDevelopmentPreparedTrustedBootstrapSutInputs | null = null;
  let retainedArchive: CodexDevelopmentRetainedHostedSutArchive | null = null;
  try {
    prepared = CodexDevelopmentPrepareTrustedBootstrapSutInputs({
      baseRoot: input.baseRoot,
      candidateRoot: input.candidateRoot,
      outputDirectory: transportDirectory,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha
    });
    const bootstrapDigest = ciActionDigest(Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-operation-v1',
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      manifestPath: input.manifestPath,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      dependencyMaterialization: prepared.dependencyMaterialization,
      dependencyArchiveProjection: prepared.dependencyArchiveProjection,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
    }));
    const candidateEnvironment = CodexDevelopmentCandidateProcessEnvironment({}, {
      SEC_BOOTSTRAP_BASE: input.baseSha,
      SEC_BOOTSTRAP_HEAD: input.headSha,
      SEC_BOOTSTRAP_TREE: input.treeSha,
      SEC_CHANGED_BASE: input.baseSha,
      SEC_AFFECTED_TESTS_BASE: input.baseSha,
      SEC_REPOSITORY_AUDIT_DEFAULT_REF: input.baseSha,
      SEC_WORK_PACKAGE_MANIFEST_PATH: input.manifestPath
    });
    let commandPlan: CodexDevelopmentHostedSutSandboxCommandPlan | null = null;
    let execution = syntheticHostedSutSandboxProcessObservation(
      1, capability.diagnostic ?? `sandbox-capability:${capability.state}`
    );
    let teardown = syntheticHostedSutSandboxProcessObservation(1, 'sandbox-not-started');
    let retainedArchiveStable = false;
    if (capability.state === 'supported') {
      retainedArchive = retainHostedSutArchive(
        prepared.preparedCandidateArchive,
        prepared.archiveDigest
      );
      commandPlan = CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan({
        bootstrapDigest,
        candidateArchiveDigest: retainedArchive.archiveDigest,
        bunExecutable: realpathSync.native(process.execPath),
        baseSha: input.baseSha,
        headSha: input.headSha,
        candidateEnvironment,
        unitNonce: `${process.pid}-${Date.now()}`.slice(0, 32)
      });
      try {
        execution = await defaultHostedSutSandboxProcess(commandPlan, retainedArchive);
      } finally {
        try {
          teardown = await defaultHostedSutSandboxProcess(hostedSutTeardownCommandPlan({
            actionKey: bootstrapDigest,
            unitName: commandPlan.unitName
          }));
        } finally {
          try {
            retainedArchiveStable =
              assertRetainedHostedSutArchive(retainedArchive) === prepared.archiveDigest;
          } finally {
            closeSync(retainedArchive.fileDescriptor);
            retainedArchive = null;
          }
        }
      }
    }
    let summary: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(execution.failureTail) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        summary = parsed as Record<string, unknown>;
      }
    } catch {
      summary = null;
    }
    const results = Array.isArray(summary?.results)
      ? summary.results.filter((entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      : [];
    const resultByLabel = new Map(results.map((result) => [String(result.label), result] as const));
    for (const [fileName, label] of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES) {
      writeHostedActionJson(path.resolve(outputDirectory, fileName), Object.freeze({
        schema: 'sec-trusted-bootstrap-sandbox-step-observation-v1',
        bootstrapDigest,
        sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
        label,
        observation: resultByLabel.get(label) ?? null
      }));
    }
    const sumsSource = `${TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.map(([fileName]) =>
      `${createHash('sha256').update(readFileSync(path.resolve(outputDirectory, fileName))).digest('hex')}  ${fileName}`
    ).join('\n')}\n`;
    writeFileSync(path.resolve(outputDirectory, 'SHA256SUMS'), sumsSource, { encoding: 'utf8', flag: 'wx' });
    const cleanup = hostedSutDirectoryCleanup(teardown);
    const archiveStable = retainedArchiveStable;
    const summaryIdentityPassed = summary?.schema === 'sec-trusted-bootstrap-sandbox-summary-v1' &&
      summary.baseSha === input.baseSha && summary.headSha === input.headSha &&
      summary.treeSha === input.treeSha && summary.parentSha === input.baseSha;
    const status = capability.state === 'supported' && commandPlan !== null && hostedSutLifecycleComplete(execution.lifecycle) &&
      execution.code === 0 && !execution.outputTruncated && hostedSutCleanupComplete(cleanup) && archiveStable &&
      summaryIdentityPassed && summary?.status === 'passed'
      ? 'passed' as const : 'failed' as const;
    const semantic = Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-receipt-v3' as const,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      parentSha: input.baseSha,
      auxiliaryStatus: status,
      evidenceSetDigest: `sha256:${createHash('sha256').update(sumsSource).digest('hex')}`,
      bootstrapDigest,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
      commandPlanDigest: commandPlan?.planDigest ?? null,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      executionOutputDigest: execution.rawOutputDigest,
      capability: hostedSutCapabilityReceipt(capability),
      executionLifecycle: execution.lifecycle,
      cleanup
    });
    const receiptDigest = (`sha256:${createHash('sha256').update(JSON.stringify(semantic)).digest('hex')}`) as VerificationActionKeyDigest;
    writeFileSync(
      path.resolve(outputDirectory, 'sut-receipt.json'),
      `${JSON.stringify({ ...semantic, receiptDigest }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    if (status !== 'passed') {
      throw new Error(
        `Trusted bootstrap candidate SUT failed inside the private sandbox: ${
          summary?.diagnostic ?? capability.diagnostic ?? execution.failureTail}`.slice(0, 2048)
      );
    }
    return Object.freeze({ status, bootstrapDigest, receiptDigest });
  } finally {
    if (retainedArchive !== null) closeSync(retainedArchive.fileDescriptor);
    if (prepared !== null && existsSync(prepared.preparedCandidateArchive)) {
      rmSync(prepared.preparedCandidateArchive, { force: true });
    }
    if (existsSync(transportDirectory)) rmSync(transportDirectory, { recursive: true, force: true });
    if (existsSync(candidateNodeModules)) rmSync(candidateNodeModules, { recursive: true, force: true });
  }
}

function hostedSutDiagnostic(value: string, fallback: string): string {
  const bounded = CodexDevelopmentFailureTail(value, fallback);
  const escaped = bounded.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
  );
  return CodexDevelopmentFailureTail(escaped, fallback);
}

type HostedSutSandboxCapabilityObservation = CodexDevelopmentHostedSutSandboxReceipt['capability'] & Readonly<{
  state: 'supported' | 'unsupported' | 'invalidated' | 'unknown';
}>;

export async function CodexDevelopmentProbeHostedSutSandboxCapability(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
  bunExecutable?: string;
  unitNonce?: string;
  platform?: NodeJS.Platform;
  /** In-process test seam; production selects only its installed physical owner. */
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
}>): Promise<HostedSutSandboxCapabilityObservation> {
  if ((input.platform ?? process.platform) !== 'linux' || input.runSandboxProcess === undefined) {
    const diagnostic = (input.platform ?? process.platform) !== 'linux'
      ? 'Hosted SUT sandbox requires the native ubuntu-24.04 Linux runner.'
      : HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC;
    // Reject before creating a namespace or candidate: the installed owner cannot
    // supply the required facts. A capability stdout marker cannot fill this gap.
    return Object.freeze({
      state: 'unsupported', commandPlanDigest: null,
      lifecycle: Object.freeze({ ...HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE, observationGap: 'unsupported-source' }),
      exitCode: null, markerObserved: false, outputDigest: ciActionDigest(diagnostic),
      cleanup: hostedSutCleanupNotAttempted(), diagnostic
    });
  }
  const run = input.runSandboxProcess;
  const plan = hostedSutCapabilityCommandPlan({
    actionKey: input.actionKey,
    bunExecutable: input.bunExecutable ?? process.execPath,
    unitNonce: input.unitNonce ?? `${process.pid}`,
    executionAuthorization: input.executionAuthorization
  });
  let observed: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    observed = await run(plan);
  } catch (error) {
    observed = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey: input.actionKey, unitName: plan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await run(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const cleanup = hostedSutDirectoryCleanup(teardown);
  const selfTestPassed = hostedSutLifecycleComplete(observed.lifecycle) && observed.code === 0 &&
    !observed.outputTruncated && observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER);
  const supported = selfTestPassed && hostedSutCleanupComplete(cleanup);
  const failure = `${observed.failureTail}\n${teardown.failureTail}`.trim();
  const settled = observed.lifecycle.supervisorClosed === true && observed.lifecycle.candidateUnitSettled === true &&
    hostedSutCleanupComplete(cleanup);
  const unsupported = settled && /not found|no such file|operation not permitted|failed to connect to bus|unshare failed|unknown option/iu
    .test(failure);
  const unknown = observed.lifecycle.supervisorClosed !== true || cleanup.supervisorClosed !== true;
  return Object.freeze({
    state: supported ? 'supported' : unknown ? 'unknown' : unsupported ? 'unsupported' : 'invalidated',
    commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
    lifecycle: observed.lifecycle,
    exitCode: observed.lifecycle.supervisorClosed === true ? observed.code : null,
    markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER),
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
    cleanup,
    diagnostic: supported ? null : hostedSutDiagnostic([
      observed.lifecycle.observationGap === 'unsupported-source' ? HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC : '',
      failure
    ].filter(Boolean).join('\n'), 'Hosted SUT capability or physical settlement was not observed.')
  });
}

function finalizeHostedSutSandboxReceipt(input: Omit<
  CodexDevelopmentHostedSutSandboxReceipt,
  'schema' | 'policyDigest' | 'resources' | 'receiptDigest'
>): CodexDevelopmentHostedSutSandboxReceipt {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: input.actionKey,
    capability: input.capability,
    commandPlanDigest: input.commandPlanDigest,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: input.authenticatedArchive,
    rootIsolation: input.rootIsolation,
    execution: input.execution,
    cleanup: input.cleanup,
    diagnostic: input.diagnostic
  });
  return CodexDevelopmentParseHostedSutSandboxReceipt(Object.freeze({
    ...withoutDigest,
    receiptDigest: ciActionDigest(withoutDigest)
  }));
}

function hostedSutRootIsolationReceipt(environmentNames: readonly string[]):
CodexDevelopmentHostedSutSandboxReceipt['rootIsolation'] {
  return Object.freeze({
    substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.substrate,
    namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.namespaces,
    uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid,
    gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid,
    network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.network,
    inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.inputMount,
    workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.workspace,
    outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outputTransport,
    candidateEnvironmentNames: Object.freeze([...environmentNames].sort())
  });
}

function hostedSutCapabilityReceipt(
  capability: HostedSutSandboxCapabilityObservation
): CodexDevelopmentHostedSutSandboxReceipt['capability'] {
  const { state: ignoredState, ...receipt } = capability;
  void ignoredState;
  return Object.freeze(receipt);
}

export function hostedSutInventoryClosureFromTicket(
  ticket: CodexDevelopmentHostedActionExecutionTicket
): CodexDevelopmentHostedSutInventoryClosure {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}

export async function CodexDevelopmentExecuteHostedActionSut(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  candidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventory;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  platform?: NodeJS.Platform;
  bunExecutable?: string;
  unitNonce?: string;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
}>): Promise<CodexDevelopmentHostedActionRawResult> {
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const ticketInventory = hostedSutInventoryClosureFromTicket(ticket);
  if (encodeVerificationActionData(ticketInventory) !== encodeVerificationActionData(input.archiveInventory)) {
    throw new Error('Hosted Action SUT archive inventory differs from the trusted execution ticket.');
  }
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action resolution lost its normalized operation.');
  }
  const executionAuthorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: ticketInventory,
    producer: ticket.producer
  });
  const env = CodexDevelopmentHostedSutCandidateEnvironment({
    normalizedOperation,
    manifestPath: resolution.artifactInput.manifestPath
  });
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const actionKey = resolution.actionPlan.action.actionKey;
  const unitNonce = input.unitNonce ?? `${process.pid}-${startedAt.getTime()}`;
  const runSandboxProcess = input.runSandboxProcess ?? defaultHostedSutSandboxProcess;
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey,
    executionAuthorization,
    bunExecutable: input.bunExecutable,
    unitNonce: `cap-${unitNonce}`.slice(0, 32),
    platform: input.platform,
    runSandboxProcess: input.runSandboxProcess
  });
  if (capability.state !== 'supported') {
    const finishedAt = now();
    const emptyDigest = ciActionDigest('not-executed');
    const receipt = finalizeHostedSutSandboxReceipt({
      actionKey,
      capability: hostedSutCapabilityReceipt(capability),
      commandPlanDigest: null,
      authenticatedArchive: Object.freeze({
        archiveDigest: input.archiveInventory.archiveDigest,
        inventoryDigest: input.archiveInventory.inventoryDigest,
        dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
        gitBundleDigest: input.archiveInventory.gitBundleDigest,
        entryCount: input.archiveInventory.entryCount,
        totalFileBytes: input.archiveInventory.totalFileBytes
      }),
      rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
      execution: Object.freeze({
        lifecycle: HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE, unitName: null, exitCode: null,
        authenticatedInputDigest: null,
        postExecutionInputDigest: null,
        postExecutionReadbackErrorDigest: null,
        stdoutStderrDigest: capability.outputDigest,
        stdoutDigest: emptyDigest,
        stderrDigest: capability.outputDigest,
        stdoutBytesObserved: 0,
        stderrBytesObserved: 0,
        outputTruncated: false,
        boundedFailureTailDigest: ciActionDigest(capability.diagnostic ?? '')
      }),
      cleanup: hostedSutCleanupNotAttempted(),
      diagnostic: capability.diagnostic
    });
    return CodexDevelopmentFinalizeHostedActionRawResult({
      executionAuthorizationDigest: executionAuthorization.authorizationDigest,
      command: null,
      sandboxReceipt: receipt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    });
  }

  const candidateArchive = realpathSync.native(path.resolve(input.candidateArchive));
  const retainedArchive = retainHostedSutArchive(
    candidateArchive,
    input.archiveInventory.archiveDigest
  );
  const preExecutionArchiveDigest = retainedArchive.archiveDigest;
  try {
  const commandPlan = CodexDevelopmentBuildHostedSutSandboxCommandPlan({
    actionKey,
    candidateArchiveDigest: retainedArchive.archiveDigest,
    bunExecutable: realpathSync.native(path.resolve(input.bunExecutable ?? process.execPath)),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: ciVerificationNormalizedOperationArgv(normalizedOperation),
    candidateEnvironment: env,
    executionAuthorization
  });
  const authorizedOperation = resolveCiVerificationDevRunnerTarget({
    plan: resolution.actionPlan,
    authorizedClosure: resolution.actionPlanClosure
  });
  if (authorizedOperation.semanticDigest !== normalizedOperation.semanticDigest) {
    throw new Error('Hosted SUT executor received a substituted normalized operation.');
  }
  let physical: CodexDevelopmentHostedSutSandboxProcessObservation | null = null;
  let executionObservationLost = false;
  try {
    physical = await runSandboxProcess(commandPlan, retainedArchive);
  } catch (error) {
    executionObservationLost = true;
    physical = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const exitCode = physical.code;
  const observedPhysical = physical as CodexDevelopmentHostedSutSandboxProcessObservation | null;
  if (observedPhysical === null || exitCode !== observedPhysical.code) {
    throw new Error('Hosted Action facade lost its one physical process observation.');
  }
  const processResult = observedPhysical;
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey, unitName: commandPlan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await runSandboxProcess(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const cleanup = hostedSutDirectoryCleanup(teardown);
  const lifecycleComplete = hostedSutLifecycleComplete(processResult.lifecycle);
  const cleanupComplete = hostedSutCleanupComplete(cleanup);
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = assertRetainedHostedSutArchive(retainedArchive);
    if (hostedActionFileDigest(candidateArchive) !== retainedArchive.archiveDigest) {
      throw new Error('Hosted SUT archive pathname no longer names the retained authenticated bytes.');
    }
  } catch (error) {
    archiveReadbackDiagnostic = error instanceof Error ? error.message : String(error);
  }
  const archiveStable = postExecutionArchiveDigest === preExecutionArchiveDigest;
  const sandboxInvalidated = executionObservationLost || !lifecycleComplete ||
    processResult.outputTruncated ||
    processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    !cleanupComplete || !archiveStable;
  const finishedAt = now();
  const diagnostic = sandboxInvalidated
    ? hostedSutDiagnostic([
        executionObservationLost ? 'Hosted SUT physical process observation was lost.' : '',
        processResult.outputTruncated ? 'Hosted SUT physical process output was truncated.' : '',
        processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stdout exceeded its observed byte bound.' : '',
        processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stderr exceeded its observed byte bound.' : '',
        lifecycleComplete ? '' : 'Hosted SUT namespace, candidate start, or candidate-unit settlement was not observed.',
        cleanupComplete ? '' : `Hosted SUT directory cleanup failed: ${teardown.failureTail}`,
        archiveStable ? '' : `Hosted SUT authenticated archive readback failed: ${archiveReadbackDiagnostic ?? 'digest changed'}`
      ].filter(Boolean).join('\n'), 'Hosted SUT sandbox was invalidated.')
    : processResult.code === 0 ? null
      : hostedSutDiagnostic(processResult.failureTail, `${normalizedOperation.gateId} failed.`);
  const receipt = finalizeHostedSutSandboxReceipt({
    actionKey,
    capability: hostedSutCapabilityReceipt(capability),
    commandPlanDigest: commandPlan.physicalCommandProjectionDigest,
    authenticatedArchive: Object.freeze({
      archiveDigest: input.archiveInventory.archiveDigest,
      inventoryDigest: input.archiveInventory.inventoryDigest,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
      gitBundleDigest: input.archiveInventory.gitBundleDigest,
      entryCount: input.archiveInventory.entryCount,
      totalFileBytes: input.archiveInventory.totalFileBytes
    }),
    rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
    execution: Object.freeze({
      lifecycle: processResult.lifecycle,
      unitName: commandPlan.unitName,
      exitCode: processResult.code,
      authenticatedInputDigest: preExecutionArchiveDigest,
      postExecutionInputDigest: postExecutionArchiveDigest,
      postExecutionReadbackErrorDigest: archiveReadbackDiagnostic === null
        ? null : ciActionDigest(archiveReadbackDiagnostic),
      stdoutStderrDigest: processResult.rawOutputDigest as VerificationActionKeyDigest,
      stdoutDigest: processResult.stdoutDigest,
      stderrDigest: processResult.stderrDigest,
      stdoutBytesObserved: processResult.stdoutBytesObserved,
      stderrBytesObserved: processResult.stderrBytesObserved,
      outputTruncated: processResult.outputTruncated,
      boundedFailureTailDigest: ciActionDigest(processResult.failureTail)
    }),
    cleanup,
    diagnostic
  });
  return CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: executionAuthorization.authorizationDigest,
    command: Object.freeze({
      commandPlanDigest: commandPlan.physicalCommandProjectionDigest!,
      executionAuthorizationDigest: commandPlan.executionAuthorizationDigest!,
      physicalCommandProjectionDigest: commandPlan.physicalCommandProjectionDigest!
    }),
    sandboxReceipt: receipt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString()
  });
  } finally {
    closeSync(retainedArchive.fileDescriptor);
  }
}
