---
title: 测试反馈与 CI 分层
status: active
last-reviewed: 2026-07-12
---

# 测试反馈与 CI 分层

本文是本地反馈、PR quick、PR risk、release/full 和 Package Script 边界的权威文档。

## 1. 目标

```text
本地小改动 → 快速得到相关反馈
PR 新提交   → 先给高信号 quick 结果
PR 风险     → 再跑 impact-selected 风险验证
发布/定时   → 完整 correctness backstop
```

不要用大量近义 package scripts 表达同一层级。

## 2. 本地入口

```bash
bun run check:affected
bun run test:affected
bun run check:fast
bun run check:full
bun run imports:organize
```

`affected` 只选择相关 fast tests；未知映射产生 notice，不自动膨胀为全部 slow/full。

## 3. PR Quick

职责：最快发现当前提交的 TypeScript 和受影响 fast test 问题。

逻辑：

```text
install frozen dependencies
→ check changed imports（TypeScript changed 时）
→ typecheck
→ canonical test:affected
→ impacted PR Risk（存在 slow / workspace risk 时）
```

Quick 必须调用唯一 `test:affected` 入口，不得在 Workflow 或 CI coordinator 内重写第二套 fast selector。Quick 不默认跑 slow e2e，不使用 broad fast fallback，除非显式开启现有 fallback 环境变量。

Affected selector 默认关注最近提交反馈，避免大型 PR 的每个小修复都重新扩张到整个 PR diff。

## 4. PR Risk

职责：处理 PR 范围的合同、Workspace 和 slow impact 风险。

逻辑：

```text
contract freeze if impacted
→ impact-selected slow suite/files
→ workspace fast gate
```

PR Risk 不无条件执行所有 slow suites，也不默认执行 `verify --lane all`。

Risk changed-file 计算优先使用 `SEC_CHANGED_BASE` 的完整 PR 范围。`--all-slow` 是 Full 的 slow executor，只执行 Registry 中的完整 slow suite，不重复 Contract Freeze 或 workspace fast。

Engineering IR/Fact/Projection 公共类型、Builder、Schema、Artifact Path 变化应进入 Contract Freeze 或对应风险选择规则。

## 5. Release / Full

职责：最终 correctness backstop。

```text
imports / typecheck / docs
→ canonical affected quick evidence
→ complete fast inventory
→ contract freeze
→ complete slow suite registry
→ benchmark/runtime dependency checks
→ full workspace compile/verify/lock/explain
→ reference drift
→ final summary
```

Full 的 Ticket semantic vertical 是命名的强制 slow gate，覆盖 canonical frontend、Workspace Semantic Link、validated IR、IR-owned generator、runtime enforcement、canonical projection 与 Artifact Provenance。完整 Full evidence 同时声明其对 Quick、Risk、Full correctness 的覆盖，并绑定 exact head、current base 与 verification contract revision。

触发方式由 GitHub Workflow 事实源决定。文档不复制完整 Workflow YAML。

## 6. Diff Base

分开两个责任：

```text
SEC_CHANGED_BASE
  PR 范围，用于 contract/workspace risk。

SEC_AFFECTED_TESTS_BASE
  最近提交范围，用于快速 affected feedback。
```

不要只用 `HEAD^1..HEAD` 判断整个 PR 的合同风险；也不要默认用整个 PR diff 选择每次 affected test。

## 7. Contract Freeze

Contract Freeze 保护机器或开发者依赖的稳定面，例如：

- CLI public command/JSON。
- package public surface。
- error protocol。
- CI/test budget contracts。
- Artifact path contract。
- Engineering IR public schema（正式冻结后）。
- Semantic View/Mutation public schema（正式冻结后）。

新增 Contract Test 必须以稳定 `contractId` 注册到 Contract Freeze target source。Target 列表以 `contract-freeze-contract.ts` 为事实源；runner 按注册文件执行，不允许用 test title 或 `--test-name-pattern` 作为合同身份。

## 8. Affected Test 选择

Source classification 至少显式区分 TypeScript、Manifest、Semantic Contract YAML 与 Source Model。Test ownership 按三层：

1. architecture owner / Pipeline pass / Semantic Contract 的显式 ownership declaration。
2. 自动源码引用：扫描 import/明确 repo path reference，作为补充 evidence。
3. 路径规则只作 legacy fallback，不得与显式 identity 竞争 owner authority。

直接变更 fast test 仍直接运行；直接变更 slow test 进入 PR Risk。`source/**` 不得因为不在 `platform/**` 下而静默漏选。

缺少 mapping 时给清晰 notice。不要因为 selector 不完整就把 PR Quick 变成 Full。

v0.4 后可将 Fact Impact 作为第四类选择 Evidence，但在 Impact Engine 稳定前不得用低置信 inferred fact 跳过 correctness backstop。

## 9. Slow E2E

Slow E2E 有价值，但不属于 PR Quick 默认路径。

失败只分两类：

- 真实实现回归：修实现。
- 预期行为已明确改变：更新 assertion。

禁止为了 CI 变绿直接删除 Slow Test。

## 10. Package Script 边界

`package.json` 是 script value 事实源。文档和测试不复制完整 script object。

稳定人类入口族：

```text
sec
dev
typecheck
test:*
check:*
imports:*
```

复杂 orchestration 放在 dev-runner、CI scripts 或 shared contract builder。

## 11. 日志

每个 CI Gate 输出：

- gate id。
- started/finished。
- duration。
- exit code。
- selector reason（如适用）。
- exact head SHA、base SHA、contract revision 与覆盖 profile。

GitHub Actions 使用 group 展开边界，失败日志必须能快速定位负责 Gate。

PR workflow 的结构化合同同时校验 trigger、step order 与 exact-head wiring：`run-full` label 保留时，后续 `synchronize` 必须取消旧 head run，并在最新 head 重新执行 Full；`always()` 只用于 evidence/status diagnostics，不得让失败后的 mutating Gate 继续运行。

## 12. 大改动模式

大规模重构：

```text
在独立分支形成逻辑提交
→ 先跑 affected/typecheck/docs doctor
→ 推送 PR
→ 读取远端 CI 的具体 Gate 日志
→ 按失败根因修复
→ full backstop
```

