export type UpgradeWorkspaceRequest = Readonly<{
  readonly mode: 'preview' | 'apply';
}>;

export interface UpgradeWorkspaceOperations<TPreview, TApplied> {
  preview(): Promise<TPreview>;
  apply(): Promise<TApplied>;
}

export function prepareUpgradeWorkspaceRequest(
  options: Readonly<{ dryRun?: boolean }> = {}
): UpgradeWorkspaceRequest {
  return Object.freeze({ mode: options.dryRun === true ? 'preview' : 'apply' });
}

/** Route one upgrade request without owning workspace or lease mechanics. */
export function executeUpgradeWorkspace<TPreview, TApplied>(
  request: UpgradeWorkspaceRequest,
  operations: UpgradeWorkspaceOperations<TPreview, TApplied>
): Promise<TPreview | TApplied> {
  return request.mode === 'preview'
    ? operations.preview()
    : operations.apply();
}
