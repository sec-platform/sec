import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

const ACTIVE_DOCUMENTATION_PATTERNS_V1 = [
  /^README\.md$/u,
  /^docs\/.+\.md$/u,
  /^docs\/(?:governance|work)\/.+\.ya?ml$/u
] as const;

export function CodexDevelopmentIsActiveDocumentationPathV1(file: string): boolean {
  return CodexDevelopmentIsCanonicalRepositoryPathV1(file)
    && ACTIVE_DOCUMENTATION_PATTERNS_V1.some((pattern) => pattern.test(file));
}
