import { expect, test } from "bun:test";

import { buildExplainGraph } from "../../platform/compiler/emit/write-explain-graph.ts";
import type { AcceptanceCoverageReport } from "../../platform/shared/acceptance-types.ts";
import type { LockFile } from "../../platform/shared/lock-types.ts";
import type { ProvenanceFile } from "../../platform/shared/provenance-types.ts";

function lock(name: string): LockFile {
  return {
    formatVersion: "1",
    app: {
      id: "stable-app",
      name,
      stack: "nextjs-ts-prisma-sqlite",
      mode: "single-tenant",
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: "succeeded",
      align: "succeeded",
      resolve: "succeeded",
      compose: "succeeded",
      adapt: "succeeded",
      verify: "succeeded",
      repair: "skipped",
      lock: "succeeded",
      emit: "succeeded",
    },
  };
}

const provenance: ProvenanceFile = {
  formatVersion: "1",
  artifacts: [],
};

const coverage: AcceptanceCoverageReport = {
  formatVersion: "1",
  status: "passed",
  acceptancePassed: [],
  blocks: [],
  slots: [],
  uncoveredBlocks: [],
  uncoveredSlots: [],
};

test("ExplainGraph uses lock app.id for identity and app.name only for label", async () => {
  const before = await buildExplainGraph(
    process.cwd(),
    lock("Before"),
    provenance,
    coverage,
    null,
  );
  const after = await buildExplainGraph(
    process.cwd(),
    lock("After"),
    provenance,
    coverage,
    null,
  );

  expect(before.nodes).toEqual([
    { id: "app:stable-app", type: "app", label: "Before" },
  ]);
  expect(after.nodes).toEqual([
    { id: "app:stable-app", type: "app", label: "After" },
  ]);
});
