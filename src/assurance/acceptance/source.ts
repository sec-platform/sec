import type { LockFile } from '../../compiler/contract.ts';
import { canonicalEquals, compareCodeUnits, isPlainObject, uniqueSorted } from '../../contracts/canonical.ts';
import { isSecRepositoryTestModulePath } from '../../contracts/repository-test-path.ts';
import { isCanonicalAcceptanceId } from '../../semantics/acceptance/identity.ts';
import { canonicalAcceptanceTestPath, validateAcceptanceItem } from '../../semantics/acceptance/source.ts';
import type { AcceptanceSource } from '../../semantics/acceptance/types.ts';
import { isCanonicalBlockId } from '../../semantics/identity/block.ts';

export interface AcceptanceCoverageSource {
  resolvedBlockIds: string[];
  acceptancePlan: string[];
  declarations: AcceptanceSource[];
  tests: Array<{ testPath: string; blockId: string }>;
}

function keys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || required.some(key => !Object.hasOwn(value, key))
      || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) {
    throw new Error('Acceptance Coverage source has an unsupported field set');
  }
}

function ids(value: unknown, valid: (id: string) => boolean, label: string): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !valid(id))
      || !canonicalEquals(value, uniqueSorted(value))) throw new Error(`${label} must be unique canonical identities`);
  return [...value];
}

export function validateAcceptanceCoverageSource(value: unknown): AcceptanceCoverageSource {
  keys(value, ['resolvedBlockIds', 'acceptancePlan', 'declarations', 'tests']);
  const resolvedBlockIds = ids(value.resolvedBlockIds, isCanonicalBlockId, 'Resolved blocks');
  const acceptancePlan = ids(value.acceptancePlan, isCanonicalAcceptanceId, 'Acceptance plan');
  const resolved = new Set(resolvedBlockIds);
  if (!Array.isArray(value.declarations) || !Array.isArray(value.tests)) throw new Error('Acceptance source declarations/tests must be arrays');
  const declarations: AcceptanceSource[] = value.declarations.map(raw => {
    keys(raw, ['declaringBlockId', 'acceptance']);
    if (typeof raw.declaringBlockId !== 'string' || !resolved.has(raw.declaringBlockId)) throw new Error('Acceptance source has unknown declaring block');
    const acceptance = validateAcceptanceItem(raw.acceptance);
    if (acceptance.dependsOn !== undefined) ids(acceptance.dependsOn, isCanonicalAcceptanceId, 'Acceptance dependencies');
    if (acceptance.covers?.blocks !== undefined) {
      const blocks = ids(acceptance.covers.blocks, isCanonicalBlockId, 'Acceptance covers');
      if (blocks.some(id => !resolved.has(id))) throw new Error('Acceptance source references unknown resolved block');
    }
    return { declaringBlockId: raw.declaringBlockId, acceptance };
  });
  const declarationKeys = declarations.map(entry => `${entry.declaringBlockId}:${entry.acceptance.id}`);
  if (!canonicalEquals(declarationKeys, uniqueSorted(declarationKeys))) throw new Error('Acceptance declarations must be unique and canonically ordered');
  const tests = value.tests.map(raw => {
    keys(raw, ['testPath', 'blockId']);
    if (typeof raw.testPath !== 'string' || typeof raw.blockId !== 'string' || !resolved.has(raw.blockId)) throw new Error('Acceptance source has unknown test owner');
    return { testPath: canonicalAcceptanceTestPath(raw.testPath), blockId: raw.blockId };
  });
  if (!canonicalEquals(tests.map(test => test.testPath), uniqueSorted(tests.map(test => test.testPath)))) throw new Error('Acceptance test ownership must be unique and canonically ordered');
  return { resolvedBlockIds, acceptancePlan, declarations, tests };
}

/** A mechanical projection of the captured Lock, never a caller-owned binding registry. */
export function acceptanceCoverageSource(lock: LockFile): AcceptanceCoverageSource {
  if (lock.acceptanceSources === undefined) throw new Error('Historical Lock lacks acceptanceSources; resolve the current manifests before verification');
  const declarations = lock.acceptanceSources.map(({ declaringBlockId, acceptance }) => ({
    declaringBlockId,
    acceptance: {
      ...structuredClone(acceptance),
      ...(acceptance.dependsOn === undefined ? {} : { dependsOn: uniqueSorted(acceptance.dependsOn) }),
      ...(acceptance.covers?.blocks === undefined ? {} : { covers: { blocks: uniqueSorted(acceptance.covers.blocks) } })
    }
  })).sort((left, right) => compareCodeUnits(`${left.declaringBlockId}:${left.acceptance.id}`, `${right.declaringBlockId}:${right.acceptance.id}`));
  const tests = lock.installPlan.filter(step => step.to.startsWith('tests/acceptance/') && isSecRepositoryTestModulePath(step.to)).map(step => ({
    testPath: canonicalAcceptanceTestPath(step.to), blockId: step.blockId
  })).sort((left, right) => compareCodeUnits(left.testPath, right.testPath));
  return validateAcceptanceCoverageSource({ resolvedBlockIds: uniqueSorted(lock.resolvedBlocks.map(block => block.id)),
    acceptancePlan: uniqueSorted(lock.acceptancePlan), declarations, tests });
}
