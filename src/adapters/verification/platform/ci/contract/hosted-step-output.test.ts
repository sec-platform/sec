import { expect, test } from 'bun:test';
import { parseHostedStepOutputLocation } from './hosted-job-runtime.ts';
const root = '/runner/temp';
const leaf = 'set_output_01234567-89ab-cdef-0123-456789abcdef';
const valid = `${root}/_runner_file_commands/${leaf}`;

test('hosted output accepts the supported runner slot without a host-specific absolute prefix', () => {
  expect(parseHostedStepOutputLocation(root, valid)).toEqual({ parentPath: `${root}/_runner_file_commands`, name: leaf });
  expect(parseHostedStepOutputLocation('/another/temp', `/another/temp/_runner_file_commands/${leaf}`)).toEqual({
    parentPath: '/another/temp/_runner_file_commands', name: leaf
  });
});

test('hosted output rejects traversal, arbitrary leaves and the same basename outside runner temp', () => {
  for (const value of [undefined, '/etc/passwd', `${root}/../temp/_runner_file_commands/${leaf}`,
    `/another/_runner_file_commands/${leaf}`, `${root}/_runner_file_commands/set_env_${leaf.slice(11)}`,
    `${root}/_runner_file_commands/${leaf}/extra`, `${root}//_runner_file_commands/${leaf}`,
    `${valid}\n`, `${valid}\\extra`]) expect(() => parseHostedStepOutputLocation(root, value)).toThrow();
  for (const value of [undefined, '/', 'relative', '/runner/../runner/temp', '/runner/temp\0']) {
    expect(() => parseHostedStepOutputLocation(value, valid)).toThrow();
  }
});

// Passing two mutually consistent selectors is not authentication. Production
// still requires the original source-checked GitHub origin and runner launch TCB.
