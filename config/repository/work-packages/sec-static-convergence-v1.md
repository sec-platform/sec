---
schema: codex-development-work-package-v1
id: sec-static-convergence-v1
tracking: issue-311
base: 8f5e58c2f9f0feabef6788d36b5aa4e576f836ef
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: converge-verification-architecture
    owner: verification-control-plane-owner
    ownedPaths:
      - config/repository/work-packages/sec-static-convergence-v1.md
      - docs/架构/总体设计.md
      - docs/开发/测试发现与执行.md
      - docs/运行/保证/要求证据与裁决.md
      - docs/运行/验收/方法与独立证据.md
      - docs/运行/验收/测试生成与形式方法.md
      - docs/演进/实施/安全构建发布与环境.md
      - docs/演进/实施/主线前沿与准入.md
      - .agents/skills/sec-test-design/SKILL.md
      - .documentation/source-manifest.json
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
  - Verification实施章节使用稳定显式anchor且所有真实consumer已同步到唯一新引用
  - 开发者测试发现与执行只消费已经选择为case-based方法的VerificationMethod
  - Claim身份绑定owner Requirement主体revision适用域生命周期和真实consumer而不依赖自由claim或gate字符串
  - Verification是贯穿现有十项责任的保证纵切而不是第十一顶层testing模块
  - Requirement Claim ProofObligation VerificationMethodSelection VerificationAction Evidence与Verdict保持不可互相代签的责任边界
  - Testing只是VerificationMethod的一类且可直接检查的repository事实不要求镜像为TestCase
  - TestCase责任绑定稳定identity owner exact ProofObligation exact VerificationMethodSelection Failure Meaning observation boundary环境资源Oracle独立性与retirement
  - Bun保持普通TypeScript测试当前adopted Provider而Vitest需要exact-corpus采用证据且Playwright仅适用于真实Browser owning cell
  - 普通Provider调度机械能力与SEC拥有的语义选择资源authority settlement及Result truth严格分离
  - fast slow suite path title timeout parallel-safe仅作为执行或定位投影而不是TestCase语义身份
  - Proof Economy使用KEEP REWRITE MERGE DELETE UNKNOWN且不因收敛文件数量删除必要独立observation
  - Verification语义按canonical十责任归入assurance compiler application execution adapters entry与bootstrap
  - ValidationClaim与engineering VerificationClaim分离且用户Validation不能替代工程Verdict
  - 现有WorkSelection active pointer rolling plan与current-state控制文件在本次设计收敛中保持不变
  - 每个变化的authoritative文档源都刷新documentation source manifest
tests:
  - tests/contract/agent-skills.test.ts
---

# Verification 架构收敛

本工作包把 SEC 当前分散在测试、CI、Evidence、Assurance 和 Provider 代码中的 Verification 设计收敛到一条明确责任链，不创建第二 roadmap、第二 Test registry、第二 scheduler 或新的 Verification result truth。

长期架构以 Requirement／Invariant → Claim → ProofObligation → VerificationMethodSelection → VerificationAction或纯静态求值 → Evidence → Verdict 为主线。Testing 只在方法已经选择为 case-based verification 后进入；类型与 Schema、Source Program／架构审计、静态安全、形式证明、runtime readback、性能测量和独立工程审查保持各自方法身份。用户 Validation 继续使用独立 ValidationClaim，不进入 engineering ClaimVerdict。

本包同时固定 TestCase 的稳定责任、Proof Economy、Provider 采用与退役条件，并明确 Bun、Vitest、Playwright 等工具只能取得各自真实 capability，不能成为 Claim、Impact、Evidence qualification 或 Verdict owner。普通 runner mechanics 应优先交给 adopted Provider；只有 Provider 无法表达的资源、权限、settlement 与恢复约束继续由 SEC Execution 拥有。

本工作包不激活、不重排 WorkSelection，也不修改当前 active-work-package、rolling-plan、work-selection、源码、测试代码、package/lock 或 workflow。后续实现切片仍由现有 WorkSelection 与 Verification Control Plane 对 exact current main 进行选择、冻结、验证和 readback。
