import { expect, test } from 'bun:test';
import { parseVerificationSessionCommand } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';

test('command parsing preserves each supported operation and its arguments', () => {
  const invocations = [
    ['project', '--default-ref', 'main'],
    ['prepare', '--pr', '42', '--request-output', 'request.json', '--execution', 'hosted'],
    ['revalidate-review-provider', '--pr', '42'],
    ['observe-hosted', '--request', 'request.json', '--output', 'facts.json'],
    ['prepare-hosted', '--request', 'request.json', '--facts', 'facts.json', '--output', 'envelope.json'],
    ['artifact-status', '--artifact', 'artifact.json'],
    ['finalize-hosted', '--envelope', 'envelope.json', '--evidence', 'evidence.json', '--output', 'artifact.json'],
    ['local-main-closeout', '--repository', 'sec-platform/sec', '--pr', '42', '--protected-root', '/repo', '--expected-local-head', 'a'.repeat(40)],
    ['resume', '--request', 'request.json', '--execution', 'hosted'],
    ['freeze', '--artifact', 'artifact.json', '--session-output', 'session.json', '--scope-output', 'scope.json'],
    ['status', '--request', 'request.json', '--execution', 'local'],
    ['status-offline', '--session-file', 'session.json']
  ];
  for (const invocation of invocations) {
    const parsed = parseVerificationSessionCommand([...invocation, '--json']);
    expect(parsed.command === invocation[0]).toBe(true);
    expect(parsed.repository).toBe('sec-platform/sec');
    expect([...parsed.args]).toEqual(invocation.slice(1).reduce<[string, string][]>((pairs, value, index, values) => {
      if (index % 2 === 0) pairs.push([value, values[index + 1]!]);
      return pairs;
    }, []));
  }
});

test('command parsing rejects missing, inherited, and unsupported command names', () => {
  expect(() => parseVerificationSessionCommand([])).toThrow(/Unknown command/);
  for (const command of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty', '', 'Prepare', ' prepare', 'prepare ', 'integrate-hosted']) {
    expect(() => parseVerificationSessionCommand([command])).toThrow(/Unknown command/);
  }
});

test('command parsing rejects nonprimitive command names without coercion', () => {
  let coercions = 0;
  const pretendCommand = {
    [Symbol.toPrimitive]() { coercions += 1; return 'prepare'; },
    toString() { coercions += 1; return 'prepare'; },
    valueOf() { coercions += 1; return 'prepare'; }
  };
  for (const command of [undefined, null, false, 0, Symbol('prepare'), ['prepare'], new String('prepare'), pretendCommand]) {
    expect(() => parseVerificationSessionCommand([command])).toThrow(/Unknown command/);
  }
  expect(coercions).toBe(0);
});

test('command parsing never invokes caller methods or admits nonprimitive flag values', () => {
  let callerMethodCalls = 0;
  const pretendText = {
    startsWith() { callerMethodCalls += 1; return false; },
    toString() { callerMethodCalls += 1; return 'request.json'; }
  };
  expect(() => parseVerificationSessionCommand(['resume', pretendText])).toThrow(/must be a string/);
  for (const value of [undefined, null, false, 42, Symbol('request.json'), ['request.json'], new String('request.json'), pretendText]) {
    expect(() => parseVerificationSessionCommand(['resume', '--request', value])).toThrow(/Missing value/);
  }
  expect(callerMethodCalls).toBe(0);
  expect(parseVerificationSessionCommand(['resume', '--request', 'request.json']).args.get('--request')).toBe('request.json');
});
