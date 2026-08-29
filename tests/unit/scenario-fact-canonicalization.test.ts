import { expect, test } from "bun:test";

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectScenarioView } from '../../src/compiler/projection/project-scenario-view.ts';
import { deriveScenarioDefinition } from "../../src/compiler/ir/scenario-facts.ts";
import { CompilerError } from "../../src/compiler/errors.ts";
import type { LoadedSemanticContract } from '../../src/semantic/contracts/contract/types.ts';

function baseInput(): BuildEngineeringIRInput {
  return {
    app: { id: "scenario-app", name: "scenario-app" },
    resolvedBlocks: [
      {
        id: "flow/basic",
        version: "0.1.0",
        kind: "capability",
        installOrder: 1,
        manifestPath: "registry/flow.basic/block.manifest.yaml",
        registrySourceId: "official",
        registryKind: "official",
        registryLocation: "compiler",
        registryPath: "registry",
      },
    ],
    manifests: [
      {
        blockId: "flow/basic",
        manifestPath: "registry/flow.basic/block.manifest.yaml",
        manifest: {
          requires: [],
          provides: [],
          pins: { inputs: [], outputs: [] },
        },
      },
    ],
    slotTasks: [],
    acceptanceIds: ["flow_succeeds"],
    policyDeclarations: [],
  };
}

function operation(id: string) {
  return {
    id,
    responsibility: "FlowOwner",
    inputs: [],
    reads: [],
    writes: [],
    mutates: [],
    requiresPolicies: [],
    requiresPermissions: [],
    performsEffects: [],
    emits: [],
    invokes: [],
    awaits: [],
  };
}

function contract(): LoadedSemanticContract {
  return {
    blockId: "flow/basic",
    contractPath: "registry/flow.basic/contracts/flow.yaml",
    contract: {
      formatVersion: "1",
      id: "flow-core",
      namespace: "flow",
      entities: [],
      states: [],
      responsibilities: [
        {
          id: "FlowOwner",
          role: "Own the flow",
          owns: [],
          implements: ["start", "finish", "recover"],
          dependsOn: [],
        },
      ],
      operations: [
        operation("start"),
        operation("finish"),
        operation("recover"),
      ],
      events: [],
      policies: [],
      permissions: [],
      effects: [],
      scenarios: [
        {
          id: "run-flow",
          entry: "start",
          steps: [
            {
              id: "finish",
              operation: "finish",
              after: ["start"],
              awaits: true,
              retryMaxAttempts: 3,
              onError: "recover",
            },
            { id: "recover", operation: "recover", after: [] },
            { id: "start", operation: "start", after: [] },
          ],
          acceptance: ["flow_succeeds"],
        },
      ],
    },
  };
}

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test("Scenario execution semantics have canonical Entity and Fact identity with provenance", () => {
  const ir = buildEngineeringIR({
    ...baseInput(),
    semanticContracts: [contract()],
  });
  const scenarioId = "scenario:flow:run-flow";
  const startId = `${scenarioId}#step:start`;
  const finishId = `${scenarioId}#step:finish`;
  const recoverId = `${scenarioId}#step:recover`;

  expect(
    ir.entities
      .filter((entity) => entity.kind === "scenario-step")
      .map((entity) => entity.id),
  ).toEqual([finishId, recoverId, startId].sort());

  const expectedFacts = [
    [scenarioId, "CONTAINS", finishId],
    [finishId, "INVOKES", "operation:flow:finish"],
    [startId, "PRECEDES", finishId],
    [finishId, "AWAITS", "operation:flow:finish"],
    [recoverId, "HANDLES", finishId],
  ];
  for (const [subject, predicate, objectId] of expectedFacts) {
    const fact = ir.facts.find(
      (candidate) =>
        candidate.subject === subject &&
        candidate.predicate === predicate &&
        candidate.object.kind === "entity" &&
        candidate.object.entityId === objectId,
    );
    expect(fact?.assertions[0]?.provenance).toEqual([
      {
        kind: "contract",
        sourceId: "semantic-contract:flow-core",
        sourcePath: "registry/flow.basic/contracts/flow.yaml",
      },
    ]);
  }
  const retry = ir.facts.find(
    (fact) => fact.subject === finishId && fact.predicate === "RETRIES",
  );
  expect(retry?.object).toEqual({ kind: "value", value: { maxAttempts: 3 } });
  expect(retry?.assertions[0]?.provenance[0]?.sourceId).toBe(
    "semantic-contract:flow-core",
  );
  const canonicalScenario = ir.scenarios[0]!;
  const expectedFactIds = ir.facts
    .filter(
      (fact) =>
        fact.subject === scenarioId ||
        fact.subject.startsWith(`${scenarioId}#step:`),
    )
    .map((fact) => fact.id)
    .sort();
  expect(canonicalScenario.factIds).toEqual(expectedFactIds);
});

