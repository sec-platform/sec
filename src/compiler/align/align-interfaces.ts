import { CodedFailure } from '../../contracts/failure.ts';
import type { ManifestEntry, PlanFile } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';

/** The hard target condition shared by explicit admission and automatic candidates. */
export function isManifestStackCompatible(stackProfiles: readonly string[]): boolean {
  return stackProfiles.includes(SUPPORTED_STACK);
}

/** Apply the same target-stack rule to explicit blocks and selected dependencies. */
export function assertManifestStackCompatibility(blockId: string, stackProfiles: readonly string[]): void {
  if (!isManifestStackCompatible(stackProfiles)) {
    throw new CodedFailure('ALIGN-STACK-001', `Block "${blockId}" does not support ${SUPPORTED_STACK}`);
  }
}

export function alignInterfaces(plan: PlanFile, manifestMap: Map<string, ManifestEntry>): void {
  for (const block of plan.blocks) {
    const entry = manifestMap.get(block.id);
    if (!entry) {
      throw new CodedFailure('MANIFEST-SCHEMA-004', `Unknown block "${block.id}"`);
    }
    assertManifestStackCompatibility(block.id, entry.manifest.stackProfiles);
  }
}
