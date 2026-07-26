---
title: 测试反馈、证据与 CI 分层
status: active
last-reviewed: 2026-07-26
---

# 测试反馈、证据与 CI 分层

本文只拥有本地反馈、PR Quick/Risk、Release/Full、Evidence 复用与 Actions 经济性的稳定语义。当前 revision、artifact 名称、selector、Gate plan 与 timeout 数值由代码合同拥有；历史 SHA、PR、run 与一次性失败记录已移至 `docs/archive/2026-07-23-test-feedback-and-ci-evidence-history.md`，不得回填到本 active authority。

## 1. Canonical owner

| 事实 | 唯一 owner |
| --- | --- |
| CI revision、logical gates、workflow execution model | `platform/shared/ci-contract.ts` |
| changed path canonicality | `platform/shared/ci-git-changed-files.ts` |
| active documentation path ownership | `platform/shared/active-documentation-contract.ts` |
| affected fast inventory | `platform/shared/affected-test-inventory.ts` |
| source → slow/workspace risk | `platform/shared/test-impact-contract.ts` 与 `ci-pr-risk-selection.ts` |
| slow suite registry、资源等级、并行性 | `platform/shared/test-budget-contract.ts` |
| frozen verification execution | `scripts/ci-verification.ts` |
| PR risk execution | `scripts/ci-pr-risk.ts` |
| Scope attestation、Evidence 与 merge authorization | `scripts/codex/**` 与 default-branch workflows |
| 本地依赖、test/import runner | `platform/dev-runner/**` |

文档只解释这些 owner 的组合语义，不复制源码常量、完整 argv、版本迁移史或 Workflow YAML。

## 2. 反馈层级

```text
本地 affected
→ PR Quick
→ impact-selected PR Risk
→ selector-required browser/artifact/platform Gate
→ Release / Full correctness backstop
```

- 每个 Gate 只有一个 `gate_owner`；结果以 `gate_key + tested head + profile` 唯一标识。
- 旧结果只能作为“已验证 baseline + intervening diff impact + delta validation”的组成部分，不能伪装成新 head 的 exact-head PASS。
- 未启动、缺失、超时、损坏、过期或 scope 不匹配均不是 PASS。
- 失败后只重跑失败项和被修复 delta 失效的消费者；不得为制造绿色删除测试、弱化 assertion、无边界加 timeout 或重复整套矩阵。
- 长时 production sentinel 启动前，先执行覆盖同一前置边界的最小 micro-sentinel；micro-sentinel 只能阻止已知无效候选进入昂贵 Gate，不能替代 production evidence。若长时运行的 durable journal 已证明会进入同一失败闭包，应在保留 failure phase、精确输入 delta 与 cleanup 证据后主动终止，修复根因再运行一次，而不是等待 supervisor deadline。

## 3. 本地入口

```bash
bun run deps:ensure
bun run imports:prepare
bun run check:affected
bun run check:fast
bun run check:full
bun run hooks:install
```

- `imports:prepare` 是 authoring 写边界；hosted `imports:check` 是只读 Gate。二者使用同一 organizer，不复制排序算法。
- changed-only imports 必须绑定可解析的 exact base；无效 base 直接 fail closed，不能退化为全仓扫描。
- `deps:ensure` 只发布与 manifest、lock、Bun、OS/architecture identity 匹配且验证完成的依赖 generation；ambient auto-install 和相邻 worktree 依赖不能代替当前仓库依赖。
- `deps:ensure` 与 managed hook lifecycle只闭合 compiler dependency和hook投影，绝不下载浏览器。Playwright browser readiness只属于test/runtime preparation，并绑定精确package identity、项目本地cache、外部Node、正数有界安装预算与可执行文件后置条件。
- `hooks:install` 只在 tracked、executable、byte-equal hooks 且不存在其他真实 hook authority 时安装。lifecycle hook 负责依赖闭合，pre-commit/pre-push 只调用唯一 `imports:freeze`。
- fast process timeout 是共享 runner 合同；显式 override 优先，默认值只由代码 owner维护。不得在单测、selector或 serial registry 中复制 timeout。

## 4. PR Quick

Quick 负责最早发现当前 frozen candidate 的静态与 fast regression：

```text
frozen dependencies
→ changed imports when applicable
→ docs when applicable
→ typecheck
→ canonical affected fast tests
→ selected PR Risk when applicable
```

Quick 必须调用 canonical affected selector；changed source 无 owner、非法 path 或 inventory 不完整时 hosted execution fail closed。普通 push、PR opened/synchronize/ready 只维护元数据，不自动消耗 heavy runner。

## 5. PR Risk

Risk 只运行 diff 影响的合同、slow、browser、artifact、workspace 或 platform Gate：

- `SEC_CHANGED_BASE` 表达完整候选范围，供 contract/risk/ownership 使用。
- `SEC_AFFECTED_TESTS_BASE` 表达快速反馈范围；hosted frozen contract决定两者必须满足的结构关系。
- slow selection 是 bounded baseline、直接 slow test、ownership/import impact 与 mandatory sentinel 的稳定去重并集。
- `--all-slow` 只属于 Full；显式 local batch一次收集同一风险簇，默认 fail fast，只有诊断/收口合同允许 continue-on-failure。
- `parallelSafe` 与资源等级共同决定并发；runtime-heavy 或共享状态 owner 保持隔离。并发不能改变 Gate 语义、环境绑定或失败归因。

