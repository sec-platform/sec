---
schema: codex-development-work-package-v1
id: controlled-pr-issue-disposition-single-writer-v1
tracking: issue-352
base: d7a15ea3b766c54ab5eacd422f435964b0a32b24
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: activation-app-locator-provider-repair
    owner: trusted-verifier-tcb
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - docs/development-governance.md
      - tests/contract/ci-contract.test.ts
  - id: canonical-issue-disposition-completion-identity
    owner: development-integration-closeout-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-3bb47145c58b19aef2b1981ac3a28d2561949f4b-01a7d6fd95bcca50355668a87c7b0eeebb0aec6a5344a4c08974bca8e82f07ae.md
      - docs/work-packages/controlled-pr-issue-disposition-single-writer-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/unit/issue-disposition-contract.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/roadmap.md
  - package.json
  - platform/
  - scripts/
  - source/
acceptance:
  - exact healthy main d7a15ea3b766c54ab5eacd422f435964b0a32b24 tree 7b4402738e5f45a58b2e20f2d7f738f371fde874 MainHealth run 31848169718 and WorkDecision receipt sha256:9ff1606d3f883844c56378497a8aab1e122c03ee882b161e0d85dcd48c526c83 select issue 352
  - the first real PRE request sha256:fb43340a322b6e3098cf53fd08b3cc0153cff51b8f8ea28181ffe7d350155e25 produced immutable artifact 9237234236 with digest sha256:0a3396a3e6f4d19d887dc3eda253048cd6c373cc4d51f0260f0c6dab9b2b17b1 but its trusted App locator failed with exact provider detail sha256:67522825656fb8092ae4db6a436b2aad857054a3f7b587f46c1725d77df82871 corresponding to Resource not accessible by integration
  - every trusted workflow job that posts a GitHub Actions App marker to a Pull Request timeline explicitly owns both issues write and pull requests write while validation and candidate jobs remain read only
  - the workflow contract structurally rejects either activation issuer or VerificationSession coordinator losing one member of that paired publication capability
  - this exact provider bootstrap defect is repaired in the already-selected package under independent exact-head Review; no local or user-authored comment is accepted as PRE and no generic manual activation writer or second repair selector is introduced
  - the canonical completion manifest binds the IssueDisposition implementation already present from commit 41f72db071cbbd5cc9a9bfeaa9c2bcec855ca7d7 without changing production bytes or reintroducing the retired issue-disposition-safety-v1 manifest
  - the base pointer's already-published temporary MainHealth repair manifest is removed in the PRE proposal so one completed package cannot continue consuming active candidate capacity
  - controlled pull request title body and generated merge prose retain permanently zero GitHub lexical closing authority and the bounded provider closingIssuesReferences observation remains nonempty-fail-closed
  - IssueDisposition remains the sole lifecycle decision owner while the current provider exposes no conditional Issue writer and every current successful compilation remains progressed with zero close or reopen effect authority
  - unexpected exact PR-caused provider closure remains manual-action-required and every wrong closer ambiguous timeline stale main stale spec provider error pagination and multiple-Issue case remains fail closed
  - the focused contract fixture names only this canonical package identity and no compatibility alias second coordinator generic Issue SDK or caller-supplied completion set is introduced
  - validation reuses the fresh exact-main MainHealth result and runs only the focused IssueDisposition contract CI contract documentation authority typecheck imports and diff closure before independent exact-head Review
  - after exact new-main readback WorkDecision advances to issue 186 and this candidate worktree branch remote and tracking refs close through receipt-backed physical and ref readback
tests:
  - tests/unit/issue-disposition-contract.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Canonical IssueDisposition completion identity

The IssueDisposition safety implementation is already present on the default
branch. This package publishes its one stable roadmap completion identity and
updates the focused contract fixture from the retired package name. It does not
create Issue mutation authority, change the integration coordinator, or retain
an alias for the historical manifest.