test("Scenario cache is exactly reconstructable and tampered raw IR cannot enter Projector", () => {
  const input = {
    ...baseInput(),
    semanticContracts: [contract()],
  };
  const snapshot = buildValidatedEngineeringIR(input);
  const ir = snapshot.ir;
  const scenarioId = "scenario:flow:run-flow";
  const derived = deriveScenarioDefinition(ir.entities, ir.facts, scenarioId);
  expect(derived).toEqual(ir.scenarios[0]);

  const canonicalView = projectScenarioView(snapshot, scenarioId);
  const tampered = {
    ...ir,
    scenarios: [
      {
        ...ir.scenarios[0]!,
        entryEntityId: "operation:flow:recover",
        steps: [],
      },
    ],
  };
  expect(() => validateEngineeringIR(tampered, input)).toThrow();

  const precedes = canonicalView.edges.find(
    (edge) => edge.relation === "PRECEDES",
  );
  const error = canonicalView.edges.find(
    (edge) => edge.relation === "HANDLES",
  );
  expect(precedes).toMatchObject({
    source: `${scenarioId}#step:start`,
    target: `${scenarioId}#step:finish`,
    label: "precedes",
  });
  expect(error).toMatchObject({
    source: `${scenarioId}#step:recover`,
    target: `${scenarioId}#step:finish`,
    label: "handles",
  });
  expect(
    precedes?.references.some((reference) => reference.kind === "fact"),
  ).toBe(true);
  expect(error?.references.some((reference) => reference.kind === "fact")).toBe(
    true,
  );
});

test("declaration array reorder is stable while order relation changes semantic revision", () => {
  const original = contract();
  const reordered = contract();
  reordered.contract.scenarios[0]!.steps.reverse();

  const first = buildEngineeringIR({
    ...baseInput(),
    semanticContracts: [original],
  });
  const second = buildEngineeringIR({
    ...baseInput(),
    semanticContracts: [reordered],
  });
  expect(second).toEqual(first);

  const changed = contract();
  changed.contract.scenarios[0]!.steps.find(
    (step) => step.id === "finish",
  )!.after = ["recover"];
  const changedIr = buildEngineeringIR({
    ...baseInput(),
    semanticContracts: [changed],
  });
  expect(changedIr.semanticRevision).not.toBe(first.semanticRevision);
  expect(
    changedIr.facts.some(
      (fact) =>
        fact.subject === "scenario:flow:run-flow#step:recover" &&
        fact.predicate === "PRECEDES" &&
        fact.object.kind === "entity" &&
        fact.object.entityId === "scenario:flow:run-flow#step:finish",
    ),
  ).toBe(true);
});

test("invalid Scenario step references and retry schemas fail deterministically", () => {
  const invalidReference = contract();
  invalidReference.contract.scenarios[0]!.steps.find(
    (step) => step.id === "finish",
  )!.after = ["missing"];
  expectCompilerError(
    () =>
      buildEngineeringIR({
        ...baseInput(),
        semanticContracts: [invalidReference],
      }),
    "IR-SCENARIO-004",
  );

  const invalidRetry = contract();
  invalidRetry.contract.scenarios[0]!.steps.find(
    (step) => step.id === "finish",
  )!.retryMaxAttempts = 0;
  expectCompilerError(
    () =>
      buildEngineeringIR({ ...baseInput(), semanticContracts: [invalidRetry] }),
    "IR-SCENARIO-002",
  );
});
