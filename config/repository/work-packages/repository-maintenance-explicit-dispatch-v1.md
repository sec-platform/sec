---
schema: codex-development-work-package-v1
id: repository-maintenance-explicit-dispatch-v1
tracking: issue-248
base: f29db36c3f13135072d14c06e21348b44915d0ef
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: replace-broad-comment-trigger-with-explicit-maintenance-dispatch
    owner: repository-maintenance-transport
    ownedPaths:
      - config/repository/work-packages/repository-maintenance-explicit-dispatch-v1.md
      - .github/workflows/repository-maintenance.yml
      - src/adapters/providers/github-api/credential.ts
      - src/adapters/self-hosting/control/repository-maintenance/dispatch.ts
      - src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts
      - src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts
      - tests/contract/repository-maintenance-workflow.test.ts
      - tests/unit/github-api-credential.test.ts
      - tests/unit/repository-maintenance.test.ts
      - docs/开发/AI协作/规则装载与任务恢复.md
forbiddenPaths:
  - config/repository/active-work-package.md
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/adapters/self-hosting/control/branch-lifecycle/
acceptance:
  - ordinary Issue and PR comments cannot create repository-maintenance workflow runs
  - lifecycle issue 313 comment remains the durable maintenance request carrier and never becomes destructive authority merely by existing
  - only event type sec-repository-maintenance-v2 can wake the hosted workflow and its payload carries only exact comment locator and raw body digest
  - local dispatcher rereads the exact comment and live main before dispatch and sends no raw maintenance request in the dispatch payload
  - hosted workflow independently rereads the exact 313 comment checks raw SHA256 author association dispatcher identity and live maintain-admin permission before exposing request bytes to runtime
  - runtime independently rereads the exact trigger comment through the GitHub API before any recovery preparation or destructive effect and compares body author issue identity and request bytes
  - repository_dispatch transport remains bound to exact default-branch workflow SHA and current main
  - existing recovery artifact exact-old-OID CAS comment retirement and readback semantics remain unchanged
tests:
  - tests/contract/repository-maintenance-workflow.test.ts
  - tests/unit/github-api-credential.test.ts
  - tests/unit/repository-maintenance.test.ts
---

# Repository maintenance explicit dispatch

把 #313 comment 从“事件触发器+durable carrier”拆成只读 durable carrier。显式本地 dispatcher在验证 comment/main 后发送 repository_dispatch；hosted workflow与runtime再次独立回读原评论和权限。普通评论因此不再产生 skipped maintenance runs。
