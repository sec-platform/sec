import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { generatedStateDigest } from './contract.ts';
import {
  runGeneratedStateOperation,
  type GeneratedStateDomainOwnerOperation
} from './operation.ts';

async function withWorkspace(
  callback: (workspaceRoot: string) => Promise<void>
): Promise<void> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-generated-state-operation-'));
  try {
    await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  }
}

function fixtureOwner(terminal: 'completed' | 'partial-residue'): GeneratedStateDomainOwnerOperation {
  return Object.freeze({
    owner: 'fixture-domain-owner',
    plan(input) {
      const material = Object.freeze({
        schema: 'fixture-domain-owner-plan-v1',
        owner: 'fixture-domain-owner',
        inventoryDigest: input.inventory.inventoryDigest,
        selected: Object.freeze([{ relativePath: '.tmp/fixture-owner-active' }])
      });
      return Object.freeze({ ...material, planDigest: generatedStateDigest(material) });
    },
    async settle(plan) {
      const material = Object.freeze({
        schema: 'fixture-domain-owner-receipt-v1',
        owner: 'fixture-domain-owner',
        planDigest: plan.planDigest,
        terminal
      });
      return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
    }
  });
}

test('generated-state keeps generic cleanup retired-only and consumes an owner receipt separately', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const plan = await runGeneratedStateOperation(
      ['plan', '--workspace', workspaceRoot],
      workspaceRoot,
      [fixtureOwner('completed')]
    ) as Readonly<Record<string, unknown>>;
    expect(plan.selected).toEqual([]);
    expect(plan.ownerPlans).toMatchObject([{
      owner: 'fixture-domain-owner',
      selected: [{ relativePath: '.tmp/fixture-owner-active' }]
    }]);

    const receipt = await runGeneratedStateOperation(
      ['cleanup', '--workspace', workspaceRoot],
      workspaceRoot,
      [fixtureOwner('completed')]
    ) as Readonly<Record<string, unknown>>;
    expect(receipt.ownerReceipts).toMatchObject([{
      owner: 'fixture-domain-owner',
      terminal: 'completed'
    }]);
  });
});

test('generated-state refuses a nonterminal domain-owner receipt before generic cleanup', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await expect(runGeneratedStateOperation(
      ['cleanup', '--workspace', workspaceRoot],
      workspaceRoot,
      [fixtureOwner('partial-residue')]
    )).rejects.toThrow('domain owner settlement is not terminal');
  });
});
