import { expect, test } from 'bun:test';

import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import { projectStateView } from '../../src/compiler/projection/project-state-view.ts';
import { readyTransactionFixture } from '../helpers/semantic-mutation/recovery-fixture.ts';

test('semantic core projects architecture and state from one validated in-memory snapshot', () => {
  const snapshot = readyTransactionFixture('request:semantic-core-fast').base.snapshot;
  const architecture = projectArchitectureView(snapshot, 'responsibility:item:ItemStateMachine');
  const state = projectStateView(snapshot, 'state:item:item-status');

  expect(architecture.subject).toBe('responsibility:item:ItemStateMachine');
  expect(architecture.nodes.some((node) =>
    node.entityId === 'responsibility:item:ItemStateMachine'
  )).toBe(true);
  expect(state.subject).toBe('state:item:item-status');
  expect(state.nodes.some((node) => node.entityId === 'state:item:item-status')).toBe(true);
});
