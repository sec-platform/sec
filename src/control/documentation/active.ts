import authoritySource from '../../../docs/authority.json' with { type: 'json' };

import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../system-architecture/foundation/contract/repository-path.ts';
import {
  activeDocumentationPaths,
  documentationRecordByPath,
  parseDocumentationAuthorityRegistry
} from './authority.ts';

const ACTIVE_DOCUMENTATION_REGISTRY = parseDocumentationAuthorityRegistry(JSON.stringify(authoritySource));
const ACTIVE_DOCUMENTATION_PATH_LIST = Object.freeze(activeDocumentationPaths(ACTIVE_DOCUMENTATION_REGISTRY));
const ACTIVE_DOCUMENTATION_PATHS = new Set(ACTIVE_DOCUMENTATION_PATH_LIST);

export function currentActiveDocumentationPaths(): readonly string[] {
  return ACTIVE_DOCUMENTATION_PATH_LIST;
}

export function isActiveDocumentationPath(file: string): boolean {
  return CodexDevelopmentIsCanonicalRepositoryPath(file)
    && ACTIVE_DOCUMENTATION_PATHS.has(file);
}

export function activeDocumentationRecord(file: string) {
  if (!CodexDevelopmentIsCanonicalRepositoryPath(file)) return undefined;
  return documentationRecordByPath(ACTIVE_DOCUMENTATION_REGISTRY, file);
}