## 6. Release / Full

Full 是 correctness backstop，不是日常反馈：

```text
imports / docs / typecheck
→ affected quick
→ complete fast inventory
→ Contract Freeze
→ complete slow registry
→ benchmark / runtime dependency checks
→ ordered workspace compile / verify / lock / explain
→ reference drift
→ final summary
```

Full 绑定 exact source、runtime、profile、contract revision、完整计划与 clean-state evidence。任何 step 未运行都必须在结果中显式分类；前序失败不得被后续局部成功覆盖。

## 7. Frozen hosted verification

A0 在 candidate 停止修改后执行：

```text
current main reconciliation
→ squash/amend 为当前 base 上的 frozen candidate
→ trusted Scope attestation
→ required Quick 或 Full
→ default-branch merge-gate
```

- Manifest 必须从 exact commit ordinary blob 读取并绑定 raw bytes、length、digest、base、head、profile 与 revision；symlink、checkout normalization 或 candidate script不能改变 identity。
- Heavy runner只读执行 exact head，不发布 required status；merge authorization只由 default-branch trust root结合 live PR、Review、ruleset、Scope 与 Evidence计算。
- Head、base、manifest、profile、revision、review blocker或 source tree变化会按合同使旧 evidence失效。
- Draft、共享 head、多 PR、stale base、unresolved review、非法 ownership、dirty candidate 或 trust-root drift必须在分配 heavy runner前确定性拒绝。

## 8. Evidence 与 merge gate

Evidence 至少绑定：

- exact head/tree/base、manifest raw identity、profile/revision；
- canonical changed records、selection reason、owner、完整 Gate plan；
- runtime、argv/environment摘要、开始/结束、duration、result；
- failure tail、raw-output digest、clean state、artifact digest；
- reuse source、intervening diff、失效规则与未运行原因。

Merge gate必须用 default-branch代码和 Git objects独立重算 changed records、ownership、test inventory、plan 与 evidence binding；不得执行 candidate verifier。Candidate 修改 verifier trust root 时，必须升级合同并走旧 trust root/人工 bootstrap，不能由 candidate 自证。

## 9. Contract Freeze、affected 与 slow

- Contract Freeze 绑定公共合同与其 owner tests；公共 schema/IR/operation/diagnostic变化必须运行对应完整 contract set。`verification.docs-doctor`直接绑定 scanner 的 positive/negative/differential fixture，禁止只用当前文档树的正例运行替代失败语义。
- Affected selector是快速反馈，不是完整风险或 Full 的替代。未知映射在本地可以提示，在 hosted verification 必须失败。
- Slow suite必须声明资源等级、并行安全、owner、适用变化、timeout owner 与 cleanup；open handle、process、workspace 或 artifact residue是失败。
- Browser、activation、navigation、restart、release artifact与远端事实不能由 unit/typecheck替代；纯函数也不应无条件触发浏览器矩阵。

## 10. 本地长时 Gate

Formal Work Package 的本地长时 Gate必须通过唯一 supervisor：

- 在 spawn 前复核 exact manifest/source/protected authority；
- 使用受限环境、一个 child、一个 watchdog和独立 cleanup budget；
- 持久 checkpoint/journal，terminal状态与 evidence 原子发布；
- 超时、crash、insufficient evidence 或 cleanup failure均保留 authority并停止，不自动 rerun；
- retained workspace、process、job或临时 artifact只有在显式 ownership与清理授权下处理。

## 11. Evidence 复用与历史

当前复用选择只存在于 Work Package Context Capsule 和机器 Evidence 中；active文档不维护持续增长的 SHA/PR/run 表。

1. 先按 `gate_key + tested head + profile` 查 exact evidence。
2. 若只有旧 baseline，计算 intervening diff 对 Gate owner、inputs、runtime与artifact的影响。
3. 复用未失效部分，只执行最小 delta Gate。
4. Reconciliation Delta 返回复用/失效判断；完成结论仍要求最终实现进入 `main`。

截至 2026-07-23 的旧表格和迁移叙述保存在 historical archive；结构化原始记录继续位于 `docs/evidence/**`。Archive、旧 PR/run 或文档中的 PASS 不参与新 candidate merge authority。

## 12. Actions 经济性与日志

- 优化目标是最小化 billed runner processing，同时完整满足 Required Verification Contract。
- Scope 先于 heavy verification；同一 frozen identity不得重复 dispatch。
- 一个 profile 尽量复用一次 checkout/setup/install；无代码变化不运行 daily full。
- 轻量 revalidator只撤销 stale authority，不运行产品测试。
- 日志必须保留稳定 Gate identity、失败 phase与 bounded tail；不得输出 secret、原始 authority payload或无限日志。
- 当前命令、revision、artifact名、timeout和并发值从 canonical代码/registry读取，不在本文手工同步。
