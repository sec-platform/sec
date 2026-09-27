---
schema: codex-development-work-package-v1
id: verification-result-model-closeout
tracking: none
base: f240d4013bf04357249f206ed176920356c63aac
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: close-verification-result-model
    owner: verification-control-plane-owner
    ownedPaths:
      - config/repository/work-packages/verification-result-model-closeout.md
      - .documentation/source-manifest.json
      - docs/运行/验收/会话集成与结果复用.md
      - docs/运行/验收/方法与独立证据.md
      - docs/编译/表示/目标运行与观测.md
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/
  - tests/
acceptance:
  - Claim投影不再把反向consumer关系写回不可变Claim身份
  - VerificationResult对VerificationAction DirectEvaluation reused Evidence和未取得观察使用明确互斥producer分支
  - Applicability MethodSupport AcquisitionMode AcquisitionSettlement MethodConclusion及Evidence资格保持独立
  - timeout cancel resource exhaustion infrastructure failure completion unknown与solver indeterminate不被误报为命题refuted
  - stale或invalid Evidence不改写历史生产者结算和方法结论
  - 纯静态和复用路径无需伪造ActionKey且全部required义务仍按当前资格fail closed
  - 修改后的documentation source projection与canonical正文一致
tests:
  - tests/contract/verification-result-contract.test.ts
---

# Verification Result 模型收口

本工作包修复已合并开放控制规范中最后暴露的Verification结果建模冲突。目标不是增加新的Verification平台，而是让已有Claim、ProofObligation、MethodSelection、Action、DirectEvaluation、Evidence与Verdict之间的责任能够无损表示真实失败和复用。

结果模型分别表达适用性、方法支持、观察取得方式、生产者结算与方法结论；Evidence freshness和qualification保持独立。一个超时的测试不是业务反例，一个完成但返回unknown的solver也不是基础设施失败；静态推导不伪造Action，历史Evidence失效不改写过去实际发生的运行结果。
