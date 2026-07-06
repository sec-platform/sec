import { expect, test } from 'bun:test';

import {
  PASS_DEFINITIONS,
  PIPELINE_STAGE_DEFINITIONS
} from '../../platform/shared/pipeline-pass-registry.ts';
import { PIPELINE_STAGE_IDS } from '../../platform/shared/pipeline-types.ts';

test('pipeline pass registry defines one forward dependency chain for compile stages', () => {
  expect(PASS_DEFINITIONS.align.requires).toEqual(['parse']);
  expect(PASS_DEFINITIONS.resolve.requires).toEqual(['align']);
  expect(PASS_DEFINITIONS.compose.requires).toEqual(['resolve']);
  expect(PASS_DEFINITIONS.adapt.requires).toEqual(['compose']);
  expect(PASS_DEFINITIONS.verify.requires).toEqual(['adapt']);
  expect(PASS_DEFINITIONS.lock.requires).toEqual(['verify']);
  expect(PASS_DEFINITIONS.emit.requires).toEqual(['lock']);
});

test('upstream passes invalidate every downstream correctness state', () => {
  expect(PASS_DEFINITIONS.resolve.invalidates).toEqual([
    'compose',
    'adapt',
    'verify',
    'repair',
    'lock',
    'emit'
  ]);
  expect(PASS_DEFINITIONS.compose.invalidates).toEqual([
    'adapt',
    'verify',
    'repair',
    'lock',
    'emit'
  ]);
  expect(PASS_DEFINITIONS.lock.invalidates).toEqual(['emit']);
});

test('physical pipeline stages have deterministic pass ownership', () => {
  expect(Object.keys(PIPELINE_STAGE_DEFINITIONS)).toEqual([...PIPELINE_STAGE_IDS]);
  expect(PIPELINE_STAGE_DEFINITIONS.resolve.ownedPasses).toEqual(['parse', 'align', 'resolve']);

  const ownedPasses = PIPELINE_STAGE_IDS.flatMap((stageId) =>
    PIPELINE_STAGE_DEFINITIONS[stageId].ownedPasses
  );
  expect(ownedPasses).toEqual([
    'parse',
    'align',
    'resolve',
    'compose',
    'adapt',
    'verify',
    'lock',
    'emit'
  ]);
  expect(new Set(ownedPasses).size).toBe(ownedPasses.length);
});
