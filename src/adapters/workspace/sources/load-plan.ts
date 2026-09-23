import path from 'node:path';
import type { PlanFile } from '../../../compiler/contract.ts';
import { normalizePlan, validatePlan } from '../../../compiler/contract/plan-validation.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { failureMessage } from '../../../contracts/failure-inspection.ts';
import { posixPath } from '../../../contracts/relative-path.ts';
import { parseYamlValue } from '../../formats/yaml.ts';
import { getWorkspacePaths, officialRegistryRelativePath, privateRegistryRelativePath } from "../../workspace-context.ts";
import { readOptionalAuthorityBytes } from './read-authority-source.ts';

// Independent domain admission limits; do not couple a plan's policy to the
// current semantic-contract or manifest limit merely because their values match.
export const PLAN_YAML_MAX_INPUT_BYTES = 1024 * 1024;
const PLAN_YAML_MAX_ALIAS_COUNT = 100;

const PLAN_NORMALIZATION_REGISTRY_DEFAULTS = Object.freeze({
  officialPath: posixPath(officialRegistryRelativePath),
  privatePath: posixPath(privateRegistryRelativePath)
});

function decodePlanUtf8(bytes: Uint8Array, planPath: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CompilerError(
      'PLAN-VALIDATION-023',
      `Plan at "${planPath}" is not exact UTF-8`,
      { cause: failureMessage(error) },
      { cause: error }
    );
  }
}

function readPlanSourceNoFollow(planPath: string): string | null {
  const bytes = readOptionalAuthorityBytes(planPath, 'Plan');
  return bytes === null ? null : decodePlanUtf8(bytes, path.resolve(planPath));
}

function parsePlanSource(raw: string): PlanFile {
  let parsed: unknown;
  try {
    parsed = parseYamlValue(raw, { label: 'Plan',
      maximumInputBytes: PLAN_YAML_MAX_INPUT_BYTES,
      stringKeys: true, maximumAliasCount: PLAN_YAML_MAX_ALIAS_COUNT });
  } catch (error) {
    throw new CompilerError(
      'PLAN-VALIDATION-022',
      `Plan YAML is invalid: ${failureMessage(error)}`, {}, { cause: error }
    );
  }
  const plan = normalizePlan(parsed, PLAN_NORMALIZATION_REGISTRY_DEFAULTS);
  validatePlan(plan);
  return plan;
}

function missingPlanError(planPath: string): NodeJS.ErrnoException {
  const error = new Error(`Plan file not found: ${path.resolve(planPath)}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = path.resolve(planPath);
  return error;
}

/** Retained Plan authority observation/parse is synchronous. */
export function loadPlan(planPath: string): PlanFile {
  const raw = readPlanSourceNoFollow(planPath);
  if (raw === null) throw missingPlanError(planPath);
  return parsePlanSource(raw);
}

export function loadWorkspacePlan(workspaceRoot: string): PlanFile {
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const canonicalRaw = readPlanSourceNoFollow(workspaceConfigPath);
  if (canonicalRaw !== null) return parsePlanSource(canonicalRaw);
  throw missingPlanError(workspaceConfigPath);
}
