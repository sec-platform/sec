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

const transportEntry = fileURLToPath(new URL('../../../src/entry/cli/cli.ts', import.meta.url));
const commandOptions = fileURLToPath(new URL('../../../src/entry/cli/command-options.ts', import.meta.url));
const fixtureImports = `import { runCli } from ${JSON.stringify(transportEntry)};
import { addJsonFlags } from ${JSON.stringify(commandOptions)};`;

for (const args of [
  ['group', 'result', '--json', '--compact'],
  ['group', 'result', '--value', '--json'],
  ['group', 'result', '--', '--json']
]) {
  test(`transport preserves successful nested execution and argument ownership: ${args.join(' ')}`, async () => {
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
    if (args.includes('--compact')) expect(output.options).toEqual({ json: true, compact: true });
    else if (args.includes('--value')) expect(output.options.value).toBe('--json');
    else expect(output.operand).toBe('--json');
  }, 10_000);
}

// All three failures must remain actual native-process cases: a parser-shaped
// ordinary object, a hostile Proxy and a revoked Proxy have distinct failure
// inspection hazards. Their SEC protocol is independently fixed below.
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
  },
  {
    failure: `(() => { const proxy = Proxy.revocable({}, {}); proxy.revoke(); return proxy.proxy; })()`,
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
    const protocolStderr = result.stderr.replace(/\u001b\[[0-9;]*m/gu, '');
    const frames = protocolStderr.split(/\r?\n/u)
      .filter(line => line.startsWith('{') && line.endsWith('}'));
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!)).toEqual({
      ...expected,
      artifactPaths: []
    });
  }, 10_000);
}

for (const args of [
  ['not-a-sec-command', '--json'],
  ['add', '--json', '--compact'],
  ['verify', '--unsupported', '--json', '--compact'],
  ['deps', 'status', '--unsupported', '--json', '--compact'],
  ['init', '--json']
]) {
  test(`production CLI rejects ${args.join(' ')} as one safe machine usage result`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      code: 'CLI-USAGE-001', message: 'Invalid command arguments',
      recoverable: true, issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'], artifactPaths: []
    });
    expect(result.stdout).not.toContain('\u001b');
    if (args.includes('--compact')) expect(result.stdout.trimEnd()).not.toContain('\n');
  }, 10_000);
}

for (const args of [[], ['--help'], ['verify', '--help'], ['verify', '--version']]) {
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
