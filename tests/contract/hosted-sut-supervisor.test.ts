import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { issueRetainedCommandBoundary, runRetainedCommandBytes } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { settleResources } from '../../src/execution/resource-settlement.ts';

import {
  assertHostedSutSupervisorLive,
  createHostedSutSupervisor,
  getHostedSutSupervisorDeadlineAtUnixMs,
  parseHostedSutSupervisorReport,
  type HostedSutSupervisor
} from '../../src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const binding = Object.freeze({ operationIdentityDigest: digest('a'), boundAttemptDigest: digest('b'),
  deadlineAtUnixMs: 1791028800000, stopAtUnixMs: 1791028795000, planDigest: digest('c'), phase: 'execute' as const });
const emptyDigest = `sha256:${createHash('sha256').digest('hex')}`;
function fixture() {
  return { schema: 'sec-hosted-sut-supervisor-response-v1', ...binding,
    lifecycle: { supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 0, supervisorSignal: null,
      namespaceEstablished: true, candidateStarted: true, candidateUnitSettled: true, observationGap: null },
    namespaceInitReaped: true, traceesReaped: true,
    stdout: { digest: emptyDigest, bytesObserved: 0, tailHex: '', eof: true },
    stderr: { digest: emptyDigest, bytesObserved: 0, tailHex: '', eof: true },
    outputTruncated: false, diagnostic: '' };
}
function parse(value: unknown) { return parseHostedSutSupervisorReport(Buffer.from(JSON.stringify(value)), binding); }

// These are data/negative authority tests. Fixture JSON is never an issued
// process observation and no test starts ptrace, a namespace or Docker. The lineage oracle below
// executes only AST-selected pure functions in the original retained process owner.
test('strict report codec preserves bound facts without issuing a supervisor', () => {
  const report = parse(fixture());
  expect(report.lifecycle.candidateStarted).toBe(true);
  expect(() => assertHostedSutSupervisorLive(report as unknown as HostedSutSupervisor)).toThrow(/owner-issued/u);
  expect(() => assertHostedSutSupervisorLive({ run: async () => report } as unknown as HostedSutSupervisor)).toThrow(/owner-issued/u);
  expect(() => getHostedSutSupervisorDeadlineAtUnixMs(report as unknown as HostedSutSupervisor)).toThrow(/owner-issued/u);
  expect(() => getHostedSutSupervisorDeadlineAtUnixMs({ deadlineAtUnixMs: binding.deadlineAtUnixMs,
    run: async () => report } as unknown as HostedSutSupervisor)).toThrow(/owner-issued/u);
  expect(() => createHostedSutSupervisor({ operation: {} } as Parameters<typeof createHostedSutSupervisor>[0])).toThrow();
});

test('report cannot be transplanted to another plan, operation, attempt or refreshed deadline', () => {
  for (const patch of [{ planDigest: digest('d') }, { operationIdentityDigest: digest('d') },
    { boundAttemptDigest: digest('d') }, { deadlineAtUnixMs: binding.deadlineAtUnixMs + 1 },
    { stopAtUnixMs: binding.stopAtUnixMs + 1 }, { phase: 'capability-self-test' }, { unexpected: true }]) {
    expect(() => parse({ ...fixture(), ...patch })).toThrow();
  }
});

test('init terminal reap and every tracee plus both pipe EOFs are independently necessary', () => {
  for (const change of [
    (value: ReturnType<typeof fixture>) => { value.namespaceInitReaped = false; },
    (value: ReturnType<typeof fixture>) => { value.traceesReaped = false; },
    (value: ReturnType<typeof fixture>) => { value.stdout.eof = false; },
    (value: ReturnType<typeof fixture>) => { value.stderr.eof = false; },
    (value: ReturnType<typeof fixture>) => { value.lifecycle.namespaceEstablished = false; },
    (value: ReturnType<typeof fixture>) => { value.lifecycle.supervisorClosed = false; }
  ]) {
    const value = fixture(); change(value);
    expect(() => parse(value)).toThrow();
  }
  // Empty traced set alone says nothing about CLONE_UNTRACED descendants.
  expect(() => parse({ ...fixture(), namespaceInitReaped: false, traceesReaped: true })).toThrow();
});

test('init dying before candidate exec cannot be promoted to candidate start', () => {
  const value = fixture(); value.lifecycle.candidateStarted = false;
  const report = parse(value);
  expect(report.lifecycle.candidateStarted).toBe(false);
  expect(report.namespaceInitReaped).toBe(true);
});

