import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { settleResourcesAsync, withAcquiredResource } from '../../../src/execution/resource-settlement.ts';
import { createRawTestExecutableFixture } from '../../testkit/raw-process.ts';

const entry = fileURLToPath(new URL('../../../src/bootstrap/cli/cli.ts', import.meta.url));

// This observes the production composition and actual process streams, not the
// in-process fixture's separate Commander registration and failure handler.
async function invoke(args: readonly string[], fixtureSource?: string) {
  let childStarted = false;
  let childExited = false;
  let stdoutSettled = true;
  let stderrSettled = true;
  return withAcquiredResource({
    operationLabel: 'cli-usage', resourceLabel: 'cli-workspace',
    acquire: () => mkdtemp(path.join(tmpdir(), 'sec-cli-usage-')),
    use: async cwd => {
      const fixtureEntry = path.join(cwd, 'entry.ts');
      if (fixtureSource !== undefined) await writeFile(fixtureEntry, fixtureSource);
      return withAcquiredResource({
        operationLabel: 'cli-usage', resourceLabel: 'cli-executable',
        acquire: createRawTestExecutableFixture,
        use: async executable => {
          let stdout: Promise<string> | undefined;
          let stderr: Promise<string> | undefined;
          return withAcquiredResource({
            operationLabel: 'cli-output', resourceLabel: 'cli-child',
            acquire: () => {
              const child = Bun.spawn([executable.command, 'run', '--no-env-file', fixtureSource === undefined ? entry : fixtureEntry, ...args], {
                cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, FORCE_COLOR: '1' },
                timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024
              });
              childStarted = true;
              return child;
            },
            use: async child => {
              stdout = new Response(child.stdout).text();
              stdoutSettled = false;
              stderr = new Response(child.stderr).text();
              stderrSettled = false;
              const [code, out, err] = await Promise.all([child.exited, stdout, stderr]);
              // Preserve the empty-root observation of root help while
              // reusing the current native CLI process and its owned scope.
              const workspaceEntries = await readdir(cwd);
              return { code, stdout: out, stderr: err, workspaceEntries };
            },
            release: async child => {
              await settleResourcesAsync({ cleanup: [
                { label: 'child-kill', settle: () => { if (child.exitCode === null) child.kill('SIGKILL'); } },
                { label: 'child-exit', settle: async () => { await child.exited; childExited = true; } },
                { label: 'child-stdout', settle: async () => { try { await stdout; } finally { stdoutSettled = true; } } },
                { label: 'child-stderr', settle: async () => { try { await stderr; } finally { stderrSettled = true; } } }
              ] });
            }
          });
        },
        release: executable => {
          // Attempting cleanup does not prove the child released its dependencies.
          if (childStarted && (!childExited || !stdoutSettled || !stderrSettled)) {
            throw new Error(`CLI usage cleanup retained executable ${executable.command}: child exit or stream settlement was not confirmed.`);
          }
          return executable.dispose();
        }
      });
    },
    release: cwd => {
      if (childStarted && (!childExited || !stdoutSettled || !stderrSettled)) {
        throw new Error(`CLI usage cleanup retained workspace ${cwd}: child exit or stream settlement was not confirmed.`);
      }
      return rm(cwd, { recursive: true, force: true });
    }
  });
}

function readErrorProtocol(stderr: string): Record<string, unknown> {
  const normalized = stderr.replace(/\u001b\[[0-9;]*m/gu, '');
  const frames = normalized.split(/\r?\n/u).flatMap((line) => {
    if (!line.startsWith('{') || !line.endsWith('}')) return [];
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.hasOwn(value, 'code') ? [value as Record<string, unknown>] : [];
  });
  expect(frames).toHaveLength(1);
  const protocol = frames[0]!;
  expect(Object.keys(protocol).sort()).toEqual([
    'artifactPaths', 'code', 'issueType', 'message', 'recoverable', 'suggestedActions'
  ]);
  expect(typeof protocol.code).toBe('string');
  expect(typeof protocol.message).toBe('string');
  expect(typeof protocol.recoverable).toBe('boolean');
  expect(['usage', 'spec', 'composition', 'kernel']).toContain(protocol.issueType as string);
  for (const field of ['suggestedActions', 'artifactPaths']) {
    expect(Array.isArray(protocol[field])).toBe(true);
    expect((protocol[field] as unknown[]).every((value) => typeof value === 'string')).toBe(true);
  }
  expect(normalized).toContain(`${protocol.code} ${protocol.message}`);
  return protocol;
}
const transportEntry = fileURLToPath(new URL('../../../src/entry/cli/cli.ts', import.meta.url));
const commandOptions = fileURLToPath(new URL('../../../src/entry/cli/command-options.ts', import.meta.url));
const fixtureImports = `import { runCli } from ${JSON.stringify(transportEntry)};
import { addJsonFlags } from ${JSON.stringify(commandOptions)};`;

for (const args of [['group', 'result', '--json', '--compact']] as const) {
  test(`transport preserves successful nested execution and selected JSON options: ${args.join(' ')}`, async () => {
    const result = await invoke(args, `${fixtureImports}
let executions = 0;
await runCli({ version: '1.2.3', register(program) {
  addJsonFlags(program.command('group').command('result'))
    .argument('[operand]').option('--value <text>')
    .action((operand, options) => console.log(JSON.stringify({ executions: ++executions, operand, options })));
} });`);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout);
    expect(output.executions).toBe(1);
    expect(output.options).toEqual({ json: true, compact: true });
  }, 10_000);
}

