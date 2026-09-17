import { Command } from 'commander';
import { jsonOpts } from '../../src/bootstrap/cli/command-options.ts';
import { commandValue } from '../../src/entry/cli/command-value.ts';
import { registerWorkspaceAction } from '../../src/bootstrap/cli/workspace-action.ts';

// Compile-only: transport inputs, admitted requests and executor results are
// separate types. A projection cannot silently consume a different result.
function workspaceActionTypes(command: Command) {
  registerWorkspaceAction<[string], number, string>(command, {
    decode: (raw) => ({ request: Number(raw), output: jsonOpts({}) }),
    execute: async (_root, value) => String(value),
    view: (value) => commandValue(value, (text) => text.toUpperCase())
  });
  registerWorkspaceAction<[], number, string>(command, {
    // @ts-expect-error Decoder output must match the request contract.
    decode: () => ({ request: 'wrong', output: jsonOpts({}) }),
    execute: async (_root, value) => String(value),
    view: (value) => commandValue(value, String)
  });
  registerWorkspaceAction<[], number, string>(command, {
    decode: () => ({ request: 7, output: jsonOpts({}) }),
    // @ts-expect-error Executor result must match the projection contract.
    execute: async () => 7,
    view: (value) => commandValue(value, String)
  });
  registerWorkspaceAction<[], number, string>(command, {
    decode: () => ({ request: 7, output: jsonOpts({}) }),
    execute: async () => 'value',
    // @ts-expect-error A string result cannot be projected as a number.
    view: (value: number) => commandValue(value, String)
  });
}
void workspaceActionTypes;
