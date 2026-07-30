---
schema: codex-development-work-package-v1
id: test-runtime-template-settlement-v1
tracking: issue-190
base: c289a44609a3502140ede55857d90109d4db744f
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v18
tasks:
  - id: fix-template-lock-and-test-timeouts
    owner: a0
    ownedPaths:
      - tests/testkit/workspace.ts
      - tests/integration/upgrade-pipeline-kernel.test.ts
      - tests/integration/workspace-engineering-ir.test.ts
      - docs/work-packages/test-runtime-template-settlement-v1.md
forbiddenPaths:
  - .agents/skills/
  - .github/workflows/
  - bun.lock
  - docs/00-文档索引与一致性规则.md
  - docs/work/active-work-package.md
  - docs/work/current-state.yaml
  - docs/work/rolling-plan.md
  - package.json
  - platform/cli/
  - platform/compiler/
  - platform/orchestrator/
  - platform/shared/workspace-write-lease.ts
  - platform/shared/paths.ts
  - platform/shared/heavy-verification-gate-lease.ts
  - platform/shared/process.ts
  - platform/shared/project-runtime.ts
  - platform/shared/fs.ts
  - platform/dev-runner/
  - scripts/
acceptance:
  - "withTemplateLock writes owner.json (pid + acquiredAt) on acquire and reclaims stale locks via process.kill(pid, 0) probe plus a 5-minute safety net instead of waiting for the 120s deadline."
  - "createTemplate validates template completeness (readiness marker AND project directory) after creation; incomplete templates fail fast instead of being silently cached."
  - "upgrade-pipeline-kernel.test.ts timeout is 180s to accommodate cold-cache template creation (normal pipeline time, not resource race)."
  - "workspace-engineering-ir.test.ts timeout is 30s to accommodate buildWorkspaceEngineeringIR being called 3 times with disk reads and no cache."
  - "No platform/ or docs authority files are modified; fix is tests/ only."
tests:
  - "bun test tests/integration/upgrade-pipeline-kernel.test.ts tests/integration/workspace-engineering-ir.test.ts --timeout 200000"
  - "bun run typecheck"
---

# Test Runtime Template Settlement V1

Pre-authority unblock slice for Issue #190 (Hermetic Test Runtime). Unblocks PR #196 Full by fixing two main-defect test runtime issues:

1. `withTemplateLock` had no PID owner or stale recovery — a crashed/timeout-killed process left a persistent lock directory blocking all subsequent template builds for the full 120s deadline.
2. `createTemplate` did not validate completeness — a partially copied template (only `.gitkeep` files) was silently accepted.
3. Test timeouts were at the boundary: `upgrade-pipeline-kernel` 120s (cold cache ~120s), `workspace-engineering-ir` 15s (actual ~17s).

This is not a full #190 implementation. It only fixes the minimum needed to unblock #196 Full.