// Both failure witnesses remain actual native-process cases: the parser-shaped
// object exercises non-Commander lookalikes; the hostile Proxy exercises guarded
// property/prototype inspection. Their SEC protocol is fixed independently below.
for (const { failure, expected } of [
  {
    failure: `{ code: 'commander.unknownOption', exitCode: 0, message: 'execution failure' }`,
    expected: {
      code: 'commander.unknownOption', message: 'execution failure',
      issueType: 'kernel', recoverable: false,
      suggestedActions: ['collect-error-output']
    }
  },
  {
    failure: `new Proxy({}, { get(_target, key) { if (key === 'exitCode') reads++; throw new Error('getter trap'); }, getPrototypeOf() { reads++; throw new Error('prototype trap'); } })`,
    expected: {
      code: 'UNEXPECTED', message: 'Unexpected failure',
      issueType: 'kernel', recoverable: false,
      suggestedActions: ['inspect-cli-stack', 'collect-error-output']
    }
  }
] as const) {
  test(`transport does not classify an arbitrary execution failure as a parser exit: ${failure}`, async () => {
    const result = await invoke(['execute', '--json'], `${fixtureImports}\nlet reads = 0;
await runCli({ version: '1.2.3', register(program) {
  addJsonFlags(program.command('execute')).action(() => { throw ${failure}; });
} });
console.error('classification-reads=' + reads);`);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('classification-reads=0');
    expect(result.stderr).not.toContain('Invalid command arguments');
    // Previously, a missing or malformed error frame could pass these tests
    // just because the fixture printed classification-reads=0.
    // Native CLI failure presentation is colorized by the process fixture;
    // remove terminal formatting before inspecting the machine protocol frame.
    expect(readErrorProtocol(result.stderr)).toEqual({
      ...expected,
      artifactPaths: []
    });
  }, 10_000);
}

for (const { args, mode, status } of [
  { args: ['not-a-sec-command', '--json'], mode: 'json', status: 2 },
  { args: ['add', '--json', '--compact'], mode: 'json', status: 2 },
  { args: ['verify', '--unsupported', '--json', '--compact'], mode: 'json', status: 2 },
  { args: ['deps', 'status', '--unsupported', '--json', '--compact'], mode: 'json', status: 2 },
  { args: ['init', '--json'], mode: 'json', status: 2 },
  { args: ['unknown'], mode: 'text', status: 2 },
  { args: ['verify', '--lane', 'slow'], mode: 'text', status: 1 },
  { args: ['upgrade'], mode: 'text', status: 1 }
] as const) {
  test(`production CLI rejects ${args.join(' ')} with a safe ${mode} usage result`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(status);
    expect(result.workspaceEntries).toEqual([]);
    if (mode === 'json') {
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        code: 'CLI-USAGE-001', message: 'Invalid command arguments',
        recoverable: true, issueType: 'usage',
        suggestedActions: ['retry-with-supported-arguments'], artifactPaths: []
      });
      expect(result.stdout).not.toContain('\u001b');
      if (args.some((arg) => arg === '--compact')) expect(result.stdout.trimEnd()).not.toContain('\n');
      return;
    }
    expect(result.stdout).toBe('');
    const protocol = readErrorProtocol(result.stderr);
    expect(protocol).toMatchObject({ code: 'CLI-USAGE-001', issueType: 'usage', recoverable: true });
    expect(protocol.suggestedActions).toEqual(['retry-with-supported-arguments']);
    expect(protocol.artifactPaths).toEqual([]);
    const diagnostic = result.stderr.replace(/\u001b\[[0-9;]*m/gu, '');
    expect(diagnostic).toContain(args[0] === 'verify' ? 'Lane must be' : args[0] === 'upgrade' ? 'Usage: sec upgrade' : 'unknown');
  }, 10_000);
}

for (const args of [[], ['verify', '--help'], ['verify', '--version']]) {
  test(`production CLI preserves successful ${args.join(' ') || 'root help'}`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    if (args.includes('--version')) expect(result.stdout.trim()).toBe(packageMetadata.version);
    else expect(result.stdout).toContain('Usage: sec');
    if (args.length === 0) {
      for (const marker of ['init', 'resolve', 'compose', 'verify']) {
        expect(result.stdout).toContain(marker);
      }
      expect(result.workspaceEntries).toEqual([]);
    }
  }, 10_000);
}

for (const args of [
  ['not-a-sec-command', '--', '--json'],
  ['verify', '--lane', '--json', '--unsupported']
]) {
  test(`production parser does not treat a value as a JSON flag: ${args.join(' ')}`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('CLI-USAGE-001');
  }, 10_000);
}
