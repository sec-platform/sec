import { parseRepairCommandInput, parseUpgradeCommandInput } from '../../src/entry/cli/workspace-command-input.ts';

// Compile-only: a read-only route cannot acquire a write request by accident.
function upgradeInputTypes() {
  const input = parseUpgradeCommandInput('block', '1', {}, 'sec upgrade');
  if (input.kind === 'plan') {
    // @ts-expect-error A plan inspection has no write request.
    input.request;
    return;
  }
  if (input.kind === 'diagnostics') {
    // @ts-expect-error A diagnostics inspection has no write request.
    input.request;
    return;
  }
  input.request.dryRun;
  input.subject;
  input.targetVersion;
  // @ts-expect-error Captured write requests are immutable.
  input.request.dryRun = true;
}
function repairInputTypes() {
  const input = parseRepairCommandInput(undefined, {});
  if (input.kind === 'plan') {
    // @ts-expect-error A plan inspection has no write request.
    input.request;
    return;
  }
  input.request.dryRun;
}
void upgradeInputTypes;
void repairInputTypes;
