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

这是按风险选择图，不是每次修改都必须顺序执行的流水线。一个 stable candidate只运行被 changed paths、owner、contract或 release条件选中的最小集合。

- 每个 Gate 只有一个 `gate_owner`；结果以 `gate_key + tested head + profile` 唯一标识。
- 旧结果只能作为“已验证 baseline + intervening diff impact + delta validation”的组成部分，不能伪装成新 head 的 exact-head PASS。
- 未启动、缺失、超时、损坏、过期或 scope 不匹配均不是 PASS。
- 失败后只重跑失败项和被修复 delta 失效的消费者；不得为制造绿色删除测试、弱化 assertion、无边界加 timeout 或重复整套矩阵。
- 长时 production sentinel 启动前，先执行覆盖同一前置边界的最小 micro-sentinel；micro-sentinel 只能阻止已知无效候选进入昂贵 Gate，不能替代 production evidence。若长时运行的 durable journal 已证明会进入同一失败闭包，应在保留 failure phase、精确输入 delta 与 cleanup 证据后主动终止，修复根因再运行一次，而不是等待 supervisor deadline。
- 单次wall-clock变慢只是诊断信号，不是硬baseline、regression或candidate invalidation证据。性能SLO、正式采样与结构性硬不变量的边界以`test-architecture.md`为权威；普通交付不得为确认一个离群点重复整批Gate。

失败处理只有一条路径：

```text
读取首个 failure tail
→ 定位失效输入、唯一owner或invariant
→ 修复根因
→ 只重跑失败sentinel和被delta直接失效的消费者
→ 第一次candidate invalidation后最多refreeze一次
→ 第二次返回STOP_PROOF_RESET并回到reproduction/owner/invariant
```

## 3. 本地入口

```bash
bun run deps:ensure
bun run imports:prepare
bun run test:affected --plan
bun run check:affected --plan
bun run check:affected
bun run check:fast
bun run check:full
bun run hooks:install
```