不要在不理解失败来源时连续堆补丁，也不要让文档指向已经删除的合同文件。

## 13. 验证证据复用账本

昂贵验证结果必须持久记录，不能因为后续出现新 commit 就无条件重跑。自 v0.3 exit review 起，每个新 evidence unit 至少记录：

- `schemaVersion`、稳定 `evidenceId`、tested head/tree、base head/tree、profile 和 verification contract revision（已知时）。
- 每个 Gate 的稳定 `gateId`、精确 `argv` 数组、exit code、started-at / finished-at（runner 可用时）、duration 与 PASS / FAIL；不得用自然语言命令摘要替代可重放参数。
- 覆盖范围至少包含 changed-files digest、source kind / owner、fast tests、slow suites 或 pass / contract IDs 中适用的部分。
- 原始 evidence 定位及其 digest、运行前后 tracked tree 是否 clean，以及 artifact/reference changed-path count（适用时）。
- 明确的 reuse/invalidation rules 与 `remainingGaps`；缺失时间戳等字段必须标为 unavailable，不得追溯伪造。

旧结果不得伪装成新 head 的 exact-head 结果。A0 可以把“已验证 baseline + intervening diff 的影响判断 + 只覆盖 delta 的目标验证”组合为当前 integration state 的 trusted evidence；组合记录必须声明 integration head/base/revision、引用的 `evidenceId`、intervening diff 范围与 digest、每项 reuse / invalidated / rerun 决定、Quick/Risk/Full 覆盖和剩余缺口。只有 diff 触及 Gate 的输入、合同、选择器、运行时依赖或被覆盖语义时，该 Gate 才失效并需要重跑。

历史表格不追溯伪造缺失字段；本节已有的短 `Evidence ID` 只作为 **legacy ledger alias**，不代表旧记录满足当前 schema。后续批次在 runner JSON 尚未原生输出全部字段时，由账本补齐 selection reason、owner、intervening-diff 与 invalidation 判断。一次显式 batch 必须一次收集同一风险簇的全部 suite；修复后只重跑失败或被新 diff 失效的成员。

### 2026-07-11 P0-2A integration baseline

