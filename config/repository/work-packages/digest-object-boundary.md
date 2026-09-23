---
schema: codex-development-work-package-v1
id: digest-object-boundary
tracking: none
base: 31ec8c809219159a86e23b8ddce019e21849ed24
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: isolate-digest-and-git-object-boundaries
    owner: digest-identity-owner
    ownedPaths:
      - config/repository/work-packages/digest-object-boundary.md
      - src/contracts/digest.ts
      - src/contracts/digest.test.ts
      - src/contracts/git-object-id.ts
      - src/contracts/git-object-id.test.ts
      - src/contracts/canonical.ts
      - src/adapters/providers/git-read/runtime/commit-contract.ts
      - src/semantics/provenance/authority.ts
      - src/semantics/upgrade/upgrade-artifact.ts
      - src/workspace/contract/project-baseline.ts
      - tests/unit/git-object-id-boundary.test.ts
forbiddenPaths:
  - .github/
  - .documentation/
  - docs/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-packages/sec086-current-main-convergence-v1.md
acceptance:
  - digest and Git object ID values have separate runtime grammars and nominal types
  - existing raw and canonical SHA-256 writers preserve their preimage encoding and digest bytes
  - each incremental computation owns independent state and finish failure or disposal is terminal
  - Git commit contracts consume the shared grammar and reject mixed object formats
  - existing upgrade provenance and baseline schemas still require their original SHA-256 representation
  - external Git IDs and provider digests are never relabeled or silently upgraded
  - publication is isolated from the concurrent security branch and its active control-plane state
  - source publication does not claim activation Bun verification Gate approval migration or merge
tests:
  - src/contracts/digest.test.ts
  - src/contracts/git-object-id.test.ts
  - tests/unit/git-object-id-boundary.test.ts
---

# Digest and Git object boundary

This frozen manifest bounds an independent source proposal against the exact
process preimage above. It is not an activated Work Package, an Operation, a
current-main convergence proposal, or integration authority. The existing active
pointer and SEC-086 convergence manifest remain owned by their concurrent task.
The manifest must be selected and rebound through the normal owner before it can
participate in a later activation; file existence does not perform that action.

This slice closes the lexical/type boundary and the identified consumer seams.
It deliberately does not change a persisted schema, canonical JSON encoding, an
external checksum algorithm, or the active identity writer. Accepting a BLAKE3
spelling in a parser is not an installed or qualified BLAKE3 implementation.

The parent identity-migration task remains open: provider qualification and exact
package/lock adoption, profile/framing ownership, each persistent schema's
migration and writer retirement, remaining consumer/naming convergence, full
Bun and portable-release evidence, concurrent security integration, and final
Gate/merge/readback. Those obligations require their own admitted write scope;
this frozen packet may not be widened or used to bypass the forbidden paths.
