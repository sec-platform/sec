export const TEST_IMPACT_SOURCE_KINDS = [
  'typescript',
  'manifest',
  'semantic-contract',
  'source-model',
  'workflow',
  'git-hook',
  'active-documentation',
  'agent-skill',
  'agent-role',
  'repository-config'
] as const;

export type TestImpactSourceKind = (typeof TEST_IMPACT_SOURCE_KINDS)[number];

export type TestImpactRiskPolicy = 'slow-risk-baseline' | 'typecheck-only';

/** Compile-only contract sources live in the test namespace but are not Bun
 * test modules. Physical Source Program membership and the absence of runtime
 * consumers are validated by the provider before this lexical identity can
 * satisfy TestImpact ownership. */
export function isTypecheckOnlyTestPath(file: string): boolean {
  return /^tests\/.+\.typecheck\.ts$/u.test(file);
}

export type ResolvedTestOwnership = {
  source: string;
  owner: string;
  identity: { kind: 'module'; id: string };
};

/**
 * Non-code inputs join the same module graph through semantic ownership.
 * This is intentionally a small kind-to-owner relation, not a source/test
 * path mirror. TypeScript and imported machine data use their real import and
 * module membership edges directly.
 */
const TEST_IMPACT_SOURCE_KIND_MODULES: Readonly<
  Partial<Record<TestImpactSourceKind, readonly string[]>>
> = Object.freeze({
  'active-documentation': Object.freeze(['adapters.self-hosting.control.documentation']),
  'agent-skill': Object.freeze(['adapters.self-hosting.control.agent']),
  'agent-role': Object.freeze(['adapters.self-hosting.control.agent']),
  manifest: Object.freeze(['compiler.registry', 'compiler', 'adapters.workspace', 'semantics.definitions']),
  'semantic-contract': Object.freeze(['semantics.definitions', 'compiler', 'adapters.workspace']),
  'source-model': Object.freeze(['semantics.definitions', 'compiler', 'adapters.workspace']),
  workflow: Object.freeze(['assurance', 'adapters.verification', 'adapters.verification.platform.ci']),
  'git-hook': Object.freeze(['adapters.self-hosting.development.hooks']),
  'repository-config': Object.freeze(['adapters.self-hosting.development.runner', 'adapters.toolchain', 'compiler'])
});

export function testImpactModuleIdsForSourceKind(
  kind: TestImpactSourceKind | null
): readonly string[] {
  return kind === null ? [] : TEST_IMPACT_SOURCE_KIND_MODULES[kind] ?? [];
}

export function classifyTestImpactSource(
  file: string,
  activeDocumentationPath: (candidate: string) => boolean,
  gitHookEntrypointPath: (candidate: string) => boolean = () => false
): TestImpactSourceKind | null {
  if (activeDocumentationPath(file)) return 'active-documentation';
  if (gitHookEntrypointPath(file)) return 'git-hook';
  if (/^\.agents\/skills\/[^/]+\/SKILL\.md$/u.test(file)) return 'agent-skill';
  if (/^\.codex\/agents\/[^/]+\.toml$/u.test(file)) return 'agent-role';
  if (/^docs\//u.test(file)) return null;
  if (/(?:^|\/)contracts\/[^/]+\.ya?ml$/u.test(file)) return 'semantic-contract';
  if (/(?:^|\/)(?:block\.)?manifest\.ya?ml$/u.test(file) || /(?:^|\/)[^/]+\.manifest\.ya?ml$/u.test(file)) return 'manifest';
  if (/^source\//u.test(file)) return 'source-model';
  if (/\.[cm]?tsx?$/u.test(file)) return 'typescript';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file)) return 'workflow';
  if (/^(?:package\.json|bun\.lock)$/u.test(file)) return 'repository-config';
  return null;
}