- `imports:prepare` 是 authoring 写边界；hosted `imports:check` 是只读 Gate。二者使用同一 organizer，不复制排序算法。Focused execution只把selected targets与项目声明作为Language Service roots，import closure和edits仍由TypeScript拥有；candidate freeze只有在Git canonical clean-filter比较确认tracked working tree相对index无delta且没有untracked path时复用physical context，其他情况必须回到隔离full-index snapshot。Physical context不是candidate byte authority：`core.autocrlf`等checkout表示可与index raw bytes不同，selected targets仍由exact staged blobs覆盖，最终publication只写index。
- changed-only imports 必须绑定可解析的 exact base；无效 base 直接 fail closed，不能退化为全仓扫描。
- `deps:ensure` 只发布与 manifest、lock、Bun、OS/architecture identity 匹配且验证完成的依赖 generation；ambient auto-install 和相邻 worktree 依赖不能代替当前仓库依赖。
- `deps:ensure` 与 managed hook lifecycle只闭合 compiler dependency和hook投影，绝不下载浏览器。Playwright browser readiness只属于test/runtime preparation，并把精确三包release与manifest identity、项目本地cache、外部Node、registry-derived platform executable、正数有界安装预算和后置条件绑定为一个opaque authority；consumer不得重选browser或依赖ambient预热。
- `hooks:install` 只在 tracked、executable、byte-equal hooks 且不存在其他真实 hook authority 时安装。首次compiler dependency安装和显式`deps:ensure`负责闭合hook lifecycle；已有validated generation上的普通warmed命令不重复扫描hook bytes。pre-commit/pre-push只调用唯一 `imports:freeze`。
- fast process timeout 是共享 runner 合同；显式 override 优先，默认值只由代码 owner维护。不得在单测、selector或 serial registry 中复制 timeout。
- fast process isolation明确区分bounded-parallel与exclusive；前者只隔离process global并使用独立mutable workspace，后者才串行拥有repository/host/server/runtime共享状态。Runner对完整计划使用唯一shard、isolated并发与process-wave预算，不得把“需要独立进程”自动扩大成“所有进程逐个等待”。
- 默认`test:fast`只运行编辑反馈inventory；完整Workspace compile、durable recovery、server/runtime、真实worktree与完整upgrade transaction由`fast-test-policy.ts`的唯一排除registry留给显式affected/Risk或`test:full`。排除不改变test-impact owner，也不能从full inventory消失。Concurrent shard按单一有界cap成批并行；失败batch等待已启动siblings后停止后续batch。
- 每次fast execution拥有唯一mutable test-workspace namespace，child可提前清理，parent必须在所有退出路径兜底删除并把cleanup failure计入失败。版本化immutable template cache位于namespace外并跨run复用；普通cleanup不得反复重建它，显式`clean:test-workspaces`才清空全部派生测试状态。上次失败残留不得成为下一次测试输入，也不得依赖人工清理完成普通闭环。
- Root typecheck由`tsconfig.json`启用TypeScript原生incremental，并把唯一build info写入Git-ignored `.tmp/typecheck/tsconfig.tsbuildinfo`。该文件只是可删除性能提示；TypeScript拥有compiler version、options与source signature失效语义，SEC不得解析、发布、复用为Evidence或建立第二cache registry。clean checkout/hosted runner仍走cold完整检查。
- `test:affected --plan` 是 changed-path/Risk ownership的只读 preflight：不获取 heavy lease、不准备依赖、不启动 test child、不写 Evidence；任一 unresolved path使 plan与正式 affected都非零退出。其他入口按变化条件选择，不机械全跑。
- `check:affected --plan` 是本地最终闭包的只读Gate并集权威：它复用affected plan，输出唯一有序`gates`和`subsumedStandaloneCommands`，同样不准备依赖、不获取heavy lease、不启动typecheck/docs/test child。纯active docs只选择`docs:doctor`；TypeScript选择`imports:prepare + typecheck`；存在selected affected fast test时才追加`test:affected`。正式`check:affected`在一个dev-runner生命周期内按该计划fail-stop执行，每项最多一次。
- affected执行权只由一次Git discovery返回的immutable resolver-issued capability持有；runner不导出“执行任意plan”的入口，调用者不能用部分changed paths或空test列表构造可执行子集。
- Compiler dependency preparation由并集惰性选择：只有`imports:prepare`或`typecheck`入选才准备compiler generation；纯active docs、空计划与unresolved preflight不支付compiler bootstrap，affected-only仍由test runner拥有其依赖与browser readiness。
- 一旦最终选择`check:affected`，不得先单独运行它列出的`imports:prepare`、`typecheck`、`docs:doctor`或`test:affected`再执行umbrella；开发中只运行会被后续代码修改自然失效的failing/focused sentinel。`check:fast`、`check:full`也不能作为其后的“保险重跑”，除非Risk/release合同明确选择更广profile。

### 3.1 按变更类型选择最小验证

| 变化类型 | 开发中 | frozen candidate | 明确不运行 |
| --- | --- | --- | --- |
| 纯文档 | 相关文档fixture（若有） | `docs:doctor`一次 | typecheck、affected、Risk、Full |
| Leaf TypeScript | 当前failing/focused test | typecheck一次；selector要求时才affected | local Risk、Full |
| 公共合同、IR、selector | focused contract | typecheck + 最终affected；hosted selected Risk一次 | 重复local Risk |
| Runtime、browser、platform | 同前置边界micro-sentinel | 真实production acceptance只在slow owner运行一次；hosted selected Risk一次 | 把Next/Playwright塞进fast或Contract Freeze |
| Verifier trust root | base-side focused bootstrap proof | 人工bootstrap + 独立exact-head Review | 反复发送必然`manual-bootstrap-required`的hosted Quick |
| Release或广泛schema/IR变化 | focused proof | Full / complete slow / reference按合同一次 | 用日常修改触发完整矩阵 |

测试文件本身迁层时，源层fast合同与目标层slow acceptance各运行一次即可；覆盖没有删除时，不再额外运行local Risk。任何表项若被changed-path owner扩大，以机器selector为准并在Evidence记录selection reason。

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

Quick是最终frozen candidate的一次hosted profile；其中`impact-risk`是同一plan按selector条件加入的Risk phase，不是要求先本地跑Risk再hosted重复。正常交付只触发一次Quick，selected Risk若适用也只在该exact head内执行一次。Quick必须调用 canonical affected selector；changed source 无 owner、非法 path 或 inventory 不完整时 hosted execution fail closed。普通 push、PR opened/synchronize/ready 只维护元数据，不自动消耗 heavy runner。

