import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  documentationRecordByPath,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import {
  type DocsDoctorIssue,
  pushIssue,
  recordValue,
  stringArrayValue
} from './docs-doctor-shared.ts';

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a finite non-negative safe integer.`);
  }
  return value as number;
}

export async function scanMachineLedgers(
  repositoryRoot: string,
  registry: DocumentationAuthorityRegistry,
  issues: DocsDoctorIssue[]
): Promise<void> {
  const report = (file: string, error: unknown): void => pushIssue(issues, {
    level: 'error',
    code: 'machine-ledger-invalid',
    file,
    message: error instanceof Error ? error.message : String(error)
  });

  if (documentationRecordByPath(registry, 'docs/governance/external-capability-ledger.yaml')) {
    const ledgerPath = 'docs/governance/external-capability-ledger.yaml';
    try {
      const parsed = recordValue(
        parseYaml(await fs.readFile(path.join(repositoryRoot, ledgerPath), 'utf8')),
        'External capability ledger'
      );
      if (parsed.schema !== 'sec-external-capability-ledger-v2') {
        throw new Error('External capability ledger schema must be sec-external-capability-ledger-v2.');
      }
      const binding = recordValue(parsed.binding, 'External capability ledger binding');
      if (binding.packageAuthority !== 'package.json' || binding.lockAuthority !== 'bun.lock') {
        throw new Error('External capability ledger must bind package.json and bun.lock as version authorities.');
      }
      const packageJson = JSON.parse(
        await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
      ) as { devDependencies?: Record<string, string> };
      const expectedGitNexusVersion = packageJson.devDependencies?.gitnexus;
      if (!expectedGitNexusVersion) {
        throw new Error('package.json must declare devDependencies.gitnexus.');
      }
      if (!Array.isArray(parsed.providers)) throw new Error('External capability providers must be an array.');
      const gitnexus = parsed.providers
        .map((entry, index) => recordValue(entry, `External capability provider ${index}`))
        .find((entry) => entry.id === 'gitnexus');
      if (!gitnexus) throw new Error('External capability ledger must contain gitnexus.');
      if (gitnexus.observedVersion !== expectedGitNexusVersion) {
        throw new Error(
          `GitNexus observedVersion ${String(gitnexus.observedVersion)} does not match package.json ${expectedGitNexusVersion}.`
        );
      }
      if (gitnexus.versionAuthority !== 'package.json#devDependencies.gitnexus') {
        throw new Error('GitNexus versionAuthority must reference package.json#devDependencies.gitnexus.');
      }
      const surfaces = recordValue(gitnexus.surfaces, 'GitNexus surfaces');
      const cli = stringArrayValue(surfaces.cli, 'GitNexus CLI surfaces');
      const standingMcp = stringArrayValue(surfaces.standingMcp, 'GitNexus standing MCP surfaces');
      if (cli.join('\0') !== ['analyze', 'status'].join('\0') || standingMcp.length !== 0) {
        throw new Error('GitNexus must expose only analyze/status CLI surfaces and no standing MCP.');
      }
    } catch (error) {
      report(ledgerPath, error);
    }
  }

  if (documentationRecordByPath(registry, 'docs/governance/nexus-absorption-ledger.yaml')) {
    const ledgerPath = 'docs/governance/nexus-absorption-ledger.yaml';
    try {
      const parsed = recordValue(
        parseYaml(await fs.readFile(path.join(repositoryRoot, ledgerPath), 'utf8')),
        'Nexus ledger'
      );
      if (parsed.schema !== 'sec-nexus-corpus-ledger-v2') {
        throw new Error('Nexus ledger schema must be sec-nexus-corpus-ledger-v2.');
      }
      const coverage = recordValue(parsed.coverage, 'Nexus coverage');
      const pathClassification = recordValue(
        coverage.pathClassification,
        'Nexus path classification'
      );
      const eprBindings = recordValue(coverage.eprBindings, 'Nexus EPR bindings');
      const skillBindings = recordValue(coverage.skillBindings, 'Nexus Skill bindings');
      const acceptedParity = recordValue(coverage.acceptedParity, 'Nexus accepted parity');
      const completion = recordValue(parsed.completion, 'Nexus completion');
      const noOmissionProven = completion.noOmissionProven;
      if (typeof noOmissionProven !== 'boolean') {
        throw new Error('Nexus completion.noOmissionProven must be boolean.');
      }
      if (typeof pathClassification.materialized !== 'boolean') {
        throw new Error('Nexus pathClassification.materialized must be boolean.');
      }
      if (noOmissionProven) {
        const requiredTrue = [
          'censusComplete', 'parityComplete', 'retirementComplete'
        ].every((key) => completion[key] === true);
        if (!requiredTrue || pathClassification.materialized !== true || parsed.status !== 'complete') {
          throw new Error('Nexus cannot claim no-omission completion without complete materialized census/parity/retirement.');
        }
        const pathTotal = nonNegativeSafeInteger(
          pathClassification.total,
          'Nexus pathClassification.total'
        );
        const pathClassified = nonNegativeSafeInteger(
          pathClassification.classified,
          'Nexus pathClassification.classified'
        );
        const eprBound = nonNegativeSafeInteger(eprBindings.bound, 'Nexus eprBindings.bound');
        const eprExpected = nonNegativeSafeInteger(eprBindings.expected, 'Nexus eprBindings.expected');
        const skillBound = nonNegativeSafeInteger(skillBindings.bound, 'Nexus skillBindings.bound');
        const skillExpected = nonNegativeSafeInteger(skillBindings.expected, 'Nexus skillBindings.expected');
        const parityProven = nonNegativeSafeInteger(acceptedParity.proven, 'Nexus acceptedParity.proven');
        const parityAccepted = nonNegativeSafeInteger(acceptedParity.accepted, 'Nexus acceptedParity.accepted');
        const unexplainedDeltaCount = nonNegativeSafeInteger(
          coverage.unexplainedDeltaCount,
          'Nexus coverage.unexplainedDeltaCount'
        );
        if (
          pathTotal <= 0
          || pathClassified !== pathTotal
          || eprBound !== eprExpected
          || skillBound !== skillExpected
          || parityProven !== parityAccepted
          || unexplainedDeltaCount !== 0
        ) {
          throw new Error('Nexus completion claim conflicts with coverage counters.');
        }
      }
    } catch (error) {
      report(ledgerPath, error);
    }
  }
}
