import { uniqueSorted } from './collections.ts';

export type SemanticTestImpact = {
  slow: string[];
  owners: string[];
};

const SEMANTIC_CORE_SOURCE_PATTERNS = [
  /^platform\/compiler\/(semantic-lowering|semantic-plan|semantic-output-paths|state-transition-plan)\.ts$/,
  /^platform\/compiler\/emit\/write-provenance\.ts$/,
  /^platform\/shared\/semantic-(contract|generator)-types\.ts$/,
  /^platform\/registry\/.+\/block\.manifest\.ya?ml$/,
  /^platform\/registry\/.+\/contracts\/.+\.ya?ml$/,
  /^source\/model\/.+\.ya?ml$/
];

export function selectSemanticTestImpact(files: readonly string[]): SemanticTestImpact {
  const changed = files.some((file) =>
    SEMANTIC_CORE_SOURCE_PATTERNS.some((pattern) => pattern.test(file))
  );
  return {
    slow: changed ? ['tests/e2e/semantic-runtime-contract.test.ts'] : [],
    owners: changed ? ['semantic-core'] : []
  };
}

export function semanticImpactSourcePatterns(): RegExp[] {
  return [...SEMANTIC_CORE_SOURCE_PATTERNS];
}
