---
schema: codex-development-work-package-v1
id: audit-worker-boundary-20261013
tracking: none
base: a1f3f0d0797dc141d470976d3dc7ef31ce561f09
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: restore-pure-sealed-audit-worker
    owner: repository-maintainer
    ownedPaths:
      - "src/adapters/repository/repository-audit/cli.ts"
      - "src/adapters/repository/repository-audit/source-program-audit-kernel.ts"
      - "src/adapters/repository/repository-audit/source-program-audit-operation.ts"
      - "src/adapters/repository/repository-audit/source-program-audit-operation.test.ts"
      - "src/adapters/repository/repository-audit/terminal.test.ts"
      - "src/adapters/repository/repository-audit/worker.ts"
      - "src/adapters/runtime-state/physical/runtime/process.ts"
      - "src/adapters/runtime-state/physical/runtime/process-resource-session.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/main-health-dependency-admission-20261013.md"
      - "config/repository/work-packages/audit-worker-boundary-20261013.md"
forbiddenPaths:
  - "docs/"
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Keep the sealed child operation independent of parent workspace discovery and TypeScript initialization; preserve exact canonical input, result, enforcement and candidate protocol"
  - "Keep compiler-issued parent fact joins and the original descriptor closure, generation, implementation, request and retirement identity chain"
  - "Retain bounded binary output on the original transport failure owner, distinguish complete and partial capture, and return independent copies only through explicit in-process reads"
  - "Preserve safe default diagnostics and primary plus cleanup failure; no raw log disclosure, new publisher, fabricated VerificationAction or successful run result"
  - "Verify real descriptor-derived sealed execution without manifest, lock or node_modules; business failure remains a normal candidate result"
  - "Reuse existing timeout and output-overflow processes for independent binary and truncation observations, without a new process matrix"
  - "Require independent final-source review, necessary protected checks, expected-head maintainer adoption and exact parent/tree readback"
  - "Observe adopted main through its original health producer at most once; no Docker, exploratory hosted execution or unqualified integration adoption"
tests:
  - "src/adapters/repository/repository-audit/source-program-audit-operation.test.ts"
  - "src/adapters/repository/repository-audit/worker-protocol.test.ts"
  - "src/adapters/repository/repository-audit/terminal.test.ts"
  - "src/adapters/runtime-state/physical/runtime/process-resource-session.test.ts"
---

# Restore the sealed audit operation boundary

Exact-main run38326335824 passed owned dependency preparation, imports and verified type checking. Its worker then exited before producing protocol output. Source inspection found a pure operation importing parent compilation, workspace discovery and package inputs that its sealed generation does not contain. The real descriptor-derived child reproduces an implicit compiler dependency before the boundary repair and executes the same strict protocol after it.

The original transport capture also discarded bounded raw failure output before returning its summary. Preserve those bytes in the existing capture owner and keep explicit diagnostic reads separate from successful process records, terminal settlement and persistent publication. The old 926-byte output has not been recovered and is not asserted to contain a particular exception.

This is a bounded main-health repair proposal, not ordinary Work, Gate, native qualification or adoption of the larger documentation integration. The canonical producer alone freezes this manifest and its control projections.
