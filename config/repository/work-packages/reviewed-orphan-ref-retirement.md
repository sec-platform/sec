---
schema: codex-development-work-package-v1
id: reviewed-orphan-ref-retirement
tracking: issue-313
base: d9f82cbd7e33d8f50f0ae7596126eb9a033f962a
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: bind-reviewed-supersession-to-exact-ref-retirement
    owner: control.branch-lifecycle
    ownedPaths:
      - .documentation/source-manifest.json
      - config/repository/work-packages/reviewed-orphan-ref-retirement.md
      - docs/开发/AI协作/规则装载与任务恢复.md
      - src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts
      - src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts
      - src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts
      - src/adapters/self-hosting/control/branch-lifecycle/sec.module.json
      - src/adapters/self-hosting/control/repository-maintenance/contract.ts
      - tests/unit/branch-supersession-review.test.ts
      - tests/unit/repository-maintenance.test.ts
forbiddenPaths:
  - .github/workflows/
  - src/adapters/providers/github-api/
acceptance:
  - reviewed-superseded 不创建第二套内容处置 authority而复用 branch-lifecycle supersession review owner
  - hosted maintenance 只允许 lifecycle Issue 313 的独立 review comment 作为 reviewed-superseded evidence
  - review v3 绑定 exact repository issue branch head commit tree current main commit tree actual merge-base commit tree 与完整merge-base到head source-delta path-set digest approved verdict及空unknowns
  - current main在merge-base之后新增的无关路径不得扩大semantic supersession人工审查面
  - evidence comment 作者必须在每次观察时重新证明 maintain 或 admin 权限
  - prepare effect-boundary terminal readback 都重新读取 review evidence live main open PR consumer 与 exact ref old OID
  - CAS 前后必须调用同一 remote-state observer不得保留第二套按classification手写的 effect-boundary 分流
  - evidence comment main ref permission 或 path-set 任一漂移必须 fail closed
  - destructive effect 继续复用 durable recovery artifact download revalidation 与 exact-old-OID CAS
  - reviewed-superseded 只在prepare时exact ref仍present时签发若删除后终态未知则保留原carrier进入显式reconciliation不得凭absent自动结算
  - maintenance request 仍保持一请求一ref且不复制 review 正文
  - legacy closed-pr main-tree-identical transport-only 行为保持不变
tests:
  - tests/unit/branch-supersession-review.test.ts
  - tests/unit/repository-maintenance.test.ts
---

# Maintainer-reviewed orphan ref 退役

该工作包只补齐 Issue #313 已记录的 semantic-orphan closeout 缺口。内容处置仍由 branch-lifecycle 的 supersession-review owner 签发；repository-maintenance 只运输一个 exact ref、expected main 和 evidence comment identity。

V3 review comment 不是普通删除命令。它必须覆盖目标 ref 自 exact merge-base 到 head 的完整 source delta，并由当前 maintainer/admin 采纳；current main 自 merge-base 之后的无关演进只绑定 current-main identity，不扩大 source-delta disposition review。branch-lifecycle 在每次远端状态观察时重新取得评论、权限和 native Git 证据，因此 prepare 之后发生的评论改写、main 漂移、ref 移动、open PR consumer 或权限变化都会在 CAS 前阻断删除。
