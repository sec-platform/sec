import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  classifySemanticMutationTransactionRoot,
  semanticMutationStateRoot,
  semanticMutationTransactionRootForLayout
} from '../../../src/workspace/contract/semantic-mutation/state-layout.ts';
import { isSemanticMutationStagingWorkspace } from '../../../src/workspace/contract/semantic-mutation/staging.ts';

const TRANSACTION_NAME = 'a'.repeat(64);

test('semantic mutation current state layout uses a semantic journal owner without a numeric generation', () => {
  const workspaceRoot = path.resolve('/tmp/semantic-mutation-layout');
  const root = semanticMutationTransactionRootForLayout(workspaceRoot, TRANSACTION_NAME);
  expect(root).toBe(path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'journal',
    'transactions',
    TRANSACTION_NAME
  ));
  expect(semanticMutationStateRoot(workspaceRoot)).toBe(
    path.join(workspaceRoot, '.sec', 'semantic-mutation', 'journal')
  );
  expect(classifySemanticMutationTransactionRoot(root)).toEqual({
    workspaceRoot,
    transactionRoot: root,
    transactionName: TRANSACTION_NAME,
    layout: 'current'
  });
  expect(isSemanticMutationStagingWorkspace(path.join(root, 'workspace'))).toBe(true);
});

test('semantic mutation legacy numeric state remains observable only as a legacy layout', () => {
  const workspaceRoot = path.resolve('/tmp/semantic-mutation-layout');
  const legacyRoot = semanticMutationTransactionRootForLayout(
    workspaceRoot,
    TRANSACTION_NAME,
    'legacy'
  );
  expect(classifySemanticMutationTransactionRoot(legacyRoot)?.layout).toBe('legacy');
  expect(isSemanticMutationStagingWorkspace(path.join(legacyRoot, 'workspace'))).toBe(true);
  expect(classifySemanticMutationTransactionRoot(
    path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v2', 'transactions', TRANSACTION_NAME)
  )).toBeNull();
});