## 5. PR Risk

Risk 只运行 diff 影响的合同、slow、browser、artifact、workspace 或 platform Gate：

- `SEC_CHANGED_BASE` 表达完整候选范围，供 contract/risk/ownership 使用。
- `SEC_AFFECTED_TESTS_BASE` 表达快速反馈范围；hosted frozen contract决定两者必须满足的结构关系。
- slow selection 是 bounded baseline、直接 slow test、ownership/import impact 与 mandatory sentinel 的稳定去重并集。
- `--all-slow` 只属于 Full；显式 local batch一次收集同一风险簇，默认 fail fast，只有诊断/收口合同允许 continue-on-failure。
- `parallelSafe` 与资源等级共同决定并发；runtime-heavy 或共享状态 owner 保持隔离。并发不能改变 Gate 语义、环境绑定或失败归因。
- 可执行的`test:affected`与`ci:risk`是同一physical worktree的互斥heavy Gate。二者CLI在启动任何测试child或写Risk Evidence前获取同一zero-wait lease；只读`test:affected --plan`明确绕过 lease。live contender立即失败，Windows abandoned mutex只恢复已崩溃owner。不得让两者并发争用`.tmp/test-workspaces`、Playwright、Next或Evidence，也不得把并发污染归类为产品FAIL。
- 正常产品交付不执行“local Risk + hosted Risk”双份证明。local Risk只属于无hosted executor的人工bootstrap、Risk runner自身开发或明确诊断；这些例外必须绑定不同的证据目的，不能冒充最终exact-head hosted PASS。

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

每个 Work Package只有一个 candidate epoch。第一次 invalidation只修失败 delta并 refreeze一次；第二次必须回到 failing reproduction、owner与 invariant，禁止继续创建 successor或消耗 hosted Gate。Reviewer只在单一 exact candidate稳定后启动。

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

- Contract Freeze 绑定公共合同与其快速owner tests；公共 schema/IR/operation/diagnostic变化必须运行对应完整 contract set。其成员不得启动Next build、production server、Playwright、浏览器安装或其他slow runtime；真实acceptance必须由slow registry中的Risk owner覆盖。`verification.docs-doctor`直接绑定 scanner 的 positive/negative/differential fixture，禁止只用当前文档树的正例运行替代失败语义。
- `repository.runtime`只绑定`tests/contract/repository-runtime.test.ts`中的repository/package/workflow公共合同，不得把compiler dependency installation、project dependency state、generated project base、文档内容或Task Envelope行为重新塞进同一冻结目标。后五类分别由owner-aligned integration/contract/unit sentinel拥有；source变化只选择真实consumer，不能因历史catch-all文件或文件名相似而继承无关测试。
- Affected selector是快速反馈，不是完整风险或 Full 的替代。本地 plan、正式 affected与 hosted verification都必须对未知 ownership fail closed。
- Affected必须区分changed fact与runnable test：删除/rename-away的测试路径仍完整进入changed-path、ownership、scope与Risk计算，但不能进入runner argv。本地以当前canonical test inventory证明可运行，hosted verification以exact candidate head中的ordinary Git blob证明可运行；新增/修改/rename-to测试只有满足该证明才进入fast/slow runnable set。禁止用保留空测试壳绕过删除语义。
- Slow suite必须声明资源等级、并行安全、owner、适用变化、timeout owner 与 cleanup；open handle、process、workspace 或 artifact residue是失败。
- 同一能力若同时需要真实Git/Language Service快速阻断与完整index/race/rollback覆盖，fast层只保留一个真实micro-sentinel，完整场景进入显式slow suite。Slow fixture可以复用一次初始化的immutable seed，但每个并发场景必须复制为隔离repository，并以单一有界semaphore约束peak；不得共享working tree、index、lock或publication state。是否“变快”遵循`test-architecture.md`的固定环境采样协议：一次warm-up后至少五个有效样本，以median和observed range报告，单次duration不设hard baseline。
- `platform/dev-runner.ts`与`platform/dev-runner/**`的affected/Risk选择只来自`test-impact-rules/verification.ts`的dev-runner owner、direct import和更窄owner声明。公共runner变化只运行轻量入口合同与相关unit/contract；`import-organizer`、managed hook dependency等真实Git能力仍选择各自slow suite。禁止把整个目录重新映射到通用fast列表或全部baseline slow suites。
- managed hook、SM-3 durable terminal与Windows AppContainer的fast/slow文件映射只由`test-architecture.md`和`test-budget-contract.ts`拥有。Test impact必须同时选择fast micro-sentinel与对应slow Risk owner；迁层只移动acceptance，禁止删除覆盖或把slow runtime mock成unit。
- MAX_PATH AppContainer acceptance只接受native成功，或精确的结构化`launch/nativeCode=267` fail-closed；两条路径都必须验证无child process、profile、owner/result、runtime目录和ACL residue。测试标题中的“fails closed”必须有可执行断言，不能靠catch后忽略错误。
- Browser、activation、navigation、restart、release artifact与远端事实不能由 unit/typecheck替代；纯函数也不应无条件触发浏览器矩阵。

