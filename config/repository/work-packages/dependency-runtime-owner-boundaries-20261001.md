---
schema: codex-development-work-package-v1
id: dependency-runtime-owner-boundaries-20261001
tracking: none
base: ace0b734551c250ef0da83071562bd985e53433a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: separate-binding-and-registry-observation
    owner: compiler-dependency-runtime
    ownedPaths:
      - src/adapters/toolchain/dependencies/runtime/project-runtime.ts
      - src/adapters/toolchain/dependencies/runtime/materialization-binding.ts
      - src/adapters/toolchain/dependencies/runtime/linked-worktree-owner.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/source-transition-first-qualified-20261001.md
      - config/repository/work-packages/dependency-runtime-owner-boundaries-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .codex/
  - .github/
  - tests/
  - src/adapters/repository/
  - src/adapters/verification/
  - src/adapters/self-hosting/
  - package.json
  - bun.lock
  - LICENSE
  - LICENSES/
  - crates/
acceptance:
  - This external-maintainer source proposal issues no active Work, Gate, health, adoption or automatic integration authority
  - Separate read-only compiler and runtime materialization binding observation from dependency installation, coordination, publication, recovery and generation retention
  - Preserve exact public exports, declaration bodies, serialization versions, content identities, errors and all existing consumers without a parallel registry or resolution implementation
  - Keep physical linked-worktree registry admission, retained control-file handles, reciprocal topology, liveness and reverse-order cleanup together behind one checked admission function
  - Preserve the caller-owned retained authority try-finally and every same-byte replacement or content-drift failure without exposing file acquisition or disposal constructors
  - Retain the private stage-intent and disposal group because pre-intent compiler failure and project staging rollback do not share one issued transition authority
  - Keep exact physical preimage, closed-world inventory and lifecycle guards intact; a structural selector or parsed intent alone does not grant disposal authority
  - Preserve adoption and rejection reasons in owning source comments without claiming an externally reachable vulnerability or complete large-owner architecture closure
  - Reuse exact declaration and public-export equivalence, focused pinned TypeScript 7 evidence and nine bounded binding or native Git behavior scenarios; no new full or cold analysis run
  - Keep native Bun installation and Git registry mechanics without a new dependency manager, issuer table, callback facade, cache or workflow framework
  - The tests list identifies the unchanged relevant regression corpus and does not claim that the full file was run or require duplicate unchanged evidence
  - Require independent exact source and final control review before publication, and retain any trusted manual-bootstrap-required verdict without relabeling it as Gate PASS
  - Root owns authorized publication, integration and main readback; do not push before the independent review verdict
  - No Rust, unrelated source change, dependency installation, normative documentation update or branch protection change
tests:
  - tests/integration/project-dependency-runtime.test.ts
---

# Separate dependency observation and registry admission

The binding leaf observes package content against existing compiler and runtime
bindings. Bun remains the installer and resolver; native module entrypoint
resolution does not prove the retained manifest closure.

The linked-worktree leaf retains Git's physical registry files while dependency
readiness is observed. A path-only Git projection cannot replace reciprocal
identity checks, retained handles, currentness checks and disposal.

Staging remains with the original coordinator. Failure before a durable intent
and project rollback keep their operation-owned physical preimages at the private
disposal boundary. A future split requires a complete existing authority and
liveness boundary across birth, publication, recovery, disposal and retirement;
file length alone does not justify another issuer registry or manager.