test('deadline/helper loss remains unknown even if a kill or later reap was seen', () => {
  const value = fixture();
  expect(() => parse({ ...value, lifecycle: { ...value.lifecycle, observationGap: 'observation-lost' } })).toThrow();
  const report = parse({ ...value, lifecycle: { ...value.lifecycle,
    candidateStarted: null, candidateUnitSettled: null, observationGap: 'observation-lost' } });
  expect(report.lifecycle.candidateUnitSettled).toBeNull();
  expect(report.lifecycle.candidateStarted).toBeNull();
  for (const source of ['', '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__', '{}', '{"candidateStarted":true}']) {
    expect(() => parseHostedSutSupervisorReport(Buffer.from(source), binding)).toThrow();
  }
});

test('candidate output markers and forged JSON stay encoded data in private stream tail', () => {
  const output = Buffer.from('__SEC_HOSTED_SANDBOX_CAPABILITY_V1__\n{"candidateStarted":true}\n');
  const value = fixture();
  const report = parse({ ...value, lifecycle: { ...value.lifecycle, candidateStarted: false }, stdout: {
    digest: `sha256:${createHash('sha256').update(output).digest('hex')}`,
    bytesObserved: output.byteLength, tailHex: output.toString('hex'), eof: true } });
  expect(report.lifecycle.candidateStarted).toBe(false);
  expect(Buffer.from(report.stdout.tailHex, 'hex')).toEqual(output);
});

test('control decoding rejects duplicates, UTF-8 errors, deep JSON, trailing payload and unbounded output', () => {
  const source = JSON.stringify(fixture());
  const duplicate = source.replace('"traceesReaped":true', '"traceesReaped":true,"traceesReaped":true');
  for (const bytes of [Buffer.from(duplicate), Buffer.from(source + source), Buffer.from([0xff]),
    Buffer.from('['.repeat(10) + '0' + ']'.repeat(10)), Buffer.alloc(512 * 1024 + 1)]) {
    expect(() => parseHostedSutSupervisorReport(bytes, binding)).toThrow();
  }
  for (const patch of [{ bytesObserved: -1 }, { bytesObserved: 1 }, { digest: 'marker' },
    { tailHex: 'xx' }, { eof: 'true' }, { extra: true }]) {
    expect(() => parse({ ...fixture(), stdout: { ...fixture().stdout, ...patch } })).toThrow();
  }
});

