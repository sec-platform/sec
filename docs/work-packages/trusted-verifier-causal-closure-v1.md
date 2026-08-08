---
schema: codex-development-work-package-v1
id: trusted-verifier-causal-closure-v1
tracking: issue-178
base: 26dcb43c77c9bdfebee35efc217113c958ed017d
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: trusted-verifier-causal-closure
    owner: trusted-verifier-tcb-maintainer
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-trusted-bootstrap.yml
      - docs/work-packages/trusted-verifier-causal-closure-v1.md
      - docs/work-packages/repository-information-lifecycle-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/ci-trust-root-registry.json
      - platform/shared/affected-test-inventory.ts
      - platform/shared/default-branch-revision-health.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/codex/merge-gate.ts
      - scripts/codex/repository-audit.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/default-branch-revision-health.test.ts
      - tests/contract/documentation-authority.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/tcb-trust-root-contract.test.ts
  - id: test-runner-host-independence
    owner: test-runtime-maintainer
    ownedPaths:
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .agents/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/authority.json
  - docs/archive/
  - docs/evidence/
acceptance:
  - 'Trust-root classification has one canonical machine registry and separates explicit static privileged surfaces from the exact causal runtime TCB closure; directory location alone is not TCB evidence.'
  - '`scripts/codex/repository-audit.ts` is ordinary SUT unless it becomes causally reachable; changing merge-gate, TCB registry/contract/lock, privileged workflows/configuration or another actual authority-changing surface remains bootstrap-required.'
  - 'The candidate cannot demote its own trust relevance: PR/release verification consumes the trusted-base registry before candidate execution, and registry/classifier changes remain protected by the old trusted revision.'
  - 'The live runtime closure, frozen registry causalRuntimePaths and generated TCB lock have exact module/edge/external-import/process-dispatcher parity; unknown dynamic loading remains fail-closed.'
  - 'A durable `sec-trusted-bootstrap` GitHub Actions execution surface accepts only exact trusted-base repository_dispatch requests, runs a credential-minimized candidate-as-SUT regression, and publishes Evidence without granting merge authority itself.'
  - 'The completed #282 manifest is removed from the active directory after its machine consumers migrate to durable lifecycle/verifier owners; history remains Git/PR/Issue/Actions evidence rather than a second active manifest.'
  - 'Focused positive/negative contracts, repository audit, affected selection/tests and physical GitHub execution pass; independent Review and new-main readback are required before the new trust revision becomes authoritative.'
  - 'The required fast-test runner regression is host-independent: one-CPU, two-CPU and wider hosts cannot deadlock by waiting for siblings outside the scheduler first batch; this fixes the exact current-main failure discovered during #178 physical verification rather than reclassifying it as non-blocking.'
tests:
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/test-runner.test.ts
  - tests/contract/default-branch-revision-health.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/repository-audit.test.ts
---

# trusted-verifier-causal-closure-v1

本包从 `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 激活。前驱
`repository-information-lifecycle-v1`（Issue #282）已经完成 post-merge trust repair：
历史 PR #326 的 `authorityAtMerge` 仍为 `unauthorized`，但 trusted-base、
candidate-as-SUT 与 present-main readback 已物理通过，Issue #282 已关闭。

## 根问题

#282 物理 replay 已证明 `scripts/codex/repository-audit.ts` 不在
`TCB_RUNTIME_ENTRYPOINTS`、不在冻结的 61-module runtime closure，运行时
`trustedRuntimeClosure()` 也不包含它；但旧 classifier 仍把整个 `scripts/codex/`
目录当 verifier trust root。目录位置因此错误放大普通 repository tooling 的
bootstrap 成本，并直接阻塞 Issue #327 的结构收敛。

同时旧 PR/Release verifier 各自复制 trust path 数组，形成第二、第三事实源；
旧 #282 machine records 又把已经完成的 Work Package manifest 当 durable current-tree
reference，与 `docs/work/README.md` 的单 active manifest 生命周期规则冲突。

## 实现闭环

```text
old trusted main
→ one canonical trust-root registry
→ explicit static privileged surfaces + exact causal runtime closure
→ merge-gate / PR verifier / release verifier consume trusted-base registry
→ true authority delta => bootstrap-required
→ ordinary non-TCB tooling => normal SUT verification
→ GitHub base-owned trusted bootstrap runner
→ candidate-as-SUT physical regression + Evidence
→ independent Review
→ manual trust transition through existing #311 authority
→ new-main registry / TCB / workflow / audit readback
```

## 非目标

- 不在本包重构整个 `scripts/codex/**`；
- 不搬迁 #282 的 146-row deleted-blob data 或 Nexus 29 EPR table，那属于 Issue #327；
- 不改变 Verification Result 五态、Evidence DAG、Work Package 或 branch lifecycle 语义；
- 不用 LOC、文件数或目录命名代替因果 trust proof；
- 不把未知 dynamic loader、process dispatcher 或外部 import 当 ordinary SUT；
- 不让新 candidate workflow/classifier 为自身提供 merge authority。

## 信任迁移边界

- Issue #178 唯一拥有 trusted verifier / TCB / bootstrap 语义；
- Issue #311 继续拥有 Verification Session / merge authorization 编排；
- Issue #327 只消费本包生成的 causal trust classification，不复制 TCB authority；
- `sec-trusted-bootstrap` 只产生物理回归 Evidence，不等价于 Review 或 merge authority；
- 本包自身改变 trust registry、classifier 与 workflows，因此必须由旧 trusted revision
  识别为 trust transition，并在 new-main readback 后才建立新的 trusted epoch。

## 物理验证期间修复的独立 blocker

exact `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 在 GitHub 2-CPU runner 上已独立复现
`tests/unit/test-runner.test.ts` 的 host-concurrency 死锁：旧测试等待 4 个 independent-process
child 全部启动，但 scheduler 的真实 first-batch limit 为 2。该 required failure 不得降级为
non-blocking；本包以独立 `test-runtime-maintainer` task 修复测试合同，不改变生产 scheduler。
