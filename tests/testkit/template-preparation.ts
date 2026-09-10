const templatePipelines = Object.freeze({
  'empty-default': null,
  'resolved-default': Object.freeze({ through: 'resolve', verificationLane: 'all' } as const),
  'composed-default': Object.freeze({ through: 'compose', verificationLane: 'all' } as const),
  'verified-fast-default': Object.freeze({ through: 'verify', verificationLane: 'fast' } as const),
  'locked-default': Object.freeze({ through: 'lock', verificationLane: 'all' } as const),
  'locked-all-default': Object.freeze({ through: 'lock', verificationLane: 'all' } as const),
  'explained-all-default': Object.freeze({ through: 'emit', verificationLane: 'all' } as const)
});

export type WorkspaceTemplateKind = keyof typeof templatePipelines;

/** Existing template identities and their pipeline decisions share one owner.
 * A TypeScript union alone cannot prevent a runtime path-shaped kind from
 * escaping the run template namespace before initialization.
 */
export function workspaceTemplatePipeline(kind: WorkspaceTemplateKind) {
  if (typeof kind !== 'string' || !Object.hasOwn(templatePipelines, kind)) {
    throw new TypeError('Unknown workspace template kind');
  }
  return templatePipelines[kind];
}

/** One preparation per key inside a run-owned template namespace. This is not
 * a filesystem lock, cross-process cache or readiness proof. Only concurrent
 * work is shared; every later call must perform its own readiness observation.
 * A failed preparation is removed so the existing owner can retry explicitly.
 */
export function createTemplatePreparation<Key>(
  prepare: (key: Key) => Promise<string>
): (key: Key) => Promise<string> {
  const pending = new Map<Key, Promise<string>>();
  return key => {
    const existing = pending.get(key);
    if (existing !== undefined) return existing;
    const result = Promise.resolve().then(() => prepare(key)).finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
    pending.set(key, result);
    return result;
  };
}

export interface WorkspacePipelineFixtureOptions {
  readonly prefix?: string;
  readonly blockIds?: readonly string[];
}

/** Capture requests, not compiler semantics. The existing block loader remains
 * responsible for canonical Block IDs and their actual registry definitions.
 */
export function captureWorkspacePipelineOptions(options: WorkspacePipelineFixtureOptions = {}) {
  const { prefix, blockIds } = options;
  if (prefix !== undefined && typeof prefix !== 'string') throw new TypeError('Workspace prefix must be a string');
  if (blockIds !== undefined && !Array.isArray(blockIds)) throw new TypeError('Workspace blockIds must be an array');
  const selected = blockIds === undefined ? [] : Array.from(blockIds);
  if (selected.some(id => typeof id !== 'string')) throw new TypeError('Workspace blockIds must contain strings');
  return Object.freeze({ prefix, blockIds: Object.freeze(selected) });
}