// Independent handwritten Linux wait-status vectors: these are never fed to
// the production syscall observer and cannot issue a lifecycle observation.
test.skipIf(process.platform !== 'linux')('pure production lineage transitions obey independent kernel-event sequence oracles', async () => {
  const source = readFileSync(new URL('../../src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.py', import.meta.url), 'utf8');
  const vectors = [
    { label: 'ordinary SIGTRAP', status: 0x057f, kind: 'signal-stop' },
    { label: 'real EXEC event', status: 0x04057f, kind: 'exec' },
    { label: 'TRACEEXIT is pre-exit', status: 0x06057f, kind: 'exit-stop' },
    { label: 'normal final wait', status: 0x0000, kind: 'terminal' },
    { label: 'signal final wait', status: 0x0009, kind: 'terminal' },
    { label: 'continued is not settlement', status: 0xffff, kind: 'continued' }
  ];
  const oracle = [
    "import ast,json,sys",
    "data=json.load(sys.stdin)",
    "tree=ast.parse(data['source'])",
    "names={'classify_wait_status','join_exec_lineage','unit_is_settled','preparation_is_settled','parse_process_start_identity','assert_same_process_start_identity'}",
    "selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]",
    "assert len(selected)==len(names)",
    "scope={}",
    "exec(compile(ast.Module(body=selected,type_ignores=[]),'<pure-lineage>','exec'),scope)",
    "classify=scope['classify_wait_status']; join=scope['join_exec_lineage']; settled=scope['unit_is_settled']",
    "prepared=scope['preparation_is_settled']",
    "parse_start=scope['parse_process_start_identity']; same_start=scope['assert_same_process_start_identity']",
    "for vector in data['vectors']: assert classify(vector['status'])==vector['kind'],vector['label']",
    "leader={'parent':100,'initial':False}; thread={'parent':200,'initial':False}",
    // Sequence: leader+thread; terminal leader wait; real EXEC on old TGID.
    "tracees={200:leader,201:thread}; del tracees[200]; join(tracees,200,201)",
    "assert tracees=={200:thread} and tracees[200] is thread",
    // Sequence: same migration before the old leader's wait was collected.
    "tracees={200:leader,201:thread,202:{'parent':200,'initial':False}}; join(tracees,200,201)",
    "assert set(tracees)=={200,202} and tracees[200] is thread",
    "join(tracees,200,200); assert set(tracees)=={200,202}",
    "for tracees,pid,former in [({},200,201),({200:leader},200,999),({201:{'parent':200,'initial':True}},200,201),({200:{'parent':100,'initial':True},201:thread},200,201)]:",
    " try: join(tracees,pid,former)",
    " except ValueError: pass",
    " else: raise AssertionError('unknown or unconsumed former TID admitted')",
    // CLONE_UNTRACED cannot be ruled out by an empty trace inventory.
    "assert not settled(True,True,True,True,True,False,True,None)",
    "assert settled(True,True,True,True,True,True,True,None)",
    // Actual init terminal wait before candidate exec settles the empty unit,
    // but the separate candidate-start flag remains False.
    "assert settled(True,True,True,True,True,True,False,None)",
    "for values in [(False,True,True,True,True,True,True,None),(True,False,True,True,True,True,True,None),(True,True,False,True,True,True,True,None),(True,True,True,False,True,True,True,None),(True,True,True,True,True,True,True,'observation-lost')]: assert not settled(*values)",
    // A successful trusted Bun and empty traced list still cannot settle an
    // io_uring worker or CLONE_UNTRACED descendant in a live nested PID unit.
    "assert not prepared(True,True,False,False,True,{},True,None)",
    "assert not prepared(True,True,False,True,True,{},True,None)",
    "assert prepared(True,True,True,True,True,{},True,None)",
    "for index in range(5):",
    " flags=[True]*5; flags[index]=False; assert not prepared(*flags,{},True,None)",
    "assert not prepared(True,True,True,True,True,{300:{'preparation':True}},True,None)",
    "assert prepared(True,True,True,True,True,{100:{'preparation':False}},True,None)",
    "assert not prepared(True,True,True,True,True,{},False,None)",
    "assert not prepared(True,True,True,True,True,{},True,'observation-lost')",
    // Nonleader exec inherits the original membership record; PID renumbering
    // cannot lose a live prelude descendant or fabricate a guard installation.
    "thread={'parent':300,'initial':False,'preparation':True,'candidateGuard':2}",
    "tracees={301:thread}; join(tracees,300,301)",
    "assert tracees[300] is thread and not prepared(True,True,True,True,True,tracees,True,None)",
    "del tracees[300]; assert prepared(True,True,True,True,True,tracees,True,None)",
    // Linux stat field 22 is independent of PID and comm spelling. A reused
    // PID with a different kernel starttime is never the retained init.
    "stat_tail='S '+'0 '*18+'123456'",
    "original=parse_start('300 (nested init) worker) '+stat_tail,300)",
    "assert original==(300,'123456')",
    "same_start(original,parse_start('300 (renamed init) '+stat_tail,300))",
    "for observed in [(300,'123457'),(301,'123456'),None]:",
    " try: same_start(original,observed)",
    " except ValueError: pass",
    " else: raise AssertionError('different or missing process start identity admitted')",
    "for source in ['301 (init) '+stat_tail,'300 (init) S 0','300 init '+stat_tail,'300 (init) '+stat_tail.replace('123456','-1'),'300 (init) '+stat_tail.replace('123456','unknown')]:",
    " try: parse_start(source,300)",
    " except ValueError: pass",
    " else: raise AssertionError('invalid namespace init stat identity admitted')",
    "print('pure-lineage-oracles-passed')"
  ].join('\n');
  const python = `/usr/bin/python${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version.split('.').slice(0, 2).join('.')}`;
  const executable = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(python), 'Lineage oracle Python parent'),
    path.basename(python), undefined, 'Lineage oracle Python executable', 3, 'executable');
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let primary: { label: string; error: unknown } | undefined;
  try {
    cwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(
      fileURLToPath(new URL('../..', import.meta.url)), 'Lineage oracle cwd'), 4, 'Lineage oracle cwd');
    const input = Buffer.from(JSON.stringify({ source, vectors }));
    const result = await runRetainedCommandBytes(issueRetainedCommandBoundary({ executable, workingDirectory: cwd }),
      ['-I', '-S', '-c', oracle], { input, maxStdinBytes: 128 * 1024, timeoutMs: 5000,
        maxStdoutBytes: 16 * 1024, maxStderrBytes: 16 * 1024, envMode: 'replace', env: { PATH: '/usr/bin:/bin' } });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(Buffer.from(result.stdout).toString('utf8')).toBe('pure-lineage-oracles-passed\n');
  } catch (error) {
    primary = { label: 'Pure lineage oracle assertion', error };
    throw error;
  } finally {
    settleResources({ ...(primary === undefined ? {} : { primary }), cleanup: [
      ...(cwd === undefined ? [] : [{ label: 'Lineage oracle cwd', settle: () => cwd!.dispose() }]),
      { label: 'Lineage oracle executable', settle: () => executable.dispose() }
    ] });
  }
});
