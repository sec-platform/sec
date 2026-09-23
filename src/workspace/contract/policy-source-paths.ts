import { modelRelativePath } from './types.ts';

/** Canonical logical roots in the current authoring/report format, independent of host lookup. */
export const POLICY_SOURCE_PATHS = Object.freeze({
  official: 'catalog/policies/official',
  project: `${modelRelativePath}/policies`
});
