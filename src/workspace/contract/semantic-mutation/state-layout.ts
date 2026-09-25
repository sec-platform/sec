import path from 'node:path';

const TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}$/u;
const CURRENT_STATE_SEGMENTS = ['.sec', 'semantic-mutation', 'journal'] as const;
const CURRENT_TRANSACTION_SEGMENTS = [...CURRENT_STATE_SEGMENTS, 'transactions'] as const;
const LEGACY_STATE_SEGMENTS = ['.sec', 'semantic-mutation', 'v1'] as const;
const LEGACY_TRANSACTION_SEGMENTS = [...LEGACY_STATE_SEGMENTS, 'transactions'] as const;

export type SemanticMutationStateLayout = 'current' | 'legacy';

export interface SemanticMutationTransactionLocation {
  readonly workspaceRoot: string;
  readonly transactionRoot: string;
  readonly transactionName: string;
  readonly layout: SemanticMutationStateLayout;
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function stateSegments(layout: SemanticMutationStateLayout): readonly string[] {
  return layout === 'current' ? CURRENT_STATE_SEGMENTS : LEGACY_STATE_SEGMENTS;
}

function transactionSegments(layout: SemanticMutationStateLayout): readonly string[] {
  return layout === 'current' ? CURRENT_TRANSACTION_SEGMENTS : LEGACY_TRANSACTION_SEGMENTS;
}

export function semanticMutationStateRoot(
  workspaceRoot: string,
  layout: SemanticMutationStateLayout = 'current'
): string {
  return path.join(path.resolve(workspaceRoot), ...stateSegments(layout));
}

export function semanticMutationTransactionsRoot(
  workspaceRoot: string,
  layout: SemanticMutationStateLayout = 'current'
): string {
  return path.join(path.resolve(workspaceRoot), ...transactionSegments(layout));
}

export function semanticMutationTransactionRootForLayout(
  workspaceRoot: string,
  transactionName: string,
  layout: SemanticMutationStateLayout = 'current'
): string {
  if (!TRANSACTION_NAME_PATTERN.test(transactionName)) {
    throw new Error('Semantic Mutation transaction name is invalid');
  }
  return path.join(semanticMutationTransactionsRoot(workspaceRoot, layout), transactionName);
}

export function classifySemanticMutationTransactionRoot(
  transactionRoot: string
): SemanticMutationTransactionLocation | null {
  if (!path.isAbsolute(transactionRoot) || path.normalize(transactionRoot) !== transactionRoot) return null;
  const resolvedRoot = path.resolve(transactionRoot);
  const transactionName = path.basename(resolvedRoot);
  if (!TRANSACTION_NAME_PATTERN.test(transactionName)) return null;

  for (const layout of ['current', 'legacy'] as const) {
    let workspaceRoot = path.dirname(resolvedRoot);
    for (const segment of [...transactionSegments(layout)].reverse()) {
      if (path.basename(workspaceRoot) !== segment) {
        workspaceRoot = '';
        break;
      }
      workspaceRoot = path.dirname(workspaceRoot);
    }
    if (workspaceRoot === '') continue;
    const expected = semanticMutationTransactionRootForLayout(workspaceRoot, transactionName, layout);
    if (samePath(expected, resolvedRoot)) {
      return Object.freeze({ workspaceRoot, transactionRoot: resolvedRoot, transactionName, layout });
    }
  }
  return null;
}
