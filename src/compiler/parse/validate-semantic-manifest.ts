import { isCanonicalAcceptanceId } from '../../semantic/acceptance/contract/identity.ts';
import { SEMANTIC_GENERATOR_ARTIFACT_KINDS, SEMANTIC_GENERATOR_CONSUME_KINDS, SEMANTIC_GENERATOR_KINDS, type StateTransitionMapManifestGenerator } from '../../semantic/generation/contract/types.ts';
import { isCanonicalBlockId } from '../../semantic/identity/contract/block.ts';
import { isCanonicalSlotId } from '../../semantic/identity/contract/slot.ts';
import { isCanonicalPortableLogicalPath, isCanonicalPortableLogicalPathPrefix } from '../../system-architecture/foundation/contract/logical-path.ts';
import type { BlockManifest } from '../contract.ts';
import { CompilerError } from '../errors.ts';

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
    if (!contract?.path || !isCanonicalPortableLogicalPath(contract.path)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-011',
        `Manifest "${manifest.id}" contract paths must use canonical portable logical identity`
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

function validateSlotIdentities(manifest: BlockManifest): void {
  if (!Array.isArray(manifest.slots)) return;
  const seenIds = new Set<string>();
  for (const slot of manifest.slots) {
    if (!slot || typeof slot !== 'object' || !isCanonicalSlotId(slot.id)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-023',
        `Manifest "${manifest.id}" has a non-canonical Slot id "${String(slot?.id)}"`
      );
    }
    if (seenIds.has(slot.id)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-024',
        `Manifest "${manifest.id}" repeats Slot id "${slot.id}"`
      );
    }
    seenIds.add(slot.id);
  }
}

function validateMaterializationPaths(manifest: BlockManifest): void {
  if (Array.isArray(manifest.installs)) {
    for (const install of manifest.installs) {
      if (
        !install || typeof install !== 'object' ||
        typeof install.from !== 'string' ||
        typeof install.to !== 'string' ||
        !isCanonicalPortableLogicalPath(install.from) ||
        !isCanonicalPortableLogicalPath(install.to)
      ) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-006',
          `Manifest "${manifest.id}" install paths must use canonical portable logical identity`
        );
      }
    }
  }

  if (Array.isArray(manifest.slots)) {
    for (const slot of manifest.slots) {
      if (
        !slot || typeof slot !== 'object' ||
        typeof slot.target !== 'string' ||
        !isCanonicalPortableLogicalPath(slot.target)
      ) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-007',
          `Manifest "${manifest.id}" Slot target must use canonical portable logical identity`
        );
      }
      if (
        slot.writableZones !== undefined &&
        (!Array.isArray(slot.writableZones) ||
          slot.writableZones.some((zone) =>
            typeof zone !== 'string' || !isCanonicalPortableLogicalPathPrefix(zone)))
      ) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-008',
          `Manifest "${manifest.id}" Slot writableZones must be canonical portable directory prefixes ending in /`
        );
      }
    }
  }
}

function validateAcceptanceIdentities(manifest: BlockManifest): void {
  if (!Array.isArray(manifest.acceptance)) return;
  const seenIds = new Set<string>();
  for (const acceptance of manifest.acceptance) {
    if (!acceptance || typeof acceptance !== 'object' || !isCanonicalAcceptanceId(acceptance.id)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-025',
        `Manifest "${manifest.id}" has a non-canonical Acceptance id "${String(acceptance?.id)}"`
      );
    }
    if (seenIds.has(acceptance.id)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-026',
        `Manifest "${manifest.id}" repeats Acceptance id "${acceptance.id}"`
      );
    }
    seenIds.add(acceptance.id);

    if (
      acceptance.dependsOn !== undefined &&
      (!Array.isArray(acceptance.dependsOn) || acceptance.dependsOn.some((id) => !isCanonicalAcceptanceId(id)))
    ) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-025',
        `Acceptance "${acceptance.id}" has a non-canonical dependency identity`
      );
    }
    if (
      acceptance.covers?.blocks !== undefined &&
      (!Array.isArray(acceptance.covers.blocks) || acceptance.covers.blocks.some((id) => !isCanonicalBlockId(id)))
    ) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-025',
        `Acceptance "${acceptance.id}" has a non-canonical Block coverage identity`
      );
    }
    if (
      acceptance.covers?.slots !== undefined &&
      (!Array.isArray(acceptance.covers.slots) || acceptance.covers.slots.some((id) => !isCanonicalSlotId(id)))
    ) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-025',
        `Acceptance "${acceptance.id}" has a non-canonical Slot coverage identity`
      );
    }
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
    if (!generator.target || !isCanonicalPortableLogicalPath(generator.target)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-017',
        `Generator "${generator.id}" target must use canonical portable logical identity`
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
  validateSlotIdentities(manifest);
  validateMaterializationPaths(manifest);
  validateAcceptanceIdentities(manifest);
  validateGenerators(manifest);
}
