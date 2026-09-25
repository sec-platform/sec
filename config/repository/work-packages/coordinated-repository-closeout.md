---
schema: codex-development-work-package-v1
id: coordinated-repository-closeout
tracking: none
base: 8c6dc289e3fe17b358e6a9c335fbbe092b8ce1ce
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: repository-convergence-closeout
    owner: repository-convergence-owner
    ownedPaths:
      - .agents/
      - .documentation/
      - .github/
      - .githooks/
      - .gitignore
      - AGENTS.md
      - config/
      - docs/
      - knip.json
      - package.json
      - src/
      - tests/
      - tools/
forbiddenPaths:
  - LICENSE
  - LICENSES/
  - README.md
acceptance:
  - repository architecture, naming, identity, runtime-state, documentation, tooling, trust and maintenance convergence preserve their canonical owners and current external semantics
  - every changed path between the frozen main base and the candidate is owned by this manifest and no forbidden path is changed
  - src has exactly the ten canonical responsibilities with no duplicate zero-authority control facade
  - documentation tools and tests are isolated under the documentation tool owner while self-hosting TypeScript feedback remains under self-hosting development
  - source trust roots name only real declared source boundaries and do not pre-authorize nonexistent future directories
  - current repository-control, Git, GitHub, process, recovery and identity migrations retain exact readback, failure and compatibility boundaries
  - recent organization and test-verification design material is absorbed into existing canonical owners without creating competing architecture authorities
  - exact candidate hosted CodeQL and the repository full verification profile are required before integration
  - superseded pull requests, temporary branches, transport artifacts and recoveries are retired only after their valid content is preserved or proven absorbed
  - merge remains blocked until review, scope-effect, gate and current-main bindings all refer to this exact candidate generation
tests:
  - tests/unit/document-control-entrypoint-stability.test.ts
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/active-documentation-contract.test.ts
  - tests/unit/local-gate-union.test.ts
  - tests/unit/closed-unmerged-closeout-production.test.ts
  - src/adapters/providers/git/ref-effect.test.ts
---

# Coordinated repository closeout

Close the repository-wide SEC-086 convergence on one exact main base and one exact candidate tree. This manifest records the actual repository scope already carried by the candidate; it does not weaken product, review, verification, MainHealth, branch-lifecycle or merge authority. The closeout preserves the ten canonical responsibilities, retires duplicate/temporary owners and transport residue, and requires exact-head hosted and integration evidence before main publication.
