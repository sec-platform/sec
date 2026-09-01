import type { ManifestEntry, PlanFile } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';
import { CompilerError } from '../errors.ts';

export function alignInterfaces(plan: PlanFile, manifestMap: Map<string, ManifestEntry>): void {
  for (const block of plan.blocks) {
    const entry = manifestMap.get(block.id);
    if (!entry) {
      throw new CompilerError('MANIFEST-SCHEMA-004', `Unknown block "${block.id}"`);
    }
    if (!entry.manifest.stackProfiles.includes(SUPPORTED_STACK)) {
      throw new CompilerError('ALIGN-STACK-001', `Block "${block.id}" does not support ${SUPPORTED_STACK}`);
    }
  }
}
