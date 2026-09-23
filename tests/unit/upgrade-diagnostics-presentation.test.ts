import { expect, test } from 'bun:test';

import { projectUpgradeDiagnostics } from '../../src/application/upgrade-diagnostics.ts';
import { formatUpgradeDiagnostics } from '../../src/entry/cli/upgrade-diagnostics.ts';
import { buildUpgradeDiagnostics } from '../helpers/upgrade-fixtures.ts';

test('upgrade diagnostics projection reuses assurance attribution while entry only renders', () => {
  const diagnostics = buildUpgradeDiagnostics({
    details: {
      migrationId: 'mig-target-escape',
      migrationKind: 'file-replace',
      path: '../outside-project.md',
      role: 'target'
    }
  });

  const view = projectUpgradeDiagnostics(diagnostics);

  expect(view).toEqual({
    phase: 'planning',
    blockId: 'private/block-upgrade',
    targetVersion: '0.2.0',
    status: 'blocked',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root',
    attribution: [
      'migration=mig-target-escape',
      'kind=file-replace',
      'target=../outside-project.md'
    ]
  });
  expect(formatUpgradeDiagnostics(view)).toBe([
    'Upgrade diagnostics planning',
    'Block: private/block-upgrade; target: 0.2.0; status: blocked',
    'Failed check: migration-targets; code: UPGRADE-MIGRATION-004',
    'Message: Migration path "../outside-project.md" escapes project root',
    'Attribution: migration=mig-target-escape, kind=file-replace, target=../outside-project.md'
  ].join('\n'));
});
