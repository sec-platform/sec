import { CompilerError } from '../../shared/errors.ts';
import { isSafeRelativePath } from '../../shared/paths.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import {
  SEMANTIC_GENERATOR_ARTIFACT_KINDS,
  SEMANTIC_GENERATOR_CONSUME_KINDS,
  SEMANTIC_GENERATOR_KINDS,
  type StateTransitionMapManifestGenerator
} from '../../shared/semantic-generator-types.ts';

function validateStateTransitionMapGenerator(generator: StateTransitionMapManifestGenerator): void {
  if (!generator.contract?.trim() || !generator.state?.trim()) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Generator "${generator.id}" requires contract and state selectors`
    );
  }
  if (
    !Array.isArray(generator.consumes) ||
    generator.consumes.length === 0 ||
    generator.consumes.some((kind) => !SEMANTIC_GENERATOR_CONSUME_KINDS.includes(kind)) ||
    !generator.consumes.includes('state') ||
    !generator.consumes.includes('transition')
  ) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-018',
      `Generator "${generator.id}" must consume state and transition semantics`
    );
  }
  if (!SEMANTIC_GENERATOR_ARTIFACT_KINDS.includes(generator.produces)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-019',
      `Generator "${generator.id}" uses unsupported artifact kind "${String(generator.produces)}"`
    );
  }
  if (
    !generator.typeBinding?.name?.trim() ||
    !generator.typeBinding.importFrom?.trim() ||
    !/^\.\.?\//u.test(generator.typeBinding.importFrom)
  ) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-020',
      `Generator "${generator.id}" requires a relative TypeScript type binding`
    );
  }
}

function validateContractReferences(manifest: BlockManifest): void {
  const seenPaths = new Set<string>();

  for (const contract of manifest.contracts ?? []) {
    if (!contract?.path || !isSafeRelativePath(contract.path)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-011',
        `Manifest "${manifest.id}" contract paths must stay inside the block root`
      );
    }
    if (seenPaths.has(contract.path)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-012',
        `Manifest "${manifest.id}" repeats contract path "${contract.path}"`
      );
    }
    seenPaths.add(contract.path);
  }
}

function validateGenerators(manifest: BlockManifest): void {
  const seenIds = new Set<string>();

  for (const generator of manifest.generators ?? []) {
    if (!generator?.id?.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(generator.id)) {
      throw new CompilerError('MANIFEST-SCHEMA-013', `Manifest "${manifest.id}" generators require a stable token id`);
    }
    if (seenIds.has(generator.id)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-014',
        `Manifest "${manifest.id}" repeats generator id "${generator.id}"`
      );
    }
    seenIds.add(generator.id);

    if (!SEMANTIC_GENERATOR_KINDS.includes(generator.kind)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-015',
        `Generator "${generator.id}" uses unsupported kind "${String(generator.kind)}"`
      );
    }
    if (!generator.target || !isSafeRelativePath(generator.target)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-017',
        `Generator "${generator.id}" target must stay inside the project tree`
      );
    }
    if (!Array.isArray(generator.verification) || generator.verification.length === 0) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-021',
        `Generator "${generator.id}" requires verification selectors`
      );
    }

    switch (generator.kind) {
      case 'generate-state-transition-map':
        validateStateTransitionMapGenerator(generator);
        break;
    }
  }
}

export function normalizeAndValidateSemanticManifestFields(manifest: BlockManifest): void {
  manifest.contracts ??= [];
  manifest.generators ??= [];
  validateContractReferences(manifest);
  validateGenerators(manifest);
}
