import { beforeAll, expect, test } from "bun:test";

import { type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/compiler/ir/load-workspace-engineering-ir-input.ts';
import {
  PREDICATE_SIGNATURE_REGISTRY,
  assertEngineeringIRPredicateSignatures,
  assertPredicateSignatureRegistry,
} from "../../src/semantics/engineering-ir/predicate-signatures.ts";
import { deriveScenarioDefinitions } from "../../src/compiler/ir/scenario-facts.ts";
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectScenarioView } from '../../src/compiler/projection/project-scenario-view.ts';
import { type EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';
import { type ValidatedEngineeringIRSnapshot } from '../../src/semantics/engineering-ir/validated-types.ts';
import { prepareResolvedWorkspace } from "../testkit/workspace.ts";

let ticketIR: EngineeringIR;
let ticketSnapshot: ValidatedEngineeringIRSnapshot;
let ticketInput: BuildEngineeringIRInput;

beforeAll(async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ["ticket/basic"],
    prefix: "engineering-compiler-p0-2a-invariants-",
  });
  ticketInput = (await loadWorkspaceEngineeringIRBuildInput(workspaceRoot)).engineeringIRInput;
  ticketSnapshot = buildValidatedEngineeringIR(ticketInput);
  ticketIR = ticketSnapshot.ir;
});

test("Ticket closes the P0-2A identity, assertion, signature, and Scenario ownership vertical", () => {
  expect(ticketIR.appId).toBe("app:customer-admin");
  expect(ticketIR.graphId).toBe("engineering-ir:customer-admin");
  expect(ticketIR.inputRevision).toStartWith("sha256:");
  expect(ticketIR.semanticRevision).toStartWith("sha256:");

  const tripleKeys = ticketIR.facts.map((fact) =>
    JSON.stringify([fact.subject, fact.predicate, fact.object]),
  );
  expect(new Set(tripleKeys).size).toBe(ticketIR.facts.length);
  expect(ticketIR.facts.every((fact) => fact.assertions.length > 0)).toBe(true);
  expect(
    ticketIR.facts.every(
      (fact) =>
        new Set(fact.assertions.map((assertion) => assertion.id)).size ===
          fact.assertions.length &&
        fact.assertions.every(
          (assertion) =>
            assertion.validFromRevision === ticketIR.semanticRevision &&
            assertion.provenance.length > 0,
        ),
    ),
  ).toBe(true);

  expect(() => assertPredicateSignatureRegistry()).not.toThrow();
  expect(() =>
    assertEngineeringIRPredicateSignatures(ticketIR.entities, ticketIR.facts),
  ).not.toThrow();
  expect(
    ticketIR.facts.every(
      (fact) =>
        PREDICATE_SIGNATURE_REGISTRY[fact.predicate].status === "active",
    ),
  ).toBe(true);

  const rebuiltScenarios = deriveScenarioDefinitions(
    ticketIR.entities,
    ticketIR.facts,
  );
  expect(rebuiltScenarios).toEqual(ticketIR.scenarios);
  expect(
    ticketIR.entities.some((entity) => entity.kind === "scenario-step"),
  ).toBe(true);
  expect(
    ticketIR.scenarios.every((scenario) =>
      scenario.steps.every(
        (step) =>
          ticketIR.entities.some(
            (entity) =>
              entity.id === step.id && entity.kind === "scenario-step",
          ) &&
          ticketIR.facts.some(
            (fact) =>
              fact.subject === scenario.id &&
              fact.predicate === "CONTAINS" &&
              fact.object.kind === "entity" &&
              fact.object.entityId === step.id,
          ) &&
          ticketIR.facts.some(
            (fact) =>
              fact.subject === step.id &&
              fact.predicate === "INVOKES" &&
              fact.object.kind === "entity" &&
              fact.object.entityId === step.operationEntityId,
          ),
      ),
    ),
  ).toBe(true);

  const scenarioId = "scenario:ticket:create-ticket";
  const canonicalView = projectScenarioView(ticketSnapshot, scenarioId);
  const cacheTampered: EngineeringIR = {
    ...ticketIR,
    scenarios: ticketIR.scenarios.map((scenario) =>
      scenario.id === scenarioId
        ? {
            ...scenario,
            entryEntityId: "operation:ticket:listTickets",
            factIds: [],
            steps: [],
            acceptanceEntityIds: [],
          }
        : scenario,
    ),
  };
  expect(() => validateEngineeringIR(cacheTampered, ticketInput)).toThrow();
  expect(
    canonicalView.nodes.every((node) =>
      node.references.some(
        (reference) => reference.kind === "fact" || reference.kind === "entity",
      ),
    ),
  ).toBe(true);
});
