import type { Command } from 'commander';

import {
  registerInspectionQuery,
  type InspectionQueryDefinition
} from './inspection-query.ts';

type EntryOwned<T, Keys extends keyof InspectionQueryDefinition<T>> =
  Omit<InspectionQueryDefinition<T>, Keys>;

export interface StandardInspectionCommandDefinitions<
  Policy,
  Acceptance,
  Runtime,
  Verification,
  Provenance,
  Review,
  Demo,
  Overview,
  Install,
  Blocks
> {
  readonly policy: EntryOwned<Policy, 'description' | 'defaultMode'>;
  readonly acceptance: EntryOwned<Acceptance, 'description' | 'defaultMode'>;
  readonly runtime: EntryOwned<Runtime, 'description' | 'defaultMode'>;
  readonly verification: EntryOwned<Verification, 'description' | 'defaultMode'>;
  readonly provenance: EntryOwned<Provenance, 'description' | 'defaultMode'>;
  readonly review: EntryOwned<Review, 'description'>;
  readonly demo: EntryOwned<Demo, 'defaultMode'>;
  readonly overview: EntryOwned<Overview, 'description'>;
  readonly install: InspectionQueryDefinition<Install>;
  readonly blocks: InspectionQueryDefinition<Blocks>;
}

/** Entry owns the fixed public inspection command tree and presentation modes. */
export function registerStandardInspectionCommands<
  Policy,
  Acceptance,
  Runtime,
  Verification,
  Provenance,
  Review,
  Demo,
  Overview,
  Install,
  Blocks
>(
  program: Command,
  definitions: StandardInspectionCommandDefinitions<
    Policy,
    Acceptance,
    Runtime,
    Verification,
    Provenance,
    Review,
    Demo,
    Overview,
    Install,
    Blocks
  >
): void {
  registerInspectionQuery(program.command('policy'), {
    ...definitions.policy,
    description: 'Policy inspection',
    defaultMode: 'report'
  });
  registerInspectionQuery(program.command('acceptance'), {
    ...definitions.acceptance,
    description: 'Acceptance inspection',
    defaultMode: 'coverage'
  });
  registerInspectionQuery(program.command('runtime'), {
    ...definitions.runtime,
    description: 'Runtime inspection',
    defaultMode: 'report'
  });
  registerInspectionQuery(program.command('verification'), {
    ...definitions.verification,
    description: 'Verification inspection',
    defaultMode: 'report'
  });
  registerInspectionQuery(program.command('provenance'), {
    ...definitions.provenance,
    description: 'Provenance inspection',
    defaultMode: 'registry'
  });
  registerInspectionQuery(program.command('review'), {
    ...definitions.review,
    description: 'Review inspection'
  });
  registerInspectionQuery(program.command('demo'), {
    ...definitions.demo,
    defaultMode: 'checklist'
  });
  registerInspectionQuery(program.command('overview'), {
    ...definitions.overview,
    description: 'Project overview'
  });
  registerInspectionQuery(program.command('install'), definitions.install);
  registerInspectionQuery(program.command('blocks'), definitions.blocks);
}
