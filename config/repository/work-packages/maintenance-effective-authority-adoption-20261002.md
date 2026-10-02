---
schema: codex-development-work-package-v1
id: maintenance-effective-authority-adoption-20261002
tracking: none
base: 180188155a14f0578a6941e72b4f3cf74dcc18a2
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: align-maintenance-effective-role-authority
    owner: repository-maintenance
    ownedPaths:
      - ".documentation/source-manifest.json"
      - ".github/workflows/repository-maintenance.yml"
      - "docs/开发/AI协作/规则装载与任务恢复.md"
      - "src/adapters/providers/github-api/credential.ts"
      - "src/adapters/providers/github-api/internal/operation-session-runtime.ts"
      - "src/adapters/providers/github-api/repository-maintenance-permission.ts"
      - "src/adapters/repository/repository-audit/permission-bootstrap-projection.ts"
      - "src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts"
      - "src/adapters/self-hosting/control/repository-maintenance/dispatch.ts"
      - "src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts"
      - "src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts"
      - "tests/contract/permission-bootstrap-projection.test.ts"
      - "tests/contract/repository-maintenance-workflow.test.ts"
      - "tests/unit/github-api-credential.test.ts"
      - "tests/unit/repository-maintenance.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/native-copy-directory-adoption-20261002.md"
      - "config/repository/work-packages/maintenance-effective-authority-adoption-20261002.md"
forbiddenPaths:
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve the exact independently reviewed fourteen authored postimages from published af892a99 and rebound e1456eed, with original producer documentation projection"
  - "Consume actual canonical normalized maintain/admin permission at all five maintenance consumers; author association is diagnostic metadata and not a separate authority gate"
  - "Preserve exact actor/User/non-App/body/main identities, typed command/response shapes, recovery-before-effect, branch expected-OID CAS and readback"
  - "Use one maintenance permission predicate and its generated workflow projection; reject ordinary, contradictory, custom and malformed role observations"
  - "Retain current Workbench documentation and regenerate the sole source manifest from the actual combined source; do not claim overall docs PASS while existing four baseline failures remain"
  - "Do not infer that source adoption itself dispatched or completed cleanup; original exact-main bounded maintenance execution remains separate"
  - "Use original trusted-main proposal compiler, truthful PRE and exact independent final integration review before protected expected-head merge/readback"
tests:
  - "tests/contract/permission-bootstrap-projection.test.ts"
  - "tests/contract/repository-maintenance-workflow.test.ts"
  - "tests/unit/github-api-credential.test.ts"
  - "tests/unit/repository-maintenance.test.ts"
---

# Align maintenance authority with effective repository roles

The user explicitly approved allowing maintain/admin external collaborators without an additional organization-membership requirement. The original permission normalizer, one shared predicate and all five actual consumers now implement that contract while preserving every unrelated identity, persistence, recovery and effect fence. Existing source/native checks and independent adversarial review remain accurately bound; this does not grant ordinary Gate or assert real cleanup success.
