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
      - docs/work-packages/trusted-verifier-causal-closure-v1.md
      - docs/work-packages/repository-information-lifecycle-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/merge-gate.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .github/
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
  - "Trust-root classification separates static privileged surfaces from the actual causal runtime TCB closure; a directory prefix is not sufficient evidence of TCB membership."
  - "`scripts/codex/repository-audit.ts` does not require bootstrap solely because it is under `scripts/codex/`; its classification follows the actual frozen runtime closure."
  - "Changing `merge-gate`, verification-plan/result producers, the TCB contract/lock, privileged workflows/configuration or another actual authority-changing surface still requires explicit bootstrap."
  - "The candidate cannot demote its own trust relevance: a change to the trust-root contract, closure builder or bootstrap classifier itself remains bootstrap-required under the old trusted revision."
  - "Dynamic loader/process-dispatcher/external-import edges remain fail-closed; unresolved causal reachability never becomes ordinary SUT."
  - "Positive and negative tests prove ordinary diagnostics stay outside bootstrap while true verifier/authority changes still trigger it."
  - "This trust-root candidate is verified through the existing trusted-base candidate-as-SUT/manual-bootstrap protocol and becomes trusted only after new-main readback."
tests:
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/documentation-authority.test.ts
---

# trusted-verifier-causal-closure-v1

本包从 `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 激活。前驱
`repository-information-lifecycle-v1`（#282）已经完成 post-merge trust repair：
历史 #326 合并仍保持 `authorityAtMerge: unauthorized`，但 trusted-base、
candidate-as-SUT 与 present-main readback 已物理通过，Issue #282 已关闭。

## 根问题

当前 `scripts/codex/merge-gate.ts` 把整个 `scripts/codex/` 目录列为 verifier
trust root。#282 的物理 replay 同时证明：
`scripts/codex/repository-audit.ts` 不在 `TCB_RUNTIME_ENTRYPOINTS`、不在冻结的
61-module runtime closure，且运行时 `trustedRuntimeClosure()` 也不包含它。

因此当前系统把“目录位置”误当成“能改变 PASS / Evidence / selection / merge
authority 的因果关系”，会让普通 repository tooling 重构无必要地进入
manual bootstrap，并持续放大 #327 的结构收敛成本。

## 最小实现闭环

```text
old trusted revision
→ 独立 trust-root contract
→ static privileged surfaces + exact causal runtime closure
→ merge-gate bootstrap classifier
→ true verifier change => bootstrap-required
→ ordinary non-TCB tooling change => normal SUT verification
→ negative/adversarial tests
→ trusted-base manual bootstrap
→ new-main readback
```

## 非目标

- 不在本包重构整个 `scripts/codex/**`；
- 不实现 #327 repository-audit 数据归位或 namespace 大迁移；
- 不改变 Verification Result、Evidence、Work Package 或 branch lifecycle 语义；
- 不以减少文件数或 LOC 作为安全证明；
- 不把未知 dynamic loader/process edge 当成 ordinary SUT。

## 迁移边界

- #178 继续拥有 trusted verifier / TCB / bootstrap 语义；
- #311 继续拥有 Verification Session / merge authorization 编排；
- #327 只消费本包产生的 causal trust classification，不复制 TCB authority；
- 本包自身修改 trust-root classifier，因此仍必须由旧 trusted revision完成
  candidate-as-SUT/manual bootstrap；不能用新 classifier 自证。
