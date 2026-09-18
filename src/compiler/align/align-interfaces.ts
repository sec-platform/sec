import type { ManifestEntry, PlanFile } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';
import { CompilerError } from '../errors.ts';

/** Apply the same target-stack rule to explicit blocks and selected dependencies. */
export function assertManifestStackCompatibility(blockId: string, stackProfiles: readonly string[]): void {
  if (!stackProfiles.includes(SUPPORTED_STACK)) {
    throw new CompilerError('ALIGN-STACK-001', `Block "${blockId}" does not support ${SUPPORTED_STACK}`);
  }
}

export function alignInterfaces(plan: PlanFile, manifestMap: Map<string, ManifestEntry>): void {
  for (const block of plan.blocks) {
    const entry = manifestMap.get(block.id);
    if (!entry) {
      throw new CompilerError('MANIFEST-SCHEMA-004', `Unknown block "${block.id}"`);
    }
    assertManifestStackCompatibility(block.id, entry.manifest.stackProfiles);
  }
}