## 10. 本地长时 Gate

Formal Work Package 的本地长时 Gate必须通过唯一 supervisor：

- 每个长时或可能等待 approval的命令独立调用；不得放入 `Promise.all`、复合 shell或主动轮询循环，只消费 supervisor的 terminal evidence；
- 在 spawn 前复核 exact manifest/source/protected authority；
- 使用受限环境、一个 child、一个 watchdog和独立 cleanup budget；
- 持久 checkpoint/journal，terminal状态与 evidence 原子发布；
- 超时、crash、insufficient evidence 或 cleanup failure均保留 authority并停止，不自动 rerun；
- retained workspace、process、job或临时 artifact只有在显式 ownership与清理授权下处理。

## 11. Evidence 复用与历史

当前复用选择只存在于 Work Package Context Capsule 和机器 Evidence 中；active文档和`current-state.yaml`不维护持续增长的 failed candidate、SHA/PR/run/review表。

1. 先按 `gate_key + tested head + profile` 查 exact evidence。
2. 若只有旧 baseline，计算 intervening diff 对 Gate owner、inputs、runtime与artifact的影响。
3. 复用未失效部分，只执行最小 delta Gate。
4. Reconciliation Delta 返回复用/失效判断；完成结论仍要求最终实现进入 `main`。

截至 2026-07-23 的旧表格和迁移叙述保存在 historical archive；结构化原始记录继续位于 `docs/evidence/**`。Archive、旧 PR/run 或文档中的 PASS 不参与新 candidate merge authority。

## 12. Actions 经济性与日志

- 优化目标是最小化 billed runner processing，同时完整满足 Required Verification Contract。
- Scope 先于 heavy verification；同一 frozen identity不得重复 dispatch。
- Scope与base-side merge-gate的职责仅是解析受控manifest、读取Git/Evidence并重算authority；它们使用`.bun-version`固定的Bun内建YAML parser、`Bun.Transpiler.scanImports`和无package的canonical collection primitives。YAML另有duplicate-key/anchor/alias/merge/tag/flow/block lexical fail-closed合同；test import scanner另有static import、re-export、literal dynamic import与import-like text合同。runtime closure不得依赖外部package，也不得执行`bun install`。历史manifest必须通过旧strict parser与内建parser的全量value differential。PR/release verification仍各自只安装一次frozen root依赖。
- 一个 profile 尽量复用一次 checkout/setup/install；无代码变化不运行 daily full。
- Actions或本地runner的单次duration只保留为observed sample；没有同条件采样集合时不得据此改变hard budget、timeout或lane归属。
- 轻量 revalidator只撤销 stale authority，不运行产品测试。
- 日志必须保留稳定 Gate identity、失败 phase与 bounded tail；不得输出 secret、原始 authority payload或无限日志。
- Reconciliation telemetry必须记录 tool call、agent spawn、agent wait timeout、context compaction、candidate invalidation、context reload与duplicate Gate计数；这些数据只用于消除流程浪费，不形成第二业务 authority。
- 当前命令、revision、artifact名、timeout和并发值从 canonical代码/registry读取，不在本文手工同步。
