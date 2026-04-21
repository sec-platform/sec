import { readYaml } from '../../shared/yaml.ts';
import { CompilerError } from '../../shared/errors.ts';
import { SUPPORTED_STACK } from '../../shared/constants.ts';
import type { PlanFile } from '../../shared/types.ts';

export function normalizePlan(plan: PlanFile): PlanFile {
  const normalized = structuredClone((plan ?? {}) as Partial<PlanFile>);
  return {
    app: {
      name: normalized.app?.name ?? '',
      stack: normalized.app?.stack ?? '',
      packageManager: normalized.app?.packageManager ?? 'pnpm',
      mode: normalized.app?.mode ?? 'single-tenant'
    },
    blocks: normalized.blocks ?? [],
    slots: normalized.slots ?? [],
    acceptance: normalized.acceptance ?? []
  };
}

export function validatePlan(plan: PlanFile): void {
  if (!plan?.app?.name) {
    throw new CompilerError('PLAN-VALIDATION-001', 'Missing app.name');
  }

  if (!plan?.app?.stack) {
    throw new CompilerError('PLAN-VALIDATION-002', 'Missing app.stack');
  }

  if (plan.app.stack !== SUPPORTED_STACK) {
    throw new CompilerError(
      'PLAN-VALIDATION-003',
      `Unsupported stack "${plan.app.stack}", expected "${SUPPORTED_STACK}"`
    );
  }

  const blockIds = new Set<string>();
  for (const block of plan.blocks) {
    if (!block?.id) {
      throw new CompilerError('PLAN-VALIDATION-004', 'Every block entry requires id');
    }
    if (blockIds.has(block.id)) {
      throw new CompilerError('PLAN-VALIDATION-005', `Duplicate block id "${block.id}"`);
    }
    blockIds.add(block.id);
  }

  const slotIds = new Set<string>();
  for (const slot of plan.slots) {
    if (!slot?.id || !slot?.block || !slot?.kind || !slot?.target || !slot?.symbol) {
      throw new CompilerError('PLAN-VALIDATION-006', `Slot "${slot?.id ?? '<unknown>'}" is incomplete`);
    }
    if (slotIds.has(slot.id)) {
      throw new CompilerError('PLAN-VALIDATION-007', `Duplicate slot id "${slot.id}"`);
    }
    if (!blockIds.has(slot.block)) {
      throw new CompilerError('PLAN-REFERENCE-002', `Slot "${slot.id}" references unknown block "${slot.block}"`);
    }
    if (!slot.target.startsWith('custom/')) {
      throw new CompilerError('PLAN-VALIDATION-008', `Slot "${slot.id}" must target custom/ in v0.1`);
    }
    slotIds.add(slot.id);
  }
}

export async function loadPlan(planPath: string): Promise<PlanFile> {
  const plan = normalizePlan(await readYaml<PlanFile>(planPath));
  validatePlan(plan);
  return plan;
}
