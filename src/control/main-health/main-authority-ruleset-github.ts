import { writeFileSync } from 'node:fs';

import { encodeVerificationActionData } from '../../verification/action/contract/action.ts';
import {
  createMainAuthorityRulesetReceipt,
  type MainAuthorityRulesetReceipt
} from './authority-ruleset.ts';
import {
  observeMainAuthorityRulesetGitHubFacts,
  withMainHealthGitHubReadSession
} from './work-selection-main-health.ts';

export interface MainAuthorityRulesetGitHubTransport {
  readonly effectiveBranchRules: (repository: string, branch: string) => unknown;
  readonly detailedRuleset: (repository: string, rulesetId: number) => unknown;
}

export type MainAuthorityRulesetGhJsonRunner = (
  args: readonly string[],
  label: string
) => unknown;

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error('MainAuthority GitHub repository must be owner/name.');
  }
  return value;
}

function branchName(value: string): string {
  if (value.length === 0 || value.length > 255 || /[\u0000-\u001f]/u.test(value)
    || value.includes('..') || value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
    throw new Error('MainAuthority GitHub branch name is not canonical.');
  }
  return value;
}

function integrationId(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('MainAuthority GitHub integration id must be a positive safe integer.');
  }
  return value;
}

export class MainAuthorityRulesetGhTransport implements MainAuthorityRulesetGitHubTransport {
  constructor(
    private readonly runJson: MainAuthorityRulesetGhJsonRunner
  ) {}

  effectiveBranchRules(repository: string, branch: string): unknown {
    repository = repositoryName(repository);
    branch = branchName(branch);
    const pages = this.runJson([
      'api',
      '--method', 'GET',
      `/repos/${repository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`,
      '--paginate',
      '--slurp'
    ], 'effective branch rules readback');
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new Error('MainAuthority GitHub effective branch rules pagination is not a complete page array.');
    }
    return Object.freeze(pages.flatMap((page) => page as readonly unknown[]));
  }

  detailedRuleset(repository: string, rulesetId: number): unknown {
    repository = repositoryName(repository);
    if (!Number.isSafeInteger(rulesetId) || rulesetId < 1) {
      throw new Error('MainAuthority GitHub ruleset id is invalid.');
    }
    return this.runJson([
      'api',
      '--method', 'GET',
      `/repos/${repository}/rulesets/${rulesetId}?includes_parents=true`
    ], `ruleset ${rulesetId} detail readback`);
  }
}

function effectiveRuleIds(value: unknown): readonly number[] {
  if (!Array.isArray(value)) throw new Error('MainAuthority GitHub effective branch rules must be an array.');
  const ids = new Set<number>();
  for (const [index, rule] of value.entries()) {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`MainAuthority GitHub effective branch rule ${index} is malformed.`);
    }
    const id = (rule as Record<string, unknown>).ruleset_id;
    if (!Number.isSafeInteger(id) || (id as number) < 1) {
      throw new Error(`MainAuthority GitHub effective branch rule ${index} has no exact ruleset id.`);
    }
    ids.add(id as number);
  }
  return Object.freeze([...ids].sort((left, right) => left - right));
}

export function observeMainAuthorityRuleset(input: Readonly<{
  repository: string;
  defaultBranch: string;
  transport: MainAuthorityRulesetGitHubTransport;
  /**
   * Exact GitHub Integration expected by the ruleset. Omit only for the
   * current GitHub Actions compatibility adapter; provider-neutral runtimes
   * must pass their own integration id explicitly.
   */
  expectedIntegrationId?: number;
}>): MainAuthorityRulesetReceipt {
  const repository = repositoryName(input.repository);
  const defaultBranch = branchName(input.defaultBranch);
  const expectedIntegrationId = integrationId(input.expectedIntegrationId);
  const effectiveRules = input.transport.effectiveBranchRules(repository, defaultBranch);
  const rulesetIds = effectiveRuleIds(effectiveRules);
  if (rulesetIds.length === 0) {
    throw new Error('MainAuthority GitHub main has no effective ruleset-backed rules.');
  }
  const detailedRulesets = rulesetIds.map((rulesetId) =>
    input.transport.detailedRuleset(repository, rulesetId));
  return createMainAuthorityRulesetReceipt({
    repository,
    defaultBranch,
    effectiveRules,
    detailedRulesets,
    ...(expectedIntegrationId === undefined ? {} : { expectedIntegrationId })
  });
}

export async function observeMainAuthorityRulesetLive(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  expectedIntegrationId?: number;
}>): Promise<MainAuthorityRulesetReceipt> {
  const repository = repositoryName(input.repository);
  const defaultBranch = branchName(input.defaultBranch);
  const expectedIntegrationId = integrationId(input.expectedIntegrationId);
  return withMainHealthGitHubReadSession({
    repositoryRoot: input.repositoryRoot,
    repository,
    operation: async () => {
      const facts = await observeMainAuthorityRulesetGitHubFacts({
        repository,
        defaultBranch
      });
      return createMainAuthorityRulesetReceipt({
        repository,
        defaultBranch,
        effectiveRules: facts.effectiveRules,
        detailedRulesets: facts.detailedRulesets,
        ...(expectedIntegrationId === undefined ? {} : { expectedIntegrationId })
      });
    }
  });
}

function parseCli(argv: readonly string[]): Readonly<{
  repository: string;
  branch: string;
  output: string;
  expectedIntegrationId?: number;
}> {
  const [command, repositoryFlag, repository, branchFlag, branch, outputFlag, output, integrationFlag, rawIntegrationId] = argv;
  const baseValid = command === 'observe' && repositoryFlag === '--repository' && branchFlag === '--branch'
    && outputFlag === '--output' && Boolean(repository) && Boolean(branch) && Boolean(output);
  if (!baseValid || (argv.length !== 7 && argv.length !== 9)) {
    throw new Error('Usage: bun src/control/main-health/main-authority-ruleset-github.ts observe --repository <owner/name> --branch <branch> --output <json> [--integration-id <positive-integer>]');
  }
  if (argv.length === 7) {
    return Object.freeze({ repository: repository!, branch: branch!, output: output! });
  }
  if (integrationFlag !== '--integration-id' || !/^[1-9][0-9]*$/u.test(rawIntegrationId ?? '')) {
    throw new Error('MainAuthority GitHub --integration-id must be canonical positive decimal text.');
  }
  const parsedIntegrationId = Number(rawIntegrationId);
  if (!Number.isSafeInteger(parsedIntegrationId)) {
    throw new Error('MainAuthority GitHub --integration-id exceeds the safe integer range.');
  }
  return Object.freeze({
    repository: repository!,
    branch: branch!,
    output: output!,
    expectedIntegrationId: parsedIntegrationId
  });
}

async function main(): Promise<void> {
  const input = parseCli(process.argv.slice(2));
  const receipt = await observeMainAuthorityRulesetLive({
    repositoryRoot: process.cwd(),
    repository: input.repository,
    defaultBranch: input.branch,
    ...(input.expectedIntegrationId === undefined
      ? {}
      : { expectedIntegrationId: input.expectedIntegrationId })
  });
  writeFileSync(input.output, `${encodeVerificationActionData(receipt)}\n`, 'utf8');
}

if (import.meta.main) await main();