| Tested head                                                                                   | Evidence                                        | Gate / scope                                          | Result       | 复用与失效规则                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c324514d7a32b74e2b9f60d92155d8d218bf9cee`（base `37bc21fb6e503e62a00c2b072d02294ae8ed5261`） | GitHub run `29140910853`; artifact `8245260187` | imports                                               | PASS（4.2s） | 后续 diff 未改变 import 规则时可复用；变更源文件只需 changed-only check。                                                                                           |
| 同上                                                                                          | 同上                                            | typecheck                                             | PASS（7.9s） | 类型面变化时失效，只重跑 typecheck。                                                                                                                                |
| 同上                                                                                          | 同上                                            | docs-doctor                                           | PASS         | 文档变化时失效，只重跑 docs doctor。                                                                                                                                |
| 同上                                                                                          | 同上                                            | full-fast                                             | PASS（217s） | 后续 delta 已由对应 focused tests 覆盖且未改变 fast runner / selector / shared test infrastructure 时复用。                                                         |
| 同上                                                                                          | 同上                                            | test-budget                                           | PASS         | suite registry、预算合同或选择逻辑变化时失效。                                                                                                                      |
| 同上                                                                                          | 同上                                            | all-slow-risk                                         | PASS（830s） | slow implementation、fixtures、toolchain/runtime boundary 或选择合同变化时失效；纯 identity plumbing 由目标 seam tests 覆盖时不重跑。                               |
| 同上                                                                                          | 同上                                            | benchmark、dependency warmup                          | PASS         | benchmark 路径、预算、依赖锁或运行时安装边界变化时失效。                                                                                                            |
| 同上                                                                                          | 同上                                            | resolve / compose / adapt、verify-all、lock / explain | PASS         | 对应 pipeline stage、artifact schema 或 reference inputs 变化时，仅重跑受影响 Gate。                                                                                |
| 同上                                                                                          | 同上                                            | reference-check                                       | FAIL         | 失败限定为 6 个 ExplainGraph / Lock / Workbench reference artifacts 漂移；不否定其余 PASS Gate。刷新这些 artifacts 后必须在新 commit 上单独重跑 `reference:check`。 |

本 baseline 之后的 App identity delta 修改了 Lock / ExplainGraph identity 和 6 个 reference artifacts，因此只使 typecheck、App / ExplainGraph focused tests、docs / imports changed-only checks 与 reference-check 失效；full-fast、all-slow-risk、benchmark 和 dependency warmup 继续复用上述证据。

### 2026-07-11 P0-2A delta evidence

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `8738eee6a06b02834dabbe6cf11670a8a8f58718` | 本地 `imports:check`（changed-only）、`typecheck`、`docs:doctor` | App identity delta 静态门禁 | PASS | import 规则、类型面或对应文档再次变化时，只重跑对应 Gate。 |
| 同上 | 本地 `bun test tests/unit/explain-app-identity.test.ts tests/unit/canonical-ir-identity-revision.test.ts tests/e2e/graph.test.ts --timeout 180000` | App / revision / ExplainGraph seam | PASS（14/14，约 12s） | Lock / App identity、revision 或 ExplainGraph producer 变化时失效。 |
| `52b7973e62ee277367c62acfff70738b41a1e314` | 本地 canonical hash / provenance / baseline / write-boundary focused set | Windows EOL determinism delta | PASS（7/7，约 1.4s） | project hash、provenance generation / inspection 或 baseline/write-boundary 变化时失效。 |
| 同上 | 本地 `reference:check` | refresh + tracked diff + untracked scan | PASS（约 46s；changed paths 0） | reference inputs、生成逻辑或受管 `source project control` artifacts 变化时失效。 |

Windows 首次运行曾暴露 raw-byte provenance hash 随 CRLF 漂移。最终修复保留 baseline 的 byte-exact hash，并只对跨平台持久化的 provenance 文本 hash 规范化 EOL；因此不能再用手工回填 `provenance.json` 作为 reference-check 证据。

### 2026-07-11 P0-2B Validated IR Boundary delta evidence

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `0d94fca83b2d1de5cc4a67e6c8e3079518775dcd`（base `9385b94fd2cf875a5abc329f46ca11982f887e06`） | 本地 `bun test tests/unit/validated-engineering-ir.test.ts tests/unit/engineering-ir.test.ts tests/unit/predicate-signatures.test.ts tests/unit/scenario-fact-canonicalization.test.ts --timeout 180000` | validated snapshot 签发、deep freeze、revision、Entity / Fact / Assertion identity、运行时枚举诊断、Predicate Signature 与 Scenario canonical cache | PASS（23/23，约 1.4s） | Validator、IR identity/revision/normalization、Predicate Registry、Scenario Fact 或 validated consumer boundary 变化时失效；只重跑本 focused set 及新增受影响 seam。 |
| 同上 | 本地 `typecheck`、`docs:doctor`、`git diff --check` | 类型边界、authority docs 与 patch hygiene | PASS（typecheck 约 6.7s；docs doctor 约 0.5s） | 类型导出或 authority docs 变化时只重跑对应 Gate。 |
| 同上 | 本地 `SEC_IMPORTS_CHANGED_ONLY=1`、`SEC_CHANGED_BASE=9385b94fd2cf875a5abc329f46ca11982f887e06`、`imports:organize` + `imports:check` | P0-2B changed TypeScript files | PASS（约 9.3s；organizer 无内容 diff） | import 规则、base 或 changed TypeScript files 变化时失效。 |

P0-2B delta 新增尚未接入 legacy Pipeline / Projection 的 validator、branded snapshot 与只接受 validated snapshot 的 index consumer；现有 `indexEngineeringIR(rawIR)` 及 canonical Builder 输出未改变，也未修改 artifact/reference producer、测试选择器、slow implementation、fixtures、依赖锁或运行时工具链。因此继续复用 P0-2A baseline 的 full-fast、all-slow-risk、test-budget、benchmark、dependency warmup、resolve/compose/adapt、verify-all、lock/explain 与已经 clean 的 `reference:check`，不重复全量或 GitHub Actions。

### 2026-07-11 P0-3 Semantic Pipeline Spine delta evidence

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `a702dfdc2eed00979274cef8e935a1f29ce95c31`（base `0fc25479fe5ccee0cda2320c5d9e4c08405e2208`） | 本地 `bun test tests/integration/semantic-pipeline-spine.test.ts tests/integration/pipeline-kernel.test.ts tests/unit/pipeline-pass-registry.test.ts tests/unit/validated-engineering-ir.test.ts --timeout 180000` | Ticket resolve → semantic/build-ir → compose、transaction-owned snapshot、partial compile semantic prelude、failure/block/retry、validated boundary | PASS（14/14，约 20s） | Pipeline stage/pass/context、workspace semantic input、validator 或 Ticket semantic contract 变化时失效。 |
| `b3e24e55f20fba8053c0ba9953a647ae4a71d482` | 本地 Workbench + Upgrade pipeline focused set | 两个 all-lane 完整重编译入口 | PASS（2/2，约 158s） | Workbench compile handler、Upgrade recompile、Pipeline stage order 或 runtime verification 变化时失效。 |
| 同上 | 本地 raw IR regression set | legacy `buildWorkspaceEngineeringIR()` 与 P0-2A invariants | PASS（9/9，约 13s） | workspace input loader、raw compatibility builder 或 P0-2A identity invariants 变化时失效。 |
| 同上 | 本地 test-impact / pass-registry focused set、project-base contract | selector ownership、physical pass ownership、Webpack local runtime bridge | PASS（16/16 + 1/1） | test-impact rules、pass registry 或 project base/runtime server contract 变化时失效。 |
| `048598d86e290f225d466dd58606d7d1d640d724` | 本地 `reference:refresh` 后 `reference:check` | reference full compile、`build-ir` Lock state、Ticket acceptance、ExplainGraph/Workbench/provenance drift | PASS（refresh 约 72s；check 约 64s；changed paths 0） | reference input、Pipeline/Lock、project-base、artifact/provenance producer 变化时失效。 |
| 同上 | 本地 `test:budget` 与 `tests/e2e/runtime-host.test.ts` | selector/test budget contract 与 generated runtime host | PASS（runtime-host 1/1，约 7s） | suite registry/budget、project-base 或 compose runtime host 变化时失效。 |
| 同上及其代码祖先 | 本地 changed-only imports、`typecheck`、`docs:doctor`、`git diff --check` | P0-3 静态与文档门禁 | PASS | imports/type/doc authority 变化时只重跑对应 Gate。 |

第一次 Workbench/Upgrade probe 在 `build-ir` 已成功后因 Windows Turbopack 拒绝共享 `node_modules` junction 而失败；生成项目 dev/Playwright server 改为与 build 一致的 Webpack 后，同一组 all-lane tests 通过。第一次 reference refresh 随后暴露 reference Plan 漏声明 `tenant_only_sees_own_tickets`（`IR-FACT-003`）；保留 validator hard fail，补齐 Plan acceptance 并执行真实 refresh，最终 exact-head clean。两次失败均为已定位并关闭的 delta evidence，不得在后续误记为当前失败。

P0-3 改变 Pipeline stage/pass/context、Lock `build-ir` 状态、reference input 与本地 runtime server contract，因此旧 baseline 在这些表面失效，已由以上 focused/all-lane/reference 证据替代。依赖版本/锁、benchmark、dependency warmup、非 Pipeline slow suite 与其测试基础设施未改变，继续复用 P0-2A baseline；未运行 GitHub Actions，也未重复 full-fast 或 all-slow matrix。

### 2026-07-12 P0-4 Workspace Semantic Linker delta evidence

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `fd09283fa6bbaf72152e10b1da6bcf0b13cfcd08`（base `7f3dfc0405d164d62ed438b3bd1e20c07a1b77ea`） | 本地 semantic contract / responsibility / predicate / linker unit set | Contract import、kind-specific resolution、explicit Policy mapping、Predicate Signature、stable diagnostics | PASS（17/17） | Contract schema/loader、Linker、Policy mapping、Predicate Registry 或 IR append 变化时失效，只重跑对应 focused set。 |
| 同上 | 本地 semantic contract、workspace Engineering IR、P0-2A invariants、P0-3 pipeline、predicate registry、linker integration set | Registry Ticket + Tenant 真实纵切面、canonical IR、validated Pipeline handoff | PASS（18/18） | Registry Contract、workspace input loader、IR builder/validator 或 Pipeline semantic stage 变化时失效。 |
| 同上 | 本地 canonical revision、validated IR、semantic contract IR、linker、test-impact contract set | input/semantic revision、validated boundary、Linker test ownership | PASS（37/37） | revision canonical payload、validator、test-impact contract 或对应 source ownership 变化时失效。 |
| 同上 | 本地 semantic projections、semantic core vertical、semantic pipeline set | Linker 输出继续进入既有 canonical IR / Pipeline / derived projection；无第二 authoritative graph | PASS（6/6） | IR append、Pipeline semantic context 或 Projection derivation 变化时失效。 |
| 同上及 `f8a4d14787e94cb8ff7ae04170833c295e2bf13f` | 本地 `typecheck`、`docs:doctor`、changed-only imports、`git diff --check`；Linker + Pipeline + Workspace focused set | 类型、authority docs、imports 与 imports 排序 delta | PASS（focused 7/7） | 类型/import/doc authority 或相应 focused seam 再次变化时只重跑对应 Gate。 |
| `0da5ba11eb93a285c5a997d98f7d3705e8a97251` | 本地 `bun test tests/unit/workspace-semantic-linker.test.ts tests/integration/semantic-contract.test.ts --timeout 180000`、`typecheck`、changed-only `imports:check` | exact duplicate 去重、contract/import 顺序、cross-contract state field、diagnostic 顺序、qualified ownership `SEMANTIC-LINK-005` handoff | PASS（10/10；typecheck/imports PASS） | Linker、local normalization/ownership consistency 或 import canonicalization 变化时失效。 |
| 同上 | 本地 `reference:refresh` 后 `reference:check` | reference full compile、Next build、unit、Playwright、tracked diff 与 untracked scan | PASS（refresh 62.1s；check 56.6s；changed paths 0） | reference input、Registry Contract、Pipeline/Lock、artifact/provenance producer 或 runtime toolchain 变化时失效。 |

P0-4 改变 Contract/Registry semantic input、canonical IR append/revision 与 Predicate Registry，因此对应 focused、Pipeline vertical 和 reference evidence 已在以上 head 上替代。未改变依赖版本/锁、benchmark、dependency warmup、slow implementation/fixtures、test runner 或 CI contract；继续复用 P0-2A/P0-3 的 full-fast、all-slow-risk、benchmark、budget 与 runtime boundary 证据，不重复全量矩阵，也未运行 GitHub Actions。`0da5ba1` 之后仅允许 completion ledger / roadmap closeout 文档 delta；该 delta 只使 `docs:doctor` 与 patch hygiene 需要在最终文档 commit 上重跑。

### 2026-07-12 P0-5 IR-owned Generator / Ticket Enforcement delta evidence

Implementation head `29026398d0b25a6c33572429e0cbd7179ec53d12`，base `e39a55ffe1fc262bcf8edd123c4b175acc64e3af`。`5d407675b12534ff87773c69bcd168576233468f` 是加入 reference transaction determinism 修复前的同一实现提交；下表保留其已完成且未被最终 delta 失效的测试证据，并用最终 head 的 transaction/reference 哨兵覆盖本次实际变化面。

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `5d407675b12534ff87773c69bcd168576233468f` | 本地 IR / Generator Plan / Provenance / Pipeline / Ticket runtime focused set | per-kind Generator declaration、IR Entity/Facts、validated snapshot-only plan、Lowerer/Provenance execution binding、forbidden Ticket transition | PASS（10/10） | Generator schema、IR builder/plan/lowerer、semantic provenance 或 Ticket runtime contract 变化时失效；最终 transaction identity delta 由下方 7/7 哨兵覆盖。 |
| 同上 | 本地 workspace semantic spine / Predicate Registry / version overlay focused set | workspace input ownership、canonical Fact/selector、root 与 `0.1.1` Ticket enforcement | PASS（14/14） | workspace IR loader、Predicate Signature、Registry overlay 或 Ticket status table 变化时失效。 |
| 同上 | 本地 affected Gate 与 Windows CRLF contract sentinel | 受影响的 unit / integration / e2e / contract 选择集 | PASS（affected 首轮 112/113；唯一 LF 硬编码失败修复后 sentinel 1/1，因此组合覆盖 113/113） | 不能把组合证据表述为一次 113/113 重跑；测试选择器、受影响实现或 Windows EOL contract 再变化时只重跑对应 delta。 |
| 同上 | 本地 `reference:refresh` | reference full compile、Next build、unit、Playwright、Lock/Provenance/ExplainGraph/Workbench 生成 | PASS（60.44s） | 该结果发现持久化随机 transaction ID 会令下一次 refresh 漂移，因此只证明真实编译链通过，不作为 determinism/clean 证据；最终 clean 证据见下。 |
| `29026398d0b25a6c33572429e0cbd7179ec53d12` | `bun test tests/integration/pipeline-kernel.test.ts tests/integration/semantic-pipeline-spine.test.ts --timeout 180000` | 普通 UUID transaction、reference 命名 transaction 替换、journal lifecycle、transaction-owned semantic artifact binding | PASS（7/7，22.7s） | Pipeline transaction identity/journal、semantic context 或 Lowerer binding 变化时失效。 |
| 同上 | 本地 changed-only `imports:organize` + `imports:check`、`typecheck`、`docs:doctor`、`git diff --check` | 最终类型、imports、authority docs 与 patch hygiene | PASS（imports check 5.16s；typecheck 7.72s；docs doctor 0 errors / 0 warnings，0.25s） | import/type/doc authority 或对应实现再次变化时只重跑相应 Gate。 |
| 同上 | 本地 `reference:check` | 本地真实 refresh + tracked diff + untracked scan | PASS（71.44s；refresh 0；tracked 0；untracked 0；changed paths 0） | reference input、Pipeline transaction identity、Lock/Provenance producer、runtime toolchain 或受管 reference artifact 变化时失效。 |

最终 reference 检查前的一次 `reference:refresh` 外层进程在 61.5s 达到执行器硬超时；其中 Next build、unit、Playwright 已通过且本地 journal 随后显示 transaction succeeded，但该次非零外层结果没有计入 PASS。提高命令时限后只重跑最终 `reference:check`，其完整 refresh 与 drift scan 均成功。P0-5 未运行 full-fast、all-slow matrix 或 GitHub Actions；继续复用上方仍有效的 P0-2A 至 P0-4 昂贵 baseline，并以本节 delta evidence 完成当前实现面验证。

### 2026-07-12 P0-6 Semantic Projection Takeover delta evidence

Implementation head `90818829582b5ec10d8c88fb06cc2921d511d5f1`，base `35170da6bf37111d2bad6eb7fde841aaaaefa875`；`1f18ce340630c93a3cce88736235c84d531050bd` 只包含 changed-only import organizer 的机械排序。下表将实现提交前封存的 focused evidence 与实现提交后的 import/type delta evidence组合使用，不把旧结果伪装为 import commit 的 exact-head 全量结果。

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `90818829582b5ec10d8c88fb06cc2921d511d5f1` 对应实现树 | 本地 canonical projector focused set | Architecture / Scenario / State projector、canonical Fact direction/value/reference、deterministic deep-frozen `SemanticViewSet` | PASS（18/18，63.27s） | Projector、Fact identity、View ordering/freezing、Assertion summary 或 Projection type seam 变化时失效。 |
| 同上 | 本地 Pipeline + consumer vertical | Pipeline Context / Lock 同 revision handoff、ExplainGraph / ReviewSummary / Workbench 统一 consumer | PASS（4/4，74.05s；其中 consumer vertical 55.907s） | Pipeline semantic context、Lock projection ownership或三个 consumer producer 变化时失效。 |
| 同上 | 本地 ExplainGraph compatibility focused set | governance graph compatibility、semantic node/edge/value projection、artifact writes | PASS（5/5，7.69s） | ExplainGraph schema/builder、governance overlay 或 graph artifact producer 变化时失效。 |
| 同上 | 本地 validated Boundary type sentinel | Projector / Inspector / overlay 只接受 `ValidatedEngineeringIRSnapshot` | PASS（1/1，约 1.07s） | validated brand、Projector/Inspector/overlay signature 变化时失效。 |
| 同上及 `1f18ce340630c93a3cce88736235c84d531050bd` | `tests/unit/semantic-state-projection.test.ts`、`tests/unit/semantic-view-artifact-contract.test.ts`、`tests/contract/test-architecture.test.ts` | 同端点不同 `by` transition Fact identity、State inferred badge、malformed/stale revision hard fail、artifact upload fail-closed、Workbench canonical Fact rows、compiler facade | PASS（State 1/1；semantic artifact 5/5；architecture contract 7/7） | State edge identity/badge、SemanticView runtime shape/revision、artifact selection/upload group、Workbench semantic rows 或 compiler facade 变化时失效。 |
| `1f18ce340630c93a3cce88736235c84d531050bd` | `SEC_IMPORTS_CHANGED_ONLY=1`、`SEC_CHANGED_BASE=35170da6bf37111d2bad6eb7fde841aaaaefa875`、`imports:organize` + `imports:check`；`typecheck`；`git diff --check` | P0-6 changed TypeScript files、最终类型面与 patch hygiene | PASS（imports check 6.2s；typecheck 7.4s） | import/type contract 或对应源码再次变化时只重跑相应 Gate。 |
| `79a679e9d7d32f417bc5558683b29deb109e4d1b` | 本地 `reference:refresh` 后 exact-head `reference:check` | reference full compile、Next build、unit、Playwright、SemanticView Lock/ExplainGraph/Review/Workbench artifacts、tracked diff 与 untracked scan | PASS（refresh 56.2s；check 56.4s；tracked 0；untracked 0；changed paths 0） | reference input、Projection/Pipeline revision contract、emit/artifact producer、Workbench template 或 runtime toolchain 变化时失效。 |

提交前第一次 changed-only import probe 因工具只计算 `base..HEAD`，在变更尚未提交时输出 `No TypeScript import targets selected`，因此不计为 PASS；只有上表基于真实 commit 的 organizer/check 结果有效。第一次 reference refresh 的 Next build、unit、Playwright 已通过，但 Workbench EJS 在语义表格改为预计算后仍引用未绑定的 `semanticViewSet`，最终以非零退出，不计为 PASS；恢复该只读 bundle 绑定后，第二次 refresh 与随后 exact-head check 均完整通过。P0-6 未运行 full-fast、all-slow matrix 或 GitHub Actions；本 delta 未改变依赖锁、slow implementation/toolchain、benchmark、dependency warmup、test runner 或 selector contract，继续复用前述仍有效的昂贵 baseline。

### 2026-07-12 P0-7 Verification / CI Closure development evidence

Implementation head `b00415b`，base `a3025aca63c6c365e2561b415ddfe07dc8a61141`。P0-7 修改 selector、Contract Freeze、slow suite registry、CI runner/workflow 与 verification revision，因此历史 full-fast、test-budget、all-slow-risk 和 `ci-verification-v2` status 全部失效；P0-6 semantic/reference evidence 只作为未修改 artifact producer 的 baseline，不替代最终 `ci-verification-v3` Full。

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `b00415b` 对应实现树 | Contract/ownership/CI focused set | contractId、四类 source classification、explicit owner/pass/contract ownership、Risk selection、workflow YAML structure | PASS（36/36，19.2s） | Contract Freeze、impact/ownership、suite registry、CI plan/workflow 变化时失效。 |
| 同上 | `bun run test:contract-freeze` | 12 个注册文件整文件运行；无 title regex | PASS（74/74，4.5s） | contractId/target file 或 contract test 内容变化时失效。 |
| 同上 | Ticket semantic vertical + Pipeline sentinels | validated snapshot、Workspace Semantic Link、Generator、runtime enforcement、projection shared Fact ID、provenance | PASS（5/5，32.2s） | Ticket/Tenant Contract、IR/Linker/Lowerer/runtime/projection/provenance seam 变化时失效。 |
| 同上 | runner/CI command/architecture/project focused set | canonical affected runner、suite expansion、package/contract wiring | PASS（50/50，6.0s） | test runner、package scripts、CI command contract 或 project runtime wiring 变化时失效。 |
| 同上 | changed-only imports、`typecheck`、`docs:doctor`、`git diff --check` | import/type/doc/patch hygiene | PASS（imports 4.8s；typecheck 10.8s；docs doctor 0 errors / 0 warnings） | 最终文档 closeout 只需重跑 docs doctor 与 patch hygiene；TypeScript 变化则重跑 imports/typecheck。 |

P0-7 原计划以 `sec-verification/full/ci-verification-v3/base-<current-base>` hosted status 作为最终证据载体；本次收口经用户明确授权改用本地组合证据，不再触发新的 GitHub Actions。替代证据仍必须覆盖 `quick / risk / full`，记录 exact tested head、PR base、contract revision、每个 Gate 的 scope/result/duration，并证明 intervening diff 没有使复用结果失效；不得把一次局部 PASS 伪装为完整 Full。

### P0-7 增量复用与本地批量收口账本

昂贵验证不得因只修改一个已定位的 test fixture 而从第一个 Gate 重新开始。A0 必须按 `contract revision + base + tested head + Gate + scope + result + invalidation` 记录前次结果，并以“最近有效 baseline + intervening diff impact + delta batch”组合当前证据。只有 Gate 输入、runner command/environment、selector/registry contract 或被覆盖语义发生变化时，已有 PASS 才失效。

本地 slow resume 使用显式 suite batch：

```text
bun scripts/ci-pr-risk.ts --suite <suite-a> --suite <suite-b> ... --continue-on-failure
```

`--suite`（同时接受 `--suite <id>` / `--suite=<id>`）只运行账本中尚未覆盖或被 delta 失效的 suite；requested batch 必须从 clean tracked HEAD 启动并在结束时再次检查 clean。`--continue-on-failure` 只允许用于显式 suite batch，保证一次批次收集全部失败，并把 resolved head/base SHA、suite code/duration 和最终状态写入 `.tmp/ci-risk-batch-evidence.json` / `SEC_CI_RISK_SUMMARY`。默认 PR Risk / Full 仍保持 fail-fast；mutating workspace chain 永远不得 continue-on-failure。

| Evidence | Head / base | 已证明且可复用 | Blocker / 失效边界 |
| --- | --- | --- | --- |
| Hosted run `29199433617` | `53f8740` / `a3025ac` | imports、typecheck、docs、affected | full-fast 的旧 ExplainGraph fixture 缺 canonical `semanticViews`；后续 Gate 未运行。 |
| Hosted run `29199912439` | `0550cb4` / `a3025ac` | 上述 Quick、full-fast 329/329、test-budget、Contract Freeze 74/74 | all-slow 在 `e2e-graph` 暴露 canonical node `references` 断言漂移；后续 slow/workspace 未运行。 |
| Hosted run `29200319653` | `e372263` / `a3025ac` | Quick、full-fast 329/329、test-budget、Contract Freeze；12 个 parallel-safe standard slow suites（compiler-smoke、dry-run-plan、expanded-blocks、graph、lanes、policy、repair、runtime-host、summary、upgrade、verify-lock、workspace） | 第一个 serial suite `e2e-pipeline-end-to-end` 仍期待 legacy slot ID；其后 serial/runtime-heavy suites 与 Full tail 未运行。 |

`e372263` 之后的 graph test delta 不修改 production graph、SemanticView、runner command/environment 或上述已通过 slow suites 的输入，因此不得重跑 full-fast、test-budget、Contract Freeze 和已通过的 12 个 slow suites。收口只需：graph identity 风险簇、账本中剩余 slow suites 的一次 continue-on-failure 本地 batch、随后 benchmark/deps/ordered workspace Full tail。用户明确授权本轮使用本地环境完成该组合证据，不再触发新的 GitHub Actions；最终 ledger 必须记录本地 exact head/base、命令、duration、结果与失效规则。

### 2026-07-12 P0-7 本地组合 Full closeout

PR base 固定为 `a3025aca63c6c365e2561b415ddfe07dc8a61141`，contract revision 为 `ci-verification-v3`。以下结果与 hosted baseline 组合后覆盖 Quick、Risk、Full 全部 Gate；未重复运行已有有效 PASS。

| Tested head | Evidence | Gate / scope | Result | 复用与失效规则 |
| --- | --- | --- | --- | --- |
| `3d3d78a` | `bun scripts/ci-pr-risk.ts` 13-suite remaining batch；`.tmp/ci-risk-batch-evidence.json` | hosted run 尚未覆盖的 13 个 serial/runtime-heavy slow suites | 10 PASS：pipeline、private-registry、registry、ticket-semantic-vertical、artifacts、conflicts、demo-doctor、explain、local-views、provenance；3 FAIL：pipeline-end-to-end、manifest、prisma-merge；总计 676.287s | 10 个 PASS 只有对应 suite implementation、runner/toolchain 或共享输入变化时失效；三个失败不计通过。 |
| `17c2f39959b370c7176aec301bb7d2a2961f3ce1` | 三项 delta diagnosis batch；`.tmp/ci-risk-delta-batch-evidence.json` | pipeline-end-to-end、manifest、prisma-merge 精确根因 | 三项均 FAIL，总计 141.413s；前两项定位为 canonical port 缺 legacy pin compatibility projection，Prisma 定位为 Windows schema engine 在 SQLite 文件缺失时空详情失败 | 仅作为诊断证据，不计 Gate PASS；修复后只允许重跑这三个 suite。 |
| `84f00a79aeecd8c18eff394d2ce60f968d9bfee0` / delta base `17c2f39` | `bun scripts/ci-pr-risk.ts --suite e2e-pipeline-end-to-end --suite e2e-manifest --suite e2e-prisma-merge --continue-on-failure`；`.tmp/ci-risk-batch-evidence.json` | 唯一一次三项风险簇 closure batch；canonical port → legacy pin alias/reference；SQLite pre-create + 原 Prisma 6 db push | PASS（pipeline-end-to-end 1/1，41.567s；manifest 3/3，91.228s；prisma-merge 1/1，73.825s；总计 206.620s；tracked tree clean） | ExplainGraph compatibility projection/reference、Prisma merge/runner/schema engine 或三项测试输入变化时失效。结合 hosted 12 项与前批 10 项，25/25 slow suites 均有有效 PASS。 |
| `84f00a79aeecd8c18eff394d2ce60f968d9bfee0` / PR base `a3025ac` | `typecheck`；benchmark suite；deps warmup；ordered `resolve → compose → adapt → verify --lane all → lock → explain` | TypeScript delta、benchmark/dependency contract、完整 mutating workspace Full tail | PASS（typecheck 6.0s；benchmark 1.6s；deps 1.5s；resolve 6.5s；compose 2.9s；adapt 1.6s；verify-all 50.1s；lock 1.7s；explain 2.1s） | TypeScript、benchmark/dependency environment、workspace pass implementation/input 或 runtime toolchain 变化时失效；workspace chain 串行 fail-fast。 |
| `8aeb1f47343d59c585a94a43c536bbb455b67692` / parent `84f00a7` | `bun run sec -- reference check --json --compact` | reference refresh、tracked diff、untracked scan；22 个 port 的 legacy pin derived artifact refresh | PASS（49.6s；refresh 0；tracked 0；untracked 0；changed paths 0） | ExplainGraph/Workbench producer、reference input 或 runtime toolchain 变化时失效。首次 check 在 refresh 成功后准确报告 6 个受管派生文件 drift；审查确认只新增 22 pin nodes + 22 compatibility edges、无删除且 references 与 port 一致，提交 refresh 后只重跑该 Gate。 |

最终组合覆盖为：hosted Quick + full-fast 329/329 + test-budget + Contract Freeze 74/74；hosted 12 slow PASS；本地复用 10 slow PASS；exact delta 3 slow PASS；本地 benchmark/deps/ordered workspace/reference tail PASS。`8aeb1f4` 之后仅允许 evidence ledger / roadmap 文档 closeout；该 docs-only diff 不使上述实现、slow、workspace 或 reference 证据失效。P0-7 correctness Gate 已闭合。

### 2026-07-13 P0-7 merge / cleanup closeout

| Evidence | Result | 说明 |
| --- | --- | --- |
| PR #93，head `7d49e3179d6a414f361656a16d61906cd2ed4e86`，base `a3025aca63c6c365e2561b415ddfe07dc8a61141` | MERGED；squash commit `9bbdc86ef5b0d110d4ecea9b3ab02b7e2f7ba0a3`；PR head 与 merge commit tree diff 为 0 | `run-full` label 在最终 push 前移除；最终 synchronize check 为 `SKIPPED`，没有执行新的 hosted Full。 |
| 原 `codex/p0-7-verification-ci-closure` branch / worktree / Junction audit | remote branch、local branch、remote-tracking ref 与 `D:\Project\sec-worktrees\verification-ci-closure` 均不存在；37 个 Junction 已按 target 白名单只删除链接 | `D:\Project\sec\node_modules` 清理前后均保留 408 个顶层条目；主工作区用户文档修改未被 pull/reset/覆盖，仅 fetch 新 `origin/main`。 |

至此 P0-7 的实现、组合验证、reference refresh、PR 合并和本地清理均完成。本文与 roadmap 的 post-merge 状态修正是 docs-only，不改变任何已验证 Gate 的输入或失效边界。

### 2026-07-13 P0-7 final invalidation audit

只读 completion audit 发现两处记录强度不足：`e372263` 后的 runner / Contract Freeze 变化需要 final affected/freeze 证据；`84f00a7` 的 ExplainGraph additive compatibility change 需要明确覆盖此前已 PASS 的 graph consumers。为避免重跑 full-fast 或 25-suite 全矩阵，本轮在合并后 tree `77e61876c557ec4cc8fe168fe911f18193c497db` 上按风险簇一次批量补证。

| Tested head / base | Evidence | Result | 关闭的失效边界 |
| --- | --- | --- | --- |
| `77e61876c557ec4cc8fe168fe911f18193c497db` / `e3722632582a2080265edc6b0672b74bbf1ef259` | `SEC_CHANGED_BASE=e372263... bun run test:affected` | PASS（46.8s）；canonical selector 一次执行 auto-reference、pipeline、roadmap-authority、scripts、verification-infrastructure、semantic-contract、ticket-core 等受影响 fast/contract owners | `scripts/ci-pr-risk.ts`、`tests/contract/ci-lanes.test.ts`、ExplainGraph/Prisma helper 与 closeout docs 的 intervening fast impact。changed slow files只作为 Risk notice，不伪装成 Quick coverage。 |
| 同上 | `bun run test:contract-freeze` | PASS（74/74，24.9s） | Contract target/test 内容变化后的完整稳定 `contractId → test file` freeze；不再依赖 hosted `e372263` 的旧 74/74。 |
| 同上 | `SEC_CHANGED_BASE=e372263... bun scripts/ci-pr-risk.ts --suite e2e-graph --suite e2e-artifacts --suite e2e-explain --suite e2e-local-views --continue-on-failure` | PASS（graph 5/5，7.845s；artifacts 1/1，42.423s；explain 1/1，41.071s；local-views 1/1，41.483s；总计 132.825s；tracked tree clean） | canonical port → legacy pin additive change 对 graph artifact、artifact manifest、CLI explain 与 Workbench local views 的完整 consumer 风险簇。原始 evidence：[`docs/evidence/p0-7-final-graph-consumer-batch.json`](evidence/p0-7-final-graph-consumer-batch.json)。 |
| 本 docs-only audit closeout | `bun test tests/integration/project-runtime.test.ts`；`bun run docs:doctor`；`git diff --check` | PASS（roadmap/package contract 29/29；docs 0 errors / 0 warnings；patch hygiene clean） | post-merge roadmap authority、evidence ledger 与 tracked JSON 的最终 contract/doc/patch Gate。 |

本 audit 没有运行 full-fast、全部 slow matrix、workspace chain 或 GitHub Actions。其作用是用 canonical affected + 完整 Contract Freeze + 一个 4-suite slow batch 精确补齐账本自身的失效规则；此前 25-suite 组合 Full、workspace/reference tail 与 PR merge 证据继续有效。

### 2026-07-13 v0.3 exit review evidence composition

最终组合记录 `v0.3-exit-07290cc` 绑定初始审查 baseline `d31a627ff6c41fe14202dd229e4b56aba002e42e`、最终 integration head `07290ccda640db5e285f1d4e198b2721e6d88a8c`、P0-7 PR base `a3025aca63c6c365e2561b415ddfe07dc8a61141` 与 contract revision `ci-verification-v3`。它复用下列 evidence units，不声称在最终 head 上执行过单次 hosted 或 single-run Full。表中的 `p0-7-*` 名称是 legacy ledger aliases；`v0-3-semantic-frontend-87a0a9e` 是首个 versioned machine-readable unit，最终 docs-only Gate 则由 `v0-3-exit-docs` 持有。

| Evidence ID / legacy alias | Tested state / evidence | 覆盖 | Intervening diff 与复用裁决 |
| --- | --- | --- | --- |
| `p0-7-hosted-core-e372263`（legacy） | hosted `e372263` / base `a3025ac` | Quick、full-fast 329/329、test-budget、旧 Contract Freeze、12 个 standard slow suites | runner / Freeze 与 ExplainGraph compatibility 后续变化使其中部分结果失效；未受影响的 full-fast、budget 与 12 slow 继续复用 |
| `p0-7-local-remaining-3d3d78a`（legacy） | 本地 13-suite batch | hosted 未覆盖的 slow 风险簇；10 PASS / 3 FAIL | 10 个 PASS 复用；3 个失败只由下一项 delta closure 替代，不把失败计入覆盖 |
| `p0-7-delta-closure-84f00a7`（legacy） | 本地 3-suite closure + benchmark / deps / ordered workspace | pipeline-end-to-end、manifest、prisma-merge 与 Full mutating tail | 3 slow 全部 PASS；后续 ExplainGraph additive change 只使 graph consumers 需要 bounded 重验 |
| `p0-7-reference-8aeb1f4`（legacy） | 本地 reference check | reference refresh、tracked/untracked drift、derived port → pin artifacts | `8aeb1f4..d31a627` 未改变 reference input、artifact producer 或 runtime toolchain，继续复用 |
| `p0-7-final-invalidation-77e618`（legacy） | 本地 canonical affected、Contract Freeze、4-suite graph consumer batch；原始 JSON `docs/evidence/p0-7-final-graph-consumer-batch.json` | affected 46.8s、Freeze 74/74 24.9s、graph/artifacts/explain/local-views 8/8 tests 132.825s | 关闭 `e372263` 后 runner/Freeze 与 `84f00a7` ExplainGraph consumer 的全部已知失效边界 |
| `v0-3-semantic-frontend-87a0a9e` | 本地 code head `87a0a9ea496c9b6186f165455c11fec4f34fea7d` / base `d31a627`；[`docs/evidence/v0-3-semantic-frontend-verification.json`](evidence/v0-3-semantic-frontend-verification.json) | imports、typecheck、27-file canonical affected、Contract Freeze 74/74、6-suite semantic frontend 风险 batch、workspace-fast、reference-check | template sandbox/frontend/context 旁路修复的 exact delta closure；全部 exit code 0，tracked tree clean，reference changed paths 0。该初始 versioned unit 的 per-gate started/finished timestamps 均 unavailable；除 slow-risk-batch 外的 raw evidence/digest 也 unavailable，不追溯伪造 |
| `v0-3-exit-docs` | `docs/evidence/v0-3-exit-docs-verification.json` 持有 exact docs head/base/tree 与 changed-path digest | `bun test tests/integration/project-runtime.test.ts`；`bun run docs:doctor`；`git diff --check` | 最终两份 Markdown 的 working-tree content 一次批量验证后原样提交；JSON 持有 exact docs commit、每个 Gate 的 `gateId`、exact `argv`、exit code、timestamps、duration、clean-state、invalidation 与 gaps；后续 evidence-only commit 不改变被测 Markdown |

冻结审查在 `d31a627` 发现 `validateResolvedTemplates()` 独立重复 `load → validate → plan → views → context`，因此此前组合不能直接给出 v0.3 exit PASS。PR #96 把 Pipeline 与非权威 template sandbox 统一到 `buildWorkspaceSemanticBundle()`，并让 sandbox 复用 `createPipelineSemanticContext()`；测试影响 ownership 与 architecture sentinel 同批进入。风险批次一次覆盖 graph、pipeline、pipeline-end-to-end、registry、Ticket semantic vertical 与 local views，原始 JSON SHA256 为 `96c07f1d2b934a29cadadfbb9f8908dc89925445960e7601da79cc68cd6de82b`。

PR #96 的第二个 commit `3649ac63e11bc6f336bf69d48e33f9810ec0996a` 只新增上述两份 evidence JSON，没有修改 production、tests、selector、runner、workspace/reference input 或 artifact producer，因此不使 code head `87a0a9e` 的结果失效。PR head 与 squash merge `07290ccda640db5e285f1d4e198b2721e6d88a8c` tree 一致；PR 已 MERGED，未触发 GitHub Actions。

`77e618..d31a627` 的 docs/evidence-only 变化继续保留此前 P0-7 baseline；`d31a627..07290cc` 对 Semantic Frontend 的失效边界则由 versioned delta evidence 完整补齐。PR #96 merge 后，最终 exit-review Markdown 再由独立 exact docs commit 的 roadmap contract、docs doctor 与 patch hygiene Gate 关闭 publication gap；其 evidence-only 后继提交不得修改被测 Markdown。两项持久 evidence 共同确认当前 integration state 的 Quick / Risk / Full correctness 组合覆盖完整，`remainingGaps = []`。

v0.3 exit review 的 Ticket 母例继续由 `e2e-ticket-semantic-vertical` 持有。它在 legacy 25-suite composition 与 PR #96 的 6-suite delta batch 中均 PASS，覆盖 canonical frontend、Workspace Semantic Link、validated IR、IR-owned generator、生成的 `NEXT_TICKET_STATUS`、runtime enforcement、canonical projection 与 Artifact Provenance。exit-review 文档只运行一次 roadmap contract + docs doctor + patch hygiene 风险批次，不触发 full-fast、slow matrix、workspace chain、reference 或 GitHub Actions。
