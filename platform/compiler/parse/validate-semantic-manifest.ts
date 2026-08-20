import { isCanonicalAcceptanceId } from '../../shared/acceptance-identity.ts';
import { isCanonicalBlockId } from '../../shared/block-identity.ts';
import { CompilerError } from '../../shared/errors.ts';
import {
  isCanonicalPortableLogicalPathPrefixV1,
  isCanonicalPortableLogicalPathV1
} from '../../shared/logical-path-identity.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import {
  SEMANTIC_GENERATOR_ARTIFACT_KINDS,
  SEMANTIC_GENERATOR_CONSUME_KINDS,
  SEMANTIC_GENERATOR_KINDS,
  type StateTransitionMapManifestGenerator
} from '../../shared/semantic-generator-types.ts';
import { isCanonicalSlotId } from '../../shared/slot-identity.ts';

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
    if (!contract?.path || !isCanonicalPortableLogicalPathV1(contract.path)) {
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
        !isCanonicalPortableLogicalPathV1(install.from) ||
        !isCanonicalPortableLogicalPathV1(install.to)
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
        !isCanonicalPortableLogicalPathV1(slot.target)
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
            typeof zone !== 'string' || !isCanonicalPortableLogicalPathPrefixV1(zone)))
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

function isCanonicalRoutePath(value: string): boolean {
  if (
    value.length === 0
    || value.normalize('NFC') !== value
    || !value.startsWith('/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (value.length > 1 && value.endsWith('/'))
  ) return false;
  if (value === '/') return true;
  const segments = value.slice(1).split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validateRoutes(manifest: BlockManifest): void {
  if (!Array.isArray(manifest.routes)) return;
  const seenPaths = new Set<string>();
  for (const route of manifest.routes) {
    if (
      !route
      || typeof route !== 'object'
      || typeof route.path !== 'string'
      || !isCanonicalRoutePath(route.path)
      || typeof route.file !== 'string'
      || !isCanonicalPortableLogicalPathV1(route.file)
    ) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-027',
        `Manifest "${manifest.id}" has a non-canonical route declaration`
      );
    }
    if (seenPaths.has(route.path)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-028',
        `Manifest "${manifest.id}" repeats route path "${route.path}"`
      );
    }
    seenPaths.add(route.path);
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
    if (!generator.target || !isCanonicalPortableLogicalPathV1(generator.target)) {
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
  validateRoutes(manifest);
  validateGenerators(manifest);
}
