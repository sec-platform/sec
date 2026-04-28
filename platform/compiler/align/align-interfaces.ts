import { CompilerError } from '../../shared/errors.ts';
import { SUPPORTED_STACK } from '../../shared/constants.ts';
import type { ManifestEntry, PlanFile } from '../../shared/plan-manifest-types.ts';

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

  for (const slot of plan.slots) {
    const entry = manifestMap.get(slot.block);
    if (!entry) {
      throw new CompilerError('MANIFEST-SCHEMA-004', `Unknown block "${slot.block}"`);
    }
    const manifestSlot = entry.manifest.slots.find((candidate) => candidate.id === slot.id);
    if (!manifestSlot) {
      throw new CompilerError('ALIGN-SLOT-001', `Block "${slot.block}" does not expose slot "${slot.id}"`);
    }
    if (manifestSlot.kind !== slot.kind) {
      throw new CompilerError('ALIGN-SLOT-002', `Slot "${slot.id}" kind mismatch`);
    }
    if (manifestSlot.symbol !== slot.symbol) {
      throw new CompilerError('ALIGN-SLOT-003', `Slot "${slot.id}" symbol mismatch`);
    }
    if (!manifestSlot.writableZones?.some((zone) => slot.target.startsWith(zone))) {
      throw new CompilerError('ALIGN-SLOT-004', `Slot "${slot.id}" targets unauthorized path "${slot.target}"`);
    }
  }
}
