# 工程编译器实施计划与路线图

> 说明：沿用原文件名，但本稿已从“MVP 排期”扩展为连续路线图。它既给开发者看，也给 AI/Agent 看，用于决定从当前到终局的阶段推进顺序。
>
> 权威边界：本文只决定阶段目标、里程碑、优先级和进入/退出条件，不直接定义 schema 或实现协议。

## 路线总原则

- 永远优先证明“规格 -> 装配 -> slot -> 验收 -> 来源追踪”主链，而不是追逐更多功能点。
- 每个阶段都必须同时回答五个问题：
  - 新增了什么上游输入
  - 新增了什么编译能力
  - 新增了什么验证能力
  - 新增了什么团队协作能力
  - 新增了什么 AI 可自主承担的职责
- 每个阶段都有明确退出条件；未达成退出条件前，不跨阶段扩范围。
- 当前策略从“功能面扩张”切换为“收敛型高速开发”。
- 默认优先级从高到低：
  - 可演示闭环。
  - 稳定 CLI 入门路径。
  - JSON / artifact / graph contract。
  - E2E 验收矩阵。
  - dogfood 真实样例。
  - benchmark / 性能预算。
  - 复杂度压缩和删除无效代码。
  - 新功能扩展。
- 每轮新增功能后必须检查：
  - 是否形成用户可运行路径。
  - 是否进入稳定 contract。
  - 是否有端到端链路信号。
  - 是否需要删除或合并重复概念。
  - 是否提升每日可演示版本质量。

## 当前进度清单（持续维护）

> 本节是当前开发进度的正式记录区。长期阶段顺序仍以本文后续阶段 A-K 为准；每轮开发完成后，应优先更新这里的状态、下一步和阻塞项，避免进度只散落在聊天、任务列表或 git log 中。

### 状态图例

- `done`：已在代码中实现，并有定向验证或主链路验证覆盖。
- `active`：当前优先推进方向，允许被拆成多个小提交。
- `next`：完成 active 后的默认下一批功能切口。
- `later`：已预留但暂不进入当前开发循环。
- `blocked`：需要外部凭据、破坏性操作授权或明确产品决策。

### 当前阶段判断

| 阶段 | 状态 | 依据 |
| --- | --- | --- |
| 阶段 A：文档与规格冻结 | done | `docs/00-10` 已形成分层规格栈，`00` 定义权威顺序。 |
| 阶段 B：v0.1 首条闭环 | done | `init -> resolve -> compose -> adapt -> verify -> lock -> explain` 已可重复运行，Customer Admin 母例、三块、单槽位和验收链路已落地。 |
| 阶段 C：v0.2 工程可持续化 | active | provenance、explain graph、policy gate、repair、upgrade 已具备基础能力，当前重点是把它们从“可用”推进到“可持续维护”。 |
| 阶段 D：v0.5 团队可用化 | next | 需要在 C 稳定后推进私有 registry、review assist、团队 CI 口径和更完整官方块母库。 |
| 阶段 E：v1 平台化 | later | graph explorer、双视图工作台、policy center 和托管验证仍是后续平台面。 |
| 阶段 F-K：多目标、自维护与长期研究线 | later | 必须等单栈平台、升级周期和 provenance 机制稳定后再进入。 |

### 已完成能力

| 能力面 | 当前状态 | 说明 |
| --- | --- | --- |
| CLI 主链 | done | `init/add/resolve/compose/adapt/verify/repair/upgrade/lock/explain` 已有入口，参数边界已严格化。 |
| 官方块母例 | done | `auth/basic-session`、`tenant/basic-workspace`、`entity/customer-basic` 支撑 Customer Admin 闭环。 |
| 单槽位合成 | done | `customer_normalizer` slot 通过 task envelope 限定写入边界。 |
| fast/runtime verification | done | 默认 verify/PR 跑 fast lane 与 runtime service 级测试；all/full 才跑完整 Next build + Playwright acceptance，并输出结构化 report、verification report CLI inspect、runtime report CLI inspect 与 runtime steps inspect。 |
| acceptance coverage | done | 验收覆盖可映射 block/slot，支持依赖满足判断，并暴露 review summary、CLI explain 和本地视图覆盖摘要。 |
| provenance | done | 安装产物、slot 产物、generated 产物和 override 可进入 `provenance.json`，并暴露 provenance registry CLI、review summary、CLI explain 和本地视图 provenance 摘要。 |
| explain graph | done | graph 包含 block/capability/slot/file/acceptance/pin/policy/override/repair/upgrade 节点、policy target/violation 边、slot 合同升级影响边、repair task/category 归因边、upgrade preflight/verification 归因边，以及 CLI 普通文本 review、只读 graph inspect 与 graph 类型摘要。 |
| review summary | done | 结构化输出 change sources、runtime entries、vertical slices、install impacts、顶层 activity counts、install impact summary、impacted blocks/slots、acceptance coverage、provenance、failure points、regression risks、conflict hints、E2E chain summary，并暴露 review summary CLI、repair、upgrade verification、policy governance 摘要。 |
| repair 基础 | done | verification 失败时可生成 repair plan，并可对 repairable slot 执行受限写回。 |
| upgrade 基础 | done | 支持至少一个官方块升级，包含 migration、override 冲突检测、带 phase 的 planning/apply 阶段阻断诊断、verify、lock/provenance 更新和回滚。 |
| migration 类型 | active | 已支持 `file-replace`、`copy-file`、`copy-directory`、`config-rewrite(set/delete)`、`json-array-append/remove`、`json-object-merge`、`text-append`、`text-replace`、`text-replace-regex`、`create-directory`、`delete-file`、`delete-directory`、`rename-file`、`rename-directory` 与 `slot-contract-update` 计划迁移；执行型迁移类型继续扩展。 |
| policy gate | done | 支持 official/project policy merge、递归 YAML 加载、安装目标定位、violation report、policy report CLI、review summary、CLI explain 和本地视图治理摘要。 |
| 本地治理产物 | done | `generated/**`、`provenance.json`、`graph.lock.json`、contract artifact 摘要和带导航的本地 HTML 视图是当前稳定治理产物集合。 |
| 开发者工具入口 | done | `doctor` 与 `deps status/warmup/relink/clean` 成为依赖环境的正式入口，普通项目开发者默认不直接修改平台源码。 |

### 开发者入口与依赖环境策略

- 平台源码本身是工具实现层，普通项目开发者默认不直接修改 `platform/compiler/**`、`platform/shared/**`、`platform/registry/official/**`。
- 最终成品必须提供对外开发环境：CLI 是最低可用入口，Workbench/IDE 插件是产品化入口；两者都写入同一套 workspace 合同，而不是要求开发者打开平台源码目录操作。
- 项目开发者的默认工作面是 `project/app.plan.yaml`、`project/custom/**`、`project/overrides/**`、`project/policies/**` 与 MVP 临时私有 registry 入口 `platform/registry/private/**`。
- `platform/registry/private/**` 只是当前单仓 MVP 阶段的 workspace 私有块存放点；长期应迁移为独立私有 registry 包、私有 registry 服务或工作台托管资产，避免让普通开发者把 `platform/` 误认为日常源码工作区。
- `project/src/installed/**`、`project/generated/**` 和运行时 scaffold 视为编译产物或治理产物；需要人工介入时优先回写为 slot、rule-backed override 或 private block，而不是长期手改生成源码。
- CLI 是一等入口；工作台或 IDE 插件只能补充交互体验，不替代 CLI 合同。
- Workbench/IDE 插件必须遵守同一边界：可读 plan、private block manifest、override、policy、generated governance artifact、provenance 和 graph lock；可写 `project/app.plan.yaml`、`project/custom/**`、`project/overrides/**`、`project/policies/**` 与 MVP 临时私有 registry；禁止直接写 compiler internals、shared utilities、official registry、generated scaffold 和依赖目录。
- Workbench/IDE 插件至少要复用 `doctor`、`deps status`、`add`、`resolve`、`compose`、`adapt`、`verify`、`repair`、`upgrade --dry-run`、`lock`、`explain` 这些命令入口，而不是旁路实现另一套规则。
- `platform doctor` 用于检查本地依赖环境、缓存状态和推荐动作。
- `platform deps status` 输出 root/shared/project/npm cache 的状态、元数据大小、顶层条目数量、链接关系和 cold/warm/dirty/stale 模式；为保证每次检查足够快，禁止递归扫描 `node_modules` 计算真实总字节数。
- `platform deps status --json [--compact]` 输出稳定依赖环境合同，供 CI、Workbench 和 IDE 插件直接消费。
- `platform deps warmup` 预热 `.shared-deps`，作为 generated project runtime 的共享实体依赖层。
- `platform deps warmup --json [--compact]` 输出预热后的依赖环境合同。
- `platform deps relink project` 让 `project/node_modules` 优先回到指向 `.shared-deps/node_modules` 的 junction，减少实体依赖副本；当前 relink 目标只支持 `project`，未来如需扩展目标必须保持命令参数向后兼容。
- `platform deps relink project --json [--compact]` 输出 relink 后的依赖环境合同。
- `platform deps clean --project|--shared|--npm-cache` 提供单层受控清理入口，避免开发者手动删除内部目录后破坏 stamp 状态。
- `platform deps clean --all --force` 才能清理全部依赖层；这是刻意的强制确认口径，因为它会导致下一次 runtime verification 重新预热依赖。
- 本地推荐依赖布局是保留根 `node_modules` 给 compiler 自身使用，保留 `.shared-deps/node_modules` 给 generated project runtime 使用，`project/node_modules` 默认只作为链接。
- CI 推荐 PR/push 继续跑 fast lane，schedule/manual 跑 all lane；远程缓存优先覆盖 Bun cache、`.shared-deps`、`project/.next/cache` 和 Playwright browser cache，不缓存 `project/node_modules` 实体副本。
- 本地无参数 `platform verify` 默认跑 fast lane，`platform verify --json [--compact]` 可直接输出本次 verification report：
  - 运行 compiler typecheck、generated fast unit/acceptance、policy gate。
  - 运行 generated runtime service/unit 测试。
  - 不运行 Next build。
  - 不安装或启动 Playwright browser。
- `platform verify --lane runtime` 跑 generated runtime service/unit 测试，不运行完整浏览器验收。
- `platform verify --lane all` 才运行完整 runtime：
  - Next build。
  - runtime unit。
  - Playwright acceptance。
  - Playwright acceptance 串行执行。
  - 每个 workspace 派生独立 `TEST_PORT`。
  - 避免同一内存 runtime store 被多 spec 并发污染。
  - 避免同进程连续验证复用旧 workspace dev server。

### 当前 active 工作包

1. **产品收敛与发布闭环**
   - 状态：active。
   - 目标：从高强度功能扩张切到可发布、可演示、可验证的成熟推进。
   - 优先切口：
     - CLI 入门 demo 路径：done。
       - `npm run demo:quickstart`：重置样例项目并刷新主链治理产物。
       - `npm run demo:governance`：在 quickstart 后列出 governance artifact 上传清单。
       - `npm run demo:closed-loop`：运行 quickstart -> verify --lane all -> governance artifact paths -> explain --json --compact。
       - `npm run reference:refresh`：保留为不重置项目的主链刷新入口。
     - CLI usage 暴露 closed loop、readiness、governance paths：done。
       - `platform doctor --json` 输出结构化 readiness contract。
       - `platform doctor --json --compact` 输出稳定单行 readiness contract。
       - `platform deps status|warmup|relink project --json [--compact]` 输出稳定依赖环境合同。
       - CLI 首屏把 `npm run demo:closed-loop` 固定为唯一主闭环叙事入口。
     - 每日可演示版本清单：done。
       - quickstart 主链可运行。
       - governance artifact 清单可输出。
       - `platform demo checklist [--json --compact]` 可只读检查本地 demo readiness。
       - review summary 能展示 E2E chain summary。
       - explain graph 能展示 policy/pin/override/repair/upgrade 归因。
     - E2E 验收矩阵：done。
       - `platform explain --json` 输出 `e2eMatrix`。
       - `platform review matrix [--json --compact]` 只读输出最新 E2E matrix。
       - 矩阵行复用 verification、coverage、artifacts、review 四个 chain stage。
       - evidence 从现有 review summary 派生，不新增执行流程。
       - `generated/views/source-view.html` 与 `generated/views/slot-rule-view.html` 复用同一 evidence helper 展示 E2E Chain Summary 证据列。
     - JSON contract 冻结清单：done。
       - `platform artifacts --paths --kind contract` 输出可上传 contract 清单。
       - `platform artifacts --paths --json --kind contract` 输出结构化 contract 清单。
       - `platform artifacts --paths --json --compact --kind governance|view|test|contract` 输出稳定单行上传路径合同。
       - `platform artifacts manifest [--json --compact]` 可只读检查最新 `generated/ci-artifacts.json`，不重新生成 artifact manifest。
       - contract 清单从 `generated/*-contract.json` 和 artifact summary 派生，并进入 artifact manifest / review summary 的 contract upload group。
     - artifact / graph / review golden output：active。
       - `platform explain --json --compact` 输出稳定单行 JSON 合同。
       - `platform explain` 普通文本输出 artifact upload group count 与 missing reason type count。
       - E2E artifacts evidence 输出 artifact upload group count、missing reason type count 与 per-stage evidenceCount。
       - `platform review summary --json [--compact]` 输出稳定 top-level activity counts、provenance generated artifact count 与 provenance origin/override/registry summary counts。
       - repair summary JSON 输出稳定 targetFileCount 与 targetFiles。
       - `platform review summary` 普通文本输出 artifact upload group count 与 missing reason type count。
       - `platform artifacts --json --compact` 输出稳定单行 artifact manifest。
       - `platform artifacts manifest --json --compact` 只读输出最新 artifact manifest 单行合同。
       - `platform install manifest --json --compact` 只读输出最新 install manifest 单行合同。
       - `platform blocks usage --json --compact` 只读输出最新 block usage map 单行合同。
       - `platform repair plan --json --compact` 只读输出最新 repair plan 单行合同。
       - `platform postgres contract --json --compact` 只读输出最新 Postgres contract 单行合同。
       - `platform lock inspect --json --compact` 只读输出最新 graph lock 单行合同。
       - `platform doctor --json [--compact]` 输出稳定环境 readiness 合同，包含顶层 checkCount 与 checks。
       - `platform contract ci --json [--compact]` 输出稳定 CI 命令合同，包含 review matrix/demo checklist diagnostic steps、每个 step 的 producesCount 与 produces。
       - graph/review/artifact 不新增快照文件，优先以 CLI JSON 合同断言冻结。
     - dogfood 样例工作区：active。
       - `npm run dogfood:reference` 刷新当前参考工作区。
       - `npm run dogfood:governance` 输出结构化治理 artifact 路径合同。
       - dogfood 入口复用 `reference:refresh`，不复制第二套样例流程。
     - benchmark 与慢测预算：active。
       - `platform test budget` 作为正式 fast/runtime/all lane 慢测边界合同入口。
       - `platform test budget --json [--compact]` 输出稳定慢测预算合同，包含顶层 inspect command、runner command、laneCount、slowLaneCount 与 slowLaneIds。
       - `npm run test:budget` 复用正式 CLI 输出 slow-test budget JSON 合同。
       - `platform benchmark suite` 作为正式 benchmark/task-suite 合同入口。
       - `platform benchmark suite --json [--compact]` 输出稳定 benchmark/task-suite 合同，包含顶层 inspect command、runner command、artifactPathCount、artifactPaths、每个 task 的 artifactPathCount/scoreFocusCount、scoreDimensionCount 与评分维度。
       - `platform benchmark suite` 文本 inspect 输出同步列出聚合 artifact paths，避免人工审查只看到计数。
       - `npm run test:benchmark-contract` 复用正式 CLI 输出最小 benchmark/task-suite JSON 合同。
       - fast/runtime 不运行 Next build 或 Playwright。
       - all lane 才允许 Next build、Playwright install 和 browser acceptance。
     - reference 无漂移 gate：done。
       - `platform reference check` 作为正式 CLI 入口。
       - `platform reference check --json [--compact]` 输出稳定 reference drift 合同，包含顶层 inspect command、runner command 与 refresh/diff 复现命令。
       - `npm run reference:check` 复用正式 CLI 入口。
       - gate 通过 `reference:refresh` 刷新后运行 `git diff --name-only --exit-code -- project`。
       - 失败时直接暴露 reference workspace 与编译主链的不一致。
     - 重复概念删除和命名收敛：active。
       - `platform`：原始 CLI 操作入口。
       - `reference`：不重置的主链刷新入口。
       - `demo`：面向用户演示的重置/打包入口。
       - `dogfood`：针对当前参考项目的自用验证入口。
       - `test`：开发验证和预算合同入口。
     - 收敛整改总表：active。
       - P0：固定唯一主闭环，统一对外叙事到 quickstart -> verify --lane all -> artifacts -> explain。
       - P0：冻结治理 contract 清单，覆盖 graph.lock、provenance、verification/runtime/policy/coverage、explain-graph、review-summary。
         - `project/graph.lock.json`
         - `project/provenance.json`
         - `project/generated/verification-report.json`
         - `project/generated/runtime-report.json`
         - `project/generated/policy-report.json`
         - `project/generated/acceptance-coverage.json`
         - `project/generated/explain-graph.json`
         - `project/generated/review-summary.json`
       - P0：建立 benchmark/task-suite 最小合同，已通过 `platform benchmark suite --json [--compact]` 冻结任务集、顶层 runner command、聚合 artifact paths 与评分维度，再扩 runner。
       - P0：把 AI slot 文档协议与现有 TaskEnvelope/repair/provenance 代码字段逐项对齐：active。
        - TaskEnvelope `sourceSlot` 已回显 lock 中 slot 状态、writable zones 与 provenance hints。
        - repair plan review 已回显同一 envelope 写入边界与 source provenance，供 dry-run JSON 审查。
       - P1：增加 reference workspace 无漂移 gate，证明 checked-in `project/` 与主链刷新结果一致。
       - P1：补测试分层地图，区分 fast/runtime/all、contract freeze、reference drift、benchmark。
         - fast：默认本地 verify 与定向命名测试；禁止 Next build、Playwright install、浏览器 acceptance。
         - runtime：只给运行时/服务链路定向验证使用；仍禁止完整浏览器链路。
         - all：仅用于 demo/release/full-runtime gate，允许 Next build、Playwright install、browser acceptance。
         - contract freeze：优先用脚本/CLI JSON 合同与元数据断言，不新增大快照。
         - `platform contract freeze --json [--compact]` 输出稳定 contract-freeze target 清单、顶层 inspect command、runner command、聚合 test target files，并为每个 target 暴露可复现 `bun test` 命令。
         - `platform contract errors --json [--compact]` 输出稳定 error protocol 合同，包含 issue type count，并覆盖 usage、unexpected、kernel，以及 verify blocked/acceptance、repair preflight/plan、upgrade noop/blocked/migration/rollback/conflict 的真实错误码样例。
         - `platform contract ci --json [--compact]` 输出稳定团队 CI 命令合同，覆盖顶层 verify commands、verify/quality/diagnostic/artifact upload command counts、per-step produces count、typecheck gate、顶层 quality commands、contract freeze gate、reference drift gate、review matrix/demo checklist diagnostic、顶层 diagnostic commands、governance/view/test/contract artifact upload 路径入口与聚合 produced artifact paths。
        - `platform contract errors --json [--compact]` 输出稳定错误协议合同，包含 verify/repair/upgrade 失败可参考的 diagnostic artifact paths。
         - `platform policy report --json [--compact]` 输出稳定 policy governance report 合同，直接消费最新 `generated/policy-report.json`。
         - `platform policy sources --json [--compact]` 输出稳定 policy source 合同，直接消费最新 `generated/policy-report.json`。
         - `platform acceptance coverage --json [--compact]` 输出稳定 acceptance coverage report 合同，直接消费最新 `generated/acceptance-coverage.json`。
         - `platform acceptance blocks --json [--compact]` 输出稳定 acceptance block coverage 合同，直接消费最新 `generated/acceptance-coverage.json`。
         - `platform acceptance slots --json [--compact]` 输出稳定 acceptance slot coverage 合同，直接消费最新 `generated/acceptance-coverage.json`。
         - `platform install manifest --json [--compact]` 输出稳定 install manifest 合同，直接消费最新 `generated/install-manifest.json`。
         - `platform blocks usage --json [--compact]` 输出稳定 block usage map 合同，直接消费最新 `generated/block-usage-map.json`。
         - `platform repair plan --json [--compact]` 输出稳定 repair plan 合同，直接消费最新 `generated/repair-plan.json`。
         - `platform postgres contract --json [--compact]` 输出稳定 Postgres contract 合同，直接消费最新 `generated/postgres-contract.json`。
         - `platform lock inspect --json [--compact]` 输出稳定 graph lock 合同，直接消费最新 `graph.lock.json`。
         - `platform runtime report --json [--compact]` 输出稳定 runtime verification report 合同，直接消费最新 `generated/runtime-report.json`。
        - `platform runtime steps --json [--compact]` 输出稳定 runtime step inspect 合同，从同一 `generated/runtime-report.json` 派生 build/unit/acceptance 步骤摘要。
         - `platform verification report --json [--compact]` 输出稳定 verification report 合同，直接消费最新 `generated/verification-report.json`。
        - `platform verify --json [--compact]` 执行验证并直接输出同一 verification report 合同。
         - `platform provenance registry --json [--compact]` 输出稳定 provenance registry 合同，直接消费最新 `provenance.json`。
         - `platform review summary --json [--compact]` 输出稳定 review summary 合同，直接消费最新 `generated/review-summary.json`。
         - `npm run test:contract-freeze` 固定运行 `platform contract freeze` runner command 声明的 `tests/cli.test.ts`、`tests/project-runtime.test.ts`、`tests/pipeline.test.ts`，冻结 CLI 入口、脚本元数据和治理产物清单。
         - slow-test budget：固定由 `platform test budget` 与 `npm run test:budget` 冻结 fast/runtime/all 慢测预算。
         - reference drift：固定由 `platform reference check` 与 `npm run reference:check` 守护 checked-in `project/`，JSON 输出用 runner command 和 failedStage 区分入口与 refresh/diff 阶段。
         - benchmark：固定由 `platform benchmark suite` 与 `npm run test:benchmark-contract` 冻结任务集与评分维度。
       - P1：把错误码体系升级为机器可恢复协议，先覆盖 verify/repair/upgrade 三域；当前已在 stderr JSON 暴露 code、message、suggestedActions 与 diagnostic artifact paths。
       - P1：给 shared/types、orchestrator、cli、compiler/emit 建立边界拆分地图，先定目标后重构。
         - `shared/types.ts`：已抽离 workspace path、policy、verification、acceptance、explain、provenance/override、plan/manifest 输入合同、lock/pass/install/slot task、repair plan、upgrade plan/diagnostics、review summary、task envelope 类型；当前为轻量兼容 re-export barrel。
         - `orchestrator.ts`：后续收敛为 workspace lifecycle、pipeline workflow、artifact/governance workflow 三层；当前文件只保留门面角色。
         - `platform/cli/index.ts`：已拆分为入口、usage、args、formatters、commands；usage、参数解析、纯格式化/inspect contract builder 和二级命令执行已有单一来源。
         - `compiler/emit/**`：后续按 explain、governance、provenance、output/views 分层；review summary 的 artifact summary 读取已抽成专用 helper，避免继续扩大 emit 兜底职责。
       - P2：补规模测试、资产质量评分、trace/decision-log、安全模型文档。
   - 暂停条件：
     - 连续新增内部 summary/expose/diagnostics 但没有外部闭环提升。
     - 新增概念不能映射到用户路径或稳定 contract。
     - 测试只覆盖局部 helper，未增强链路信号。

2. **升级迁移引擎增强**
   - 状态：active
   - 总目标：
     - 从单一 `file-replace` 升级到更多可控 migration 类型。
     - 让升级从“能跑”进入“能审查、能预检、能回滚边界明确”。
   - 已完成：
     - `config-rewrite` JSON 配置迁移：
       - `set`
       - `delete`
       - 执行期要求目标存在且是 JSON 文件。
     - `json-array-append/remove` JSON 数组迁移：
       - 允许缺失目标按既有语义创建或跳过。
       - 执行期拒绝目录目标。
     - `json-object-merge` JSON 对象合并迁移：
       - 可创建缺失目标。
       - 执行期拒绝目录目标。
     - `text-append` 文本追加迁移：
       - 可追加到已有文件。
       - 可创建缺失目标文件。
       - 缺少 `content` 会在 planning 前被 schema 校验阻断。
       - 目标已存在但不是文件时会在 dry-run preflight 阶段阻断。
     - `text-replace` 文本字面量替换迁移：
       - 可替换所有匹配字面量文本。
       - 缺少 `search` / `replacement` 会阻断。
       - 未命中目标文本会在 planning 阶段阻断。
       - dry-run plan 可展示 impact 和 migration summary。
     - `text-replace-regex` 文本正则替换迁移：
       - 可替换匹配文本。
       - 正则非法会阻断。
       - 未命中目标文本会阻断。
       - dry-run plan 可展示 impact 和 migration summary。
     - `create-directory` 目录创建迁移：
       - 可创建嵌套目标目录。
       - dry-run plan 可展示 impact 和 migration summary。
       - 执行器单测覆盖目录落盘。
     - `copy-file` 文件复制迁移：
       - 可从目标 manifest root 读取单文件。
       - 可复制到 project 目标文件路径。
       - source 缺失会阻断。
       - source 不是文件会阻断。
       - 执行期拒绝目录目标。
       - dry-run plan 可展示 target impact。
       - migration summary 可展示 manifest source。
     - `copy-directory` 目录复制迁移：
       - 可从目标 manifest root 读取目录。
       - 可递归复制嵌套文件到 project 目标目录。
       - source 缺失会阻断。
       - source 不是目录会阻断。
       - dry-run plan 可展示 target impact。
       - migration summary 可展示 manifest source。
     - `delete-file` 文件删除迁移：
       - 可删除已存在文件。
       - 目标是目录时会阻断。
       - dry-run plan 可展示 impact 和 migration summary。
     - `delete-directory` 目录删除迁移：
       - 可递归删除已存在目录。
       - 目标缺失会阻断。
       - 目标不是目录会阻断。
       - dry-run plan 可展示 impact 和 migration summary。
     - `rename-file` 文件移动迁移：
       - 可把文件移动到新路径。
       - source 缺失会阻断。
       - source 是目录会阻断。
       - target 已存在会阻断。
       - dry-run plan 同时展示 source/target impact。
     - `rename-directory` 目录移动迁移：
       - 可把目录移动到新路径。
       - source 缺失会阻断。
       - source 不是目录会阻断。
       - target 已存在会阻断。
       - dry-run plan 同时展示 source/target impact 与 directory role。
     - 官方升级 manifest 中的多迁移类型覆盖。
     - upgrade plan migration 摘要与类型计数。
     - upgrade dry-run 入口。
     - `slot-contract-update` 计划与影响面记录。
     - 迁移 `requiresVerification` 到 plan/review 的显式传播。
     - 升级迁移 entry schema 校验，包含重复 migration id 的 planning 阶段阻断和 entry id/kind/path diagnostics/review/CLI/explain graph 归因。
     - slot 合同变化与 explain graph 的连接。
     - upgrade plan/migration/diagnostics 到 explain graph 的一等归因节点。
     - upgrade preflight check 与 diagnostics failedCheck 进入 explain graph 归因。
     - upgrade preflight check/evidence 计数进入 CLI explain。
     - upgrade migration requiresVerification 到 explain graph 的分类归因节点。
     - upgrade migration verification 分布进入 review summary。
     - upgrade migration verification 分布进入 CLI explain。
     - upgrade migration verification 分布进入本地 Source View。
     - upgrade migration source/slot 明细与 sourceMigrationCount/slotMigrationCount 进入 CLI explain 和本地 Source View。
     - upgrade plan `migrationOperations` 结构化操作明细：
       - 状态：done。
       - 稳定暴露每条 migration 的 role。
       - 文件/目录迁移暴露 source。
       - JSON 迁移暴露 path、update/item/value key 计数。
       - text 迁移暴露 content/search/replacement/pattern/flags 摘要。
       - slot 迁移暴露 slotId、inputType、outputType 与 writableZones。
       - review summary、CLI explain 与本地 Source View 均展示 operation evidence。
       - review summary 输出稳定 migrationOperationCount。
     - upgrade plan 到本地视图的摘要呈现，包含 source/slot migration 计数、migration operation role 分布与明细。
     - upgrade plan 执行前检查清单。
     - upgrade trajectory 进入 review summary：
       - 状态聚合。
       - preflight 聚合。
       - migration 聚合。
       - migration operation 明细聚合。
       - impact 聚合。
       - diagnostics 聚合。
     - upgrade trajectory 进入 CLI explain 摘要。
     - upgrade trajectory 进入 local source view 摘要。
     - 升级检查结果在 review/local view 中的聚合。
     - 升级前置检查失败的结构化诊断 artifact。
     - 升级诊断在 review/local view 中的聚合。
     - upgrade plan/diagnostics 进入 lock/provenance 产物清单。
     - CLI `platform upgrade <block-id> <target-version> --dry-run --json [--compact]` 可输出机器可解析 plan，供团队 CI 直接消费单行合同。
     - CLI `platform upgrade plan [--json --compact]` 可只读检查最新 upgrade plan，不重新执行升级。
     - CLI `platform upgrade diagnostics [--json --compact]` 可只读检查最新 upgrade diagnostics，不重新执行升级。
     - upgrade CLI 普通文本摘要：
       - 显示 block 升级版本。
       - 显示 dry-run 状态。
       - 显示 plan 状态。
       - 显示 migration 数量。
       - 显示 preflight check 数量。
       - 显示 preflight evidence 聚合数量。
       - 显示 migration kind 计数。
       - 显示 source/slot migration 计数。
       - 显示 migration operation role 计数。
       - 显示 impact 文件列表。
       - 显示 requires verification 聚合结果。
       - 显示最多前三条 migration id。
       - 显示最多前三条 migration kind。
       - 显示最多前三条 migration target。
       - 显示最多前三条 text migration operation content/search/replacement/pattern/flags 摘要。
       - 显示最多前三条 migration requiresVerification。
       - 显示最多前三条 preflight check id。
       - 显示最多前三条 preflight check status。
       - 显示最多前三条 preflight check evidence 数量。
   - 当前阶段拆分：
     - 阶段 1：扩 migration 类型。
     - 阶段 2：补 migration 预检与阻断口径。
     - 阶段 3：补 migration 后 explain/review 可见性。
   - 连续功能切口：
     - 切口 A：新增文件系统类 migration：
       - create-directory：
         - 状态：done。
         - 执行：创建嵌套目标目录。
         - plan：dry-run 记录目录 impact。
       - copy-file：
         - 状态：done。
         - 执行：从 manifest source 复制单文件。
         - safety：source 必须存在且必须是文件。
         - plan：dry-run 记录目标文件 impact。
         - summary：记录 manifest source。
       - copy-directory：
         - 状态：done。
         - 执行：从 manifest source 目录递归复制。
         - safety：source 必须存在且必须是目录。
         - plan：dry-run 记录目标目录 impact。
         - summary：记录 manifest source。
       - delete-file：
         - 状态：done。
         - 执行：删除目标文件。
         - safety：目标必须存在且必须是文件。
         - plan：dry-run 记录文件 impact。
       - delete-directory：
         - 状态：done。
         - 执行：递归删除目标目录。
         - safety：目标必须存在且必须是目录。
         - plan：dry-run 记录目录 impact。
       - rename-file：
         - 状态：done。
         - 执行：移动或重命名文件。
         - safety：source 必须存在且必须是文件。
         - safety：target 必须未占用。
         - plan：dry-run 记录 source 与 target impact。
       - rename-directory：
         - 状态：done。
         - 执行：移动或重命名目录。
         - safety：source 必须存在且必须是目录。
         - safety：target 必须未占用。
         - plan：dry-run 记录 source 与 target impact，并输出 directory operation。
     - 切口 B：新增文本结构类 migration：
       - text-append：
         - 状态：done。
         - 执行：追加文本并创建缺失目标文件。
         - 校验：缺少 `content` 时阻断。
         - preflight：目标已存在但不是文件时阻断。
       - text-replace：
         - 状态：done。
         - 执行：替换所有匹配字面量文本。
         - 校验：缺少 `search` / `replacement` 时阻断。
         - 运行时安全：未命中目标文本时阻断。
         - preflight：dry-run 检查目标文件和字面量命中。
       - text-replace-regex：
         - 状态：done。
         - 执行：正则替换匹配文本。
         - 校验：缺少 `pattern` / `replacement` 时阻断。
         - 运行时安全：正则非法或未命中目标文本时阻断。
       - 多目标 patch bundle：
         - 状态：later。
     - 切口 C：新增 migration preflight：
       - 目标文件存在性检查。
       - JSON migration 结构 evidence：
         - 状态：done。
         - plan：`migration-json-shapes` preflight check。
         - array：记录 path 与 items 数量。
         - object：记录 path 与 value key 数量。
         - config：记录 updates 数量，并在 planning 阶段阻断空 update path。
       - schema/JSON 结构检查：
         - 状态：done。
         - plan：`migration-json-structure` preflight check。
         - 阻断：已有 array target 或父路径非对象时阻断。
         - 阻断：已有 object merge target 或父路径非对象时阻断。
         - diagnostics：归类到 `migration-json-structure`。
       - text replacement pattern 检查：
         - 状态：done。
         - plan：`migration-text-patterns` preflight check。
         - literal：记录 `search` 字面量长度。
         - regex：记录 regex flags。
         - 阻断：非法正则在 planning 阶段阻断。
         - 阻断：literal/regex 未命中目标文本时阻断。
         - diagnostics：归类到 `migration-text-patterns`。
       - migration source/target 当前存在性检查：
         - 状态：done。
         - plan：`migration-targets` preflight check。
         - evidence：记录每个 migration 的 source/target 是 `exists` 还是 `missing`。
         - diagnostics：project path escape 归类到 `migration-targets`。
         - details：记录 migration id。
         - details：记录 source/target role。
         - details：记录逃逸 path。
         - details：记录 root 类型。
       - file operation 可执行性检查：
         - 状态：done。
         - plan：`migration-file-operations` preflight check。
         - file-replace：确认 manifest source 存在，执行期拒绝目录 target。
         - copy-file：确认 manifest source 存在且是文件，执行期拒绝目录 target。
         - copy-directory：确认 manifest source 存在且是目录。
         - copy-directory：dry-run 与执行期均拒绝已被文件占用的 target，避免泄露底层 fs 错误。
         - create-directory：dry-run 与执行期均允许已有目录并拒绝文件占用 target。
         - delete-file：确认 target 存在且是文件。
         - delete-directory：确认 target 存在且是目录。
         - rename-file：确认 source 存在且是文件。
         - rename-file：确认 target 未被占用。
         - rename-directory：确认 source 存在且是目录。
         - rename-directory：确认 target 未被占用。
         - apply：执行阶段 migration 失败时写入 `upgrade-diagnostics.json` 并保留回滚语义。
         - diagnostics：通过 phase 区分 planning/apply，并进入 review summary 与本地视图。
         - diagnostics：归类到 `migration-file-operations`。
         - diagnostics：apply 阶段失败保留 migration id/kind/source/target 与 rollback restored 归因，并进入 review failure point、CLI explain 与 review summary CLI 文案。
       - slot 合同前后兼容性检查：
         - 状态：done。
         - plan：`migration-slot-contracts` preflight check。
         - slot：确认目标 manifest slot 存在。
         - target：确认 migration target 与目标 slot target 一致。
         - input/output：确认 migration 声明与目标 slot 合同一致。
         - writableZones：确认 migration 声明与目标 slot 写入边界一致。
         - apply：执行期确认 custom slot target 仍存在且是文件，不改写用户 custom 实现。
         - diagnostics：归类到 `migration-slot-contracts`。
     - 切口 D：把每类 migration 的影响面写入：
       - 状态：done。
       - review summary：
         - upgrade status。
         - block/version 范围。
         - preflight check 总数。
         - preflight evidence 总数。
         - preflight group 聚合。
         - migration kind 计数。
         - migration summary。
         - migration operation summary。
         - requires verification 聚合。
         - verification required/skipped 分布。
         - impact 聚合。
         - blocked diagnostics 聚合。
       - CLI explain：
         - upgrade status。
         - block/version 范围。
         - migration 数量。
         - impact 数量。
         - migration source 数量。
         - migration slot 数量。
         - requires verification 状态。
         - verification required/skipped 分布。
       - local views：
         - Upgrade Summary 卡片。
         - Upgrade Preflight Summary。
         - Upgrade Migration Kind Summary。
         - Upgrade Operation Role Summary。
         - Upgrade Verification Summary。
         - Upgrade Migration Summary。
         - Upgrade Migration Operation Summary。
         - migration source 明细列。
         - migration slot 明细列。
         - operation source/path/count/slot/文本字段明细。
         - Upgrade Blocker Summary。
       - explain graph：
         - upgrade plan 节点。
         - upgrade migration 节点。
         - upgrade diagnostics 节点。
         - upgrade verification 分类节点。
         - plan 到 block 的连接。
         - plan 到 impact file 的连接。
         - plan 到 migration 的连接。
         - migration 到 target file 的连接。
         - migration 到 verification category 的连接。
         - diagnostics 到 plan 的连接。
         - diagnostics 到失败 migration 的连接。
         - diagnostics 到 rollback restored 状态的连接。
       - Upgrade Plan 增加 Preflight Summary。
       - Upgrade Plan 增加 Operation Role Summary 与 Migration Operations 明细。
       - 按 preflight group 汇总 checks 数量和 evidence 数量。
   - 每个切口的验证口径：
     - 单测覆盖新增 migration 执行器。
     - `upgrade.test.ts` 覆盖成功/阻断/回滚口径。
     - 必要时跑主链 `verify -> lock -> explain`。
   - 完成定义：
     - 新 migration 类型可声明、可执行、可 dry-run。
     - 失败能结构化暴露到 diagnostics/review。
     - explain/view 能看到迁移影响面。

2. **repair 从基础可用到可审查**
   - 状态：active
   - 总目标：
     - 让 repair plan 更准确地区分 failure 类型：
       - slot failure
       - spec failure
       - kernel failure
     - 输出更清楚的可修复边界。
     - 让 repair 的可执行性与不可执行原因都可审查。
   - 已完成：
     - 结构化 failure points。
     - repairable 标记。
     - 失败点到 acceptance/policy/runtime 目标的映射。
     - repair target attribution summary：
       - target type 聚合进入 review summary。
       - target type 聚合进入 CLI explain。
       - target type 明细进入本地 Source View。
     - 本地视图中的 slot 写入边界展示。
     - 无可修 slot 的阻断错误。
     - repair plan provenance/review 暴露。
     - repair plan 到本地视图的摘要呈现。
     - repair task 与 explain graph 的连接。
     - repair category 与 explain graph 的连接。
     - repair 后自动要求重新 verify 的显式状态。
     - repair plan dry-run 模式。
     - repair plan 的执行前差异预览。
     - repair plan 结构化 blockers：
       - 不可修原因。
       - 阻断边界。
       - 人工决策点。
     - repair blocker 进入 review summary。
     - repair blocker 进入 local view。
     - repair task category 归因：
       - 当前 slot repair task 归类为 `slot-rewrite`。
       - 预留 `config-repair`。
       - 预留 `generated-artifact-refresh`。
       - category 进入 repair plan。
       - category summary 进入 review summary。
       - category summary 进入 CLI explain。
       - category summary 进入 local Source View。
       - category 进入 explain graph。
       - 旧 repair plan artifact 缺少 category 时按 `slot-rewrite` 兼容展示。
     - repair plan CLI JSON 输出：
       - `repair --json [--compact]`。
       - `repair --dry-run --json [--compact]`。
       - 输出机器可解析 `RepairPlan`。
       - 保持普通文本输出不变。
       - dry-run JSON 会写入 `generated/repair-plan.json`。
       - blocked repair JSON 输出：
         - 保持失败退出码。
         - stdout 输出已写入的 blocked `RepairPlan`。
         - stderr 保留 `REPAIR-BLOCKED-*` 错误与 details。
       - repair CLI 普通文本摘要：
         - 显示 task 数。
         - 显示 blocker 数。
         - 显示 source verification 状态。
         - 显示 requires verification 状态。
         - 显示最多前三个 repair task 目标。
         - 显示 task preview changed 状态。
         - 显示 task preview added/removed 行数。
         - 显示 task preview before/after 总行数。
         - 显示 task failure point lane/kind。
         - 显示 task failure point issue type。
         - 显示 task failure point repairable 状态。
         - 显示 task failure point message。
         - blocked 场景保持失败退出码。
         - blocked 场景 stdout 输出普通文本摘要。
         - blocked 场景 stderr 保留错误上下文。
         - repair failure taxonomy 汇总：
           - lane 分布。
           - kind 分布。
           - issue type 分布。
           - repairability 分布。
         - repair failure taxonomy 进入 review summary。
         - repair failure taxonomy 进入 CLI explain 摘要。
         - repair failure taxonomy 进入 local Source View。
         - 显示最多前三个 blocker 摘要。
         - 显示 blocker failure point lane/kind。
         - 显示 blocker failure point issue type。
         - 显示 blocker failure point repairable 状态。
         - 显示 blocker failure point message。
   - 当前阶段拆分：
     - 阶段 1：细化 failure point 归因。
     - 阶段 2：细化 repair task 生成边界。
     - 阶段 3：细化 repair 后验证追踪。
   - 连续功能切口：
     - 切口 A：把 failure point 归因到更细粒度目标：
       - 状态：done。
       - generated file。
       - slot target。
       - acceptance case。
       - policy target。
       - runtime target。
       - 输出位置：
         - `generated/review-summary.json`。
         - CLI explain 文本。
         - Source View。
     - 切口 B：把 repair task 拆成明确类别：
       - 状态：done。
       - 当前类别：
         - `slot-rewrite`。
       - 预留类别：
         - `config-repair`。
         - `generated-artifact-refresh`。
       - 输出位置：
         - `generated/repair-plan.json`。
         - `generated/review-summary.json`。
         - CLI explain 文本。
         - Source View。
     - 切口 C：补 repair 阻断解释：
       - 状态：done。
       - 为什么不可修。
       - 哪个边界阻止修复。
       - 需要人工决策的点。
     - 切口 D：补 repair 前后 diff/verify trace：
       - 状态：active。
       - preview：done。
       - applied result：done。
       - verify pending state：done。
       - review summary 聚合：done。
       - CLI explain 摘要：done。
       - local source view 摘要：done。
       - 结构化 verification trace：done。
       - 已完成：
         - `repair --dry-run --json` 输出 preview 后的 repair plan。
         - JSON 输出保留 `requiresVerification`。
         - JSON 输出保留 repair task failure points。
         - JSON 输出可被 CI/review 工具直接解析。
         - review summary 输出 `verificationTrace.pendingReason`。
         - review summary 输出 `verificationTrace.nextAction`。
         - `verificationTrace` 只表达结论和下一步动作。
         - `verificationTrace` 不复制已有 status/count/requires 字段。
         - CLI explain 展示 `pendingReason -> nextAction`。
         - Source View 展示 pending reason。
         - Source View 展示 next action。
         - blocked 场景下 stdout 输出 blocked repair plan。
         - blocked 场景下 stderr 保留错误上下文。
        - repair task 执行前审查摘要：done。
        - `RepairTask.review` 暴露 write bounds。
        - `RepairTask.review` 暴露 required symbols。
        - `RepairTask.review` 暴露 forbidden operations。
        - `RepairTask.review` 暴露 tests to pass。
        - `RepairTask.review` 暴露 failure targets。
        - repair CLI 普通文本展示执行前审查摘要。
        - review summary task summary 展示同一审查摘要。
        - local Source View 展示同一审查摘要。
   - 每个切口的验证口径：
     - `review-repair-summary.test.ts`。
     - `pipeline.test.ts`。
     - 针对 repair plan/local view 的定向测试。
     - CLI JSON 消费测试：
       - `tests/cli.test.ts`。
       - `repair --dry-run --json`。
       - blocked repair JSON 输出。
       - argument usage 边界。
   - 完成定义：
     - repair plan 不仅能生成，还能说明：
       - 修什么。
       - 为什么修。
       - 为什么不能修。
       - 修后还需验证什么。

3. **policy governance 可审查化**
   - 状态：done
   - 总目标：
     - 让 policy gate 不只输出 pass/fail。
     - 让官方策略、项目策略、合并策略和 violation 都能被 review/CLI/local view 消费。
     - 为后续 policy center 和团队 review assist 提供稳定结构化口径。
   - 已完成：
     - policy report 读取进入 review summary。
     - `platform policy report` 提供最新 policy governance report 文本 inspect 入口。
     - `platform policy report --json [--compact]` 提供稳定机器可读合同，直接消费最新 `generated/policy-report.json`。
     - `platform policy sources --json [--compact]` 提供稳定 policy source 只读合同，直接消费最新 `generated/policy-report.json`。
     - policy governance summary 进入 `generated/review-summary.json`：
       - `status`。
       - official policy 数量。
       - project policy 数量。
       - merged policy 数量。
       - source 数量。
       - violation 数量。
       - severity counts。
     - policy source summary：
       - scope。
       - path。
       - policy IDs。
     - merged policy summary：
       - policy id。
       - source scope。
       - source path。
       - targets。
     - explain graph 连接 merged policy targets 到 `file:*` 或 `block:*` 节点。
       - target count。
       - target paths。
     - violation summary：
       - policy id。
       - severity。
       - rule。
       - file count。
       - files。
       - appliesTo。
       - message。
       - source scope/path。
     - CLI `explain` 普通文本显示：
       - policy status。
       - official count。
       - project count。
       - merged count。
       - violation count。
     - local Source View 显示：
       - Policy Summary。
       - Policy Severity Summary。
       - Policy Source Summary。
       - Policy Merge Summary。
       - Policy Violation Summary。
   - 当前阶段拆分：
     - 阶段 1：policy report 到 review summary。
     - 阶段 2：review summary 到 CLI explain。
     - 阶段 3：review summary 到 local Source View。
   - 连续功能切口：
     - 切口 A：统一 policy 数量口径：
       - official。
       - project。
       - merged。
       - source。
       - violation。
     - 切口 B：统一 policy 明细口径：
       - source summaries。
       - merged summaries。
       - violation summaries。
       - severity counts。
     - 切口 C：把 policy governance 放到审查入口：
       - review summary JSON。
       - CLI explain 文本。
       - local Source View HTML。
   - 每个切口的验证口径：
     - `tests/review-policy-summary.test.ts`。
     - `tests/cli.test.ts`。
     - `tests/pipeline.test.ts`。
   - 完成定义：
     - review summary 能独立说明 policy merge 与 violation 状态。
     - CLI explain 能一眼看到 policy governance 总览。
     - local view 能审查 source/merge/violation 明细。

4. **acceptance coverage 可审查化**
   - 状态：done
   - 总目标：
     - 让 acceptance coverage 不只存在于 graph overlay 和原始 JSON。
     - 让 block/slot 覆盖状态进入 review、CLI 和本地视图。
     - 为后续团队 review assist 提供覆盖缺口的稳定摘要。
   - 已完成：
     - `platform acceptance coverage` 提供最新 acceptance coverage report 文本 inspect 入口。
     - `platform acceptance coverage --json [--compact]` 提供稳定机器可读合同，直接消费最新 `generated/acceptance-coverage.json`。
     - `platform acceptance blocks|slots --json [--compact]` 提供稳定 block/slot coverage 只读合同，直接消费最新 `generated/acceptance-coverage.json`。
     - coverage summary 进入 `generated/review-summary.json`：
       - status。
       - acceptance passed count。
       - block count。
       - slot count。
       - covered block/slot count。
       - uncovered block/slot count。
       - acceptance passed IDs。
       - uncovered block IDs。
       - uncovered slot IDs。
     - block coverage summary：
       - block id。
       - declared acceptance count。
       - covered by count。
       - declared acceptance IDs。
       - covered by IDs。
     - slot coverage summary：
       - slot id。
       - declared acceptance count。
       - covered by count。
       - declared acceptance IDs。
       - covered by IDs。
     - CLI `explain` 普通文本显示：
       - coverage status。
       - acceptance passed count。
       - covered blocks ratio。
       - covered slots ratio。
     - local Source View 显示：
       - Acceptance Coverage Summary。
       - Block Coverage Summary。
       - Slot Coverage Summary。
   - 当前阶段拆分：
     - 阶段 1：coverage report 到 review summary。
     - 阶段 2：review summary 到 CLI explain。
     - 阶段 3：review summary 到 local Source View。
   - 连续功能切口：
     - 切口 A：统一 coverage 数量口径：
       - acceptance passed。
       - total blocks/slots。
       - covered blocks/slots。
       - uncovered blocks/slots。
     - 切口 B：统一 coverage 明细口径：
       - block summaries。
       - slot summaries。
       - declared acceptance IDs。
       - covered by IDs。
     - 切口 C：把 coverage 放到审查入口：
       - review summary JSON。
       - CLI explain 文本。
       - local Source View HTML。
   - 每个切口的验证口径：
     - `tests/review-coverage-summary.test.ts`。
     - `tests/cli.test.ts`。
     - `tests/pipeline.test.ts`。
   - 完成定义：
     - review summary 能独立说明 acceptance 覆盖状态。
     - CLI explain 能一眼看到覆盖比例。
     - local view 能审查 block/slot 覆盖明细。

5. **provenance 可审查化**
   - 状态：done
   - 总目标：
     - 让 provenance 不只作为原始 artifact 列表存在。
     - 让来源、覆盖、registry 和 generated pass 能被 review/CLI/local view 直接消费。
     - 为后续团队 review assist 提供文件来源可信度摘要。
   - 已完成：
     - provenance summary 进入 `generated/review-summary.json`：
       - artifact count。
       - verified artifact count。
       - unverified artifact count。
       - override artifact count。
       - registry artifact count。
       - generated artifact count。
       - generated pass count。
     - origin summary：
       - origin type。
       - count。
       - paths。
     - override summary：
       - override status。
       - count。
       - paths。
     - registry summary：
       - registry source id。
       - registry kind。
       - registry location。
       - count。
       - paths。
     - generated pass summary：
       - pass。
       - count。
       - paths。
     - CLI `explain` 普通文本显示：
       - artifact count。
       - override count。
       - registry count。
       - unverified count。
     - `platform provenance registry` 提供最新 provenance registry 文本 inspect 入口。
     - `platform provenance registry --json [--compact]` 提供稳定机器可读合同，直接消费最新 `provenance.json`。
     - local Source View 显示：
       - Provenance Summary。
       - Provenance Origin Summary。
       - Provenance Override Summary。
       - Provenance Registry Summary。
       - Provenance Generated Pass Summary。
   - 当前阶段拆分：
     - 阶段 1：provenance artifacts 到 review summary。
     - 阶段 2：review summary 到 CLI explain。
     - 阶段 3：review summary 到 local Source View。
   - 连续功能切口：
     - 切口 A：统一 provenance 数量口径：
       - artifact。
       - verified/unverified。
       - override。
       - registry。
       - generated pass。
     - 切口 B：统一 provenance 分组口径：
       - origin summaries。
       - override summaries。
       - registry summaries。
       - generated pass summaries。
     - 切口 C：把 provenance 放到审查入口：
       - review summary JSON。
       - CLI explain 文本。
       - provenance registry CLI。
       - local Source View HTML。
   - 每个切口的验证口径：
     - `tests/review-provenance-summary.test.ts`。
     - `tests/cli.test.ts`。
     - `tests/pipeline.test.ts`。
   - 完成定义：
     - review summary 能独立说明 artifact 来源结构。
     - CLI explain 能一眼看到 provenance 风险面。
     - provenance registry CLI 能直接输出原始 provenance artifact 合同。
     - local view 能审查 origin/override/registry/pass 明细。

6. **install impact 可审查化**
   - 状态：done
   - 总目标：
     - 让安装影响不只停留在逐 block 明细。
     - 让纵切面、动作、runtime entry 和目标路径聚合可被 review/CLI/local view 直接消费。
     - 为后续团队 review assist 提供“本次组合影响面”的稳定摘要。
   - 已完成：
     - install impact summary 进入 `generated/review-summary.json`：
       - impact count。
       - block count。
       - action kind count。
       - source root count。
       - target path count。
       - vertical count。
       - runtime entry count。
       - group count。
     - install impact 全局集合：
       - blocks。
       - action kinds。
       - source roots。
       - target paths。
       - verticals。
       - runtime entries。
     - install impact group summary：
       - vertical。
       - block count。
       - action kind count。
       - runtime entry count。
       - target path count。
       - blocks。
       - action kinds。
       - runtime entries。
       - target paths。
     - CLI `explain` 普通文本显示：
       - impact count。
       - group count。
       - action kinds。
       - runtime entry count。
       - target path count。
     - local Source View 显示：
       - Install Impact Summary 指标表。
       - Impact Groups。
       - Impact Details。
   - 当前阶段拆分：
     - 阶段 1：install impacts 到 review summary 聚合。
     - 阶段 2：review summary 到 CLI explain。
     - 阶段 3：review summary 到 local Source View。
   - 连续功能切口：
     - 切口 A：统一 install impact 数量口径：
       - impacts。
       - blocks。
       - actions。
       - sources。
       - targets。
       - verticals。
       - runtime entries。
     - 切口 B：统一纵切面分组口径：
       - vertical。
       - blocks。
       - actions。
       - runtime entries。
       - targets。
     - 切口 C：把 install impact 放到审查入口：
       - review summary JSON。
       - CLI explain 文本。
       - local Source View HTML。
   - 每个切口的验证口径：
     - `tests/review-summary.test.ts`。
     - `tests/cli.test.ts`。
     - `tests/pipeline.test.ts`。
   - 完成定义：
     - review summary 能独立说明安装影响聚合面。
     - CLI explain 能一眼看到安装影响大小。
     - local view 能审查 vertical/action/runtime/target 分组。

7. **计划与进度显式化**
   - 状态：active
   - 总目标：
     - 把未来计划和当前进度固定在 repo 文档中。
     - 避免进度只散落在：
       - 会话上下文
       - 临时任务列表
       - git log
     - 让后续开发不是“找下一步”，而是“沿清单连续推进”。
   - 已完成：
     - 本文新增正式进度清单。
     - 本地 Source View 与 Slot / Rule View 已有互相跳转导航。
     - runtime scaffold 与 project base 的超长单行生成模板已改为多行 template literal。
     - 后续收益：
       - 降低局部编辑成本。
       - 降低 review diff 成本。
       - 降低冲突成本。
   - 当前阶段拆分：
     - 阶段 1：把 active/next 工作包列表化。
     - 阶段 2：把每个工作包继续拆到切口级。
     - 阶段 3：把每轮提交反映回路线图。
   - 连续功能切口：
     - 切口 A：给每个 active 工作包补：
       - 当前阶段。
       - 连续切口。
       - 验证口径。
       - 完成定义。
     - 切口 B：给每个 next 工作包补：
       - 进入条件。
       - 默认顺序。
       - 不做前提。
     - 切口 C：同步 README/入口文档：
       - 当前主链能力。
       - 当前推荐演示块组合。
       - 当前治理产物查看入口。
   - 完成定义：
     - 用户可直接从文档挑下一切口。
     - AI 可不依赖聊天上下文连续推进。
     - 每个大点都有明确的小点序列。

4. **私有 registry 最小通路**
   - 状态：done
   - 总目标：
     - 让 workspace/private registry source 可被用户入口和主链路使用。
     - 与 official registry 共享 manifest/lock/provenance 口径。
   - 已完成：
     - 默认 plan 已包含 workspace private registry source。
     - private block 可通过 CLI/orchestrator 加入：
       - plan。
       - resolve。
       - compose。
       - verify。
       - lock。
       - explain。
     - CLI `add private/...` 会回显：
       - version。
       - registry source。
     - lock/provenance/review/local view 均保留 private registry source 元数据。
   - 当前阶段结论：
     - 基础通路已完成。
     - 当前不把 registry 基础设施继续前置扩张。
   - 退出后默认承接方向：
     - 由 Work Tracking / Ticket SaaS 纵切面继续消费 private registry 能力。
     - 后续在团队阶段再继续扩版本治理与私有块协作规范。

### next 工作包

1. **Work Tracking / Ticket SaaS 纵切面**
   - 状态：active
   - 总目标：
     - 在 Customer Admin 外增加一个 `ticket/basic` 最小纵切面。
     - 让业务块组合不只验证“能装配”，还验证“能协同演进”。
   - 基础业务能力目标：
     - 状态流转。
     - 负责人。
     - 租户隔离。
     - 列表筛选。
     - ticket 附件上传与租户隔离查看。
     - ticket 评论写入与租户隔离查看。
     - ticket 到期日与 SLA 汇总。
     - ticket 工时记录与租户隔离查看。
   - 已完成：
     - 新增 `ticket/basic` 官方块：
       - ticket 服务。
       - Prisma 片段。
       - unit/acceptance 验证。
       - 状态流转。
       - 负责人筛选。
       - 租户隔离。
     - 扩展块组合可安装并通过 verify。
     - Postgres contract 已覆盖 `tickets` 表。
     - runtime scaffold 已生成：
       - `/tickets` 页面。
       - ticket API。
       - 状态流转 API。
       - 表单组件。
       - runtime unit test。
       - Playwright 验收。
     - `audit/basic` 联动：
       - ticket 创建写入 ticket 审计条目。
       - ticket 状态流转写入 ticket 审计条目。
       - `/tickets` 页面展示 ticket 审计条目。
     - `notify/email-basic` 联动：
       - ticket 创建生成 ticket 通知。
       - `/tickets` 页面展示 ticket 通知。
       - 通知模型已从 customer-only 泛化到：
         - `entity`
         - `entityId`
     - `export/csv-basic` 联动：
       - ticket 列表生成 CSV 导出 API。
       - `/tickets` 页面生成 CSV 导出入口。
       - runtime unit/acceptance 已覆盖。
     - 新增 `reporting/ticket-summary` 官方块：
       - 按状态聚合 ticket。
       - 按负责人聚合 ticket。
       - `/tickets` runtime 页面展示 summary。
       - `/api/tickets/summary` 提供 summary JSON API。
       - `/api/tickets/summary/export` 提供 summary CSV 导出。
       - summary JSON / CSV 已支持 assignee + status 联动筛选。
       - 页面 summary 已与当前 assignee + status 筛选结果保持一致。
       - 页面已提供 summary JSON 与 CSV 入口。
     - ticket attachment 已贯通：
       - ticket service 附件写入/读取。
       - `/api/tickets/[ticketId]/attachments`。
       - `/tickets` 页面附件上传表单与列表。
       - runtime unit / acceptance / expanded block / postgres contract 覆盖。
     - ticket comment 已贯通：
       - ticket service 评论写入/读取。
       - `/api/tickets/[ticketId]/comments`。
       - `/tickets` 页面评论表单与列表。
       - runtime unit / acceptance / expanded block / postgres contract 覆盖。
     - ticket SLA/reporting 扩展已贯通：
       - `TicketInput` 支持 `dueDate`。
       - `TicketRecord` 持久化 `dueDate`。
       - `ticket/basic` Prisma 片段包含 `dueDate`。
       - Postgres contract `tickets` 表包含 `due_date`。
       - `reporting/ticket-summary` 输出 SLA 汇总：
         - overdue。
         - dueSoon。
         - unscheduled。
       - `export/csv-basic` ticket CSV 包含 `dueDate`。
       - `export/csv-basic` summary CSV 包含 SLA 行。
       - `/tickets` 页面展示工单到期日。
       - `/tickets` 页面展示 SLA summary。
       - runtime unit / acceptance / expanded block / pipeline 覆盖。
     - `worklog/basic` 已贯通：
       - 新增 `worklog/basic` 官方块。
       - `WorklogInput` 支持：
         - `ticketId`。
         - `minutes`。
         - `note`。
       - `WorklogRecord` 持久化：
         - `tenantId`。
         - `authorId`。
         - `createdAt`。
       - worklog service 支持：
         - 记录工时。
         - 按 ticket 读取工时。
         - 汇总 ticket 工时分钟数。
         - 跨租户 ticket 访问阻断。
       - Prisma 片段新增 `Worklog` 模型。
       - Postgres contract 新增 `worklogs` 表。
       - runtime scaffold 生成：
         - `/api/tickets/[ticketId]/worklogs`。
         - `TicketWorklogForm`。
         - `/tickets` 页面工时表单。
         - `/tickets` 页面工时列表。
         - `/tickets` 页面总工时分钟数。
       - runtime unit / acceptance / expanded block 覆盖。
     - Source View 已显式列出 generated runtime 页面/API 入口：
       - 便于审查 ticket export 等组合产物。
     - review summary 已显式聚合 ticket runtime attribution：
       - runtime entries。
       - vertical slices。
       - change sources 中的 related blocks。
     - explain graph 已显式连接 ticket runtime route 到相关 block：
       - `ticket/basic`。
       - `reporting/ticket-summary`。
       - `export/csv-basic`。
     - local views 已新增团队协作摘要卡片：
       - vertical summary。
       - block combination summary。
       - failure focus。
       - review runtime attribution。
     - ticket/worklog policy gate 覆盖已贯通：
       - `tenant-scope-required` 覆盖 `ticket/basic`。
       - `tenant-scope-required` 覆盖 `worklog/basic`。
       - policy targets 可定位：
         - `src/installed/entity/customer-service.ts`。
         - `src/installed/ticket/ticket-service.ts`。
         - `src/installed/worklog/worklog-service.ts`。
       - 租户检查从 customer 专用扩展为通用 tenantId 比较模式。
       - 移除 ticket service tenant context 时 policy gate 会失败。
    - ticket + override 治理组合已贯通：
      - `app/tickets/page.tsx` manual override 可覆盖 generated runtime 页面。
      - override provenance 记录：
        - `originType: override`。
        - `overrideStatus: manual`。
      - review summary change source 可显示：
        - `runtimeKind: page`。
        - `vertical: ticket`。
        - `relatedBlocks` 包含 `reporting/ticket-summary`、`ticket/basic`、`worklog/basic`。
      - review summary regression risk 可把 runtime override 反推到核心 block。
      - override conflict hints 可显示 ticket/worklog 相关冲突。
      - explain graph 保留 `file:app/tickets/page.tsx -> override:*` 的 `originates_from` 边。
      - reporting-only 组合不再生成依赖 `export/csv-basic` 的 summary CSV route。
    - ticket + upgrade 治理组合已贯通：
      - 新增 `ticket/basic@0.1.1` 官方升级目标。
      - 升级迁移包含：
        - `file-replace` 刷新 ticket service。
        - `json-array-append` 记录升级元数据。
      - ticket service 0.1.1 暴露 `TICKET_BLOCK_VERSION`。
      - upgrade plan 可显示：
        - migration kind counts。
        - preflight checks。
        - impacted files。
      - review summary 可显示：
        - `upgrade-plan-present`。
        - `upgrade-impact`。
      - explain graph 保留 ticket runtime page 到 `ticket/basic` 的 `writes_to` 归因边。
   - 当前阶段拆分：
     - 阶段 1：业务 CRUD 与 runtime host。
     - 阶段 2：横切治理联动。
     - 阶段 3：review/explain 团队协作面。
   - 连续功能切口：
     - 切口 A：补 reporting 继续细化：
       - summary API。
       - summary export。
       - summary explain 归因。
     - 切口 B：补 review/explain 联动：
       - review summary 中显式显示 ticket vertical 相关 generated artifacts。
       - explain graph 中显式连接 reporting/export/runtime route。
       - local view 中显示 ticket vertical 组合摘要。
     - 切口 C：补更强业务块：
       - `worklog/basic`。
       - ticket comment。
       - ticket SLA/reporting 扩展。
     - 切口 D：补更强治理组合验证：
       - ticket + override。
       - ticket + upgrade。
       - ticket + policy gate。
   - 默认执行顺序：
     - 已完成切口 B。
     - 已完成切口 A。
     - 已完成切口 C：
       - ticket attachment。
       - ticket comment。
       - ticket SLA/reporting 扩展。
       - `worklog/basic`。
     - 当前进入切口 D：
       - 已完成 ticket + policy gate。
       - 已完成 ticket + override。
       - 已完成 ticket + upgrade。
       - 后续转向更细 migration 类型和团队 CI 消费口径。
   - 每个切口的验证口径：
     - `expanded-blocks.test.ts`。
     - runtime unit。
     - runtime acceptance。
     - explain/review/local view 定向断言。
   - 完成定义：
     - ticket vertical 不只可运行。
     - ticket vertical 的业务块与治理块组合可被解释、可被审查、可被升级。

3. **review / explain 面向团队协作增强**
   - 状态：next
   - 总目标：
     - 让 review summary 更接近团队 review 入口。
     - 不只输出机器 JSON。
   - 当前阶段拆分：
     - 阶段 1：补结构化 review 信息。
     - 阶段 2：补团队阅读友好的视图摘要。
     - 阶段 3：补 CI/artifact 消费口径。
   - 连续功能切口：
     - 切口 A：review summary 扩展：
       - generated runtime entries 摘要。
       - vertical/block 组合摘要。
       - install plan 影响摘要。
       - 当前已完成：
         - runtime entries。
         - vertical slices。
         - install impacts。
     - 切口 B：explain graph 扩展：
       - runtime route 到 block 的可视连接。
       - generated API/page 到来源 block 的显式归因。
       - reporting/export 等横切能力的组合边。
       - CLI 普通文本摘要：
         - 状态：done。
         - 显示 node type 计数。
         - 显示 edge type 计数。
         - 显示 coverage block 数量。
         - 显示 coverage slot 数量。
         - 显示 uncovered block 数量。
         - 显示 uncovered slot 数量。
         - 显示 provenance origin type 分布。
         - 显示 review CI 状态。
         - 显示 impacted block/slot/runtime entry 数量。
     - 切口 C：local views 扩展：
       - 增加 vertical summary 卡片。
       - 增加 block combination 卡片：
         - 状态：done。
         - 显示每个 block 的 install step count。
         - 显示每个 block 的 verticals。
         - 显示每个 block 的 runtime entry paths。
       - 增加 failure focus 卡片：
         - 状态：done。
         - 显示 failure group summary。
         - 按 lane 聚合。
         - 按 kind 聚合。
         - 显示每组 artifact 列表。
         - 保留 failure details 明细表。
       - 增加 runtime attribution 卡片：
         - 状态：done。
         - 显示 runtime group summary。
         - 按 vertical 聚合。
         - 按 runtime kind 聚合。
         - 显示每组 related blocks。
         - 保留 runtime entries 明细表。
       - 增加 install impact 卡片：
         - 状态：done。
         - 显示 impact group summary。
         - 按 vertical 聚合。
         - 显示每组 block count。
         - 显示每组 action kinds。
         - 显示每组 runtime entries。
         - 显示每组 targets。
         - 保留 impact details 明细表。
       - local view 维护性：
         - 状态：done。
         - 抽取列表格式化 helper。
         - 统一 sort / join / fallback 口径。
         - 减少新增卡片中的重复长表达式。
     - 切口 D：CI 消费口径：
       - `upgrade --dry-run --json`：
         - 状态：done。
         - 输出机器可解析 upgrade plan。
       - `explain --json`：
         - 状态：done。
         - 输出机器可解析 explain graph。
         - 输出机器可解析 review summary。
       - review summary 关键字段：
         - 状态：done。
         - 保持 `formatVersion: 2`。
         - 稳定 `ciSummary.status`。
         - 稳定 `ciSummary` 计数字段。
         - 稳定 `failurePoints`。
         - 稳定 `regressionRisks`。
         - 稳定 `conflictHints`。
         - 暴露 `artifactSummary`。
       - `artifacts --json`：
         - 状态：done。
         - 输出 CI 上传 artifact manifest。
         - 支持输出格式：
           - `--json` pretty JSON。
           - `--json --compact` 单行 JSON。
           - `--paths` 上传路径列表。
           - `--paths --json` 结构化路径列表。
           - `--paths --json` 输出 `formatVersion`。
           - `--paths --json` 输出 `root`。
           - `--paths --json` 输出 `kind`。
           - `--paths --json` 输出 `byKind` 计数汇总。
           - `--paths --json` 输出 `uploadGroups`。
           - `--paths --json` 输出 `artifactStatus`。
           - `--paths --json` 输出 `missingCount`。
           - `--paths --json` 输出 `missingReasonCounts`。
           - `--paths --json` 输出 `missing` 诊断列表。
           - `--paths --kind governance` governance 上传路径。
           - `--paths --kind view` view 上传路径。
           - `--paths --kind test` runtime test result 上传路径。
           - `--paths --json --kind view` 结构化 view 路径。
           - `--paths --json --kind test` 结构化 runtime test result 路径。
         - CI workflow 直接消费 `--paths`。
         - CI workflow 直接消费 `--paths --kind governance`。
         - CI workflow 直接消费 `--paths --kind view`。
         - CI workflow 直接消费 `--paths --kind test`。
         - CI artifact upload 已拆分：
           - governance artifacts。
           - local views。
           - runtime test results。
         - 输出 artifact 相对路径。
         - 输出 artifact kind。
         - 输出 uploadName。
         - 输出 summary 计数字段：
           - governanceCount。
           - viewCount。
           - testCount。
           - contractCount。
           - uploadGroupCount。
           - missingReasonTypeCount。
         - 输出 artifactStatus：
           - `passed`。
           - `attention`。
         - 输出 uploadGroupCount。
         - 输出 uploadGroups：
           - `kind`。
           - `count`。
           - `paths`。
         - uploadGroups 可被消费：
           - review summary。
           - `explain --json`。
           - local source view。
         - `artifacts --json` 后自动刷新：
           - `generated/review-summary.json`。
           - `generated/views/source-view.html`。
           - `generated/views/slot-rule-view.html`。
           - 缺少 explain/view 前置产物时跳过刷新，不阻断失败诊断。
         - 输出 lock 声明但缺失的 generated artifact。
         - 缺失项包含：
           - `path`。
           - `reason`。
           - `declaredBy`。
         - 缺失 reason 分类：
           - `declared-generated-missing`。
           - `fixed-governance-missing`。
           - `fixed-view-missing`。
         - 输出 missingReasonCounts：
           - 按 reason 聚合。
           - review summary 可消费。
           - local source view 可展示。
         - local source view 主表显示：
           - upload group count，直接消费 artifact summary 的 `uploadGroupCount`。
           - missing reason type count，直接消费 artifact summary 的 `missingReasonTypeCount`。
         - 缺失项可被消费：
           - review summary。
           - `explain --json`。
           - local source view。
         - 持久化 `generated/ci-artifacts.json`。
         - 写入 lock/provenance。
       - 补对应测试夹具与快照。
   - 进入条件：
     - ticket vertical 已有至少一个 reporting/export 联动示例。
     - explain/local view 已能显示 runtime entry points。
   - 退出条件：
     - 以下信息能稳定聚合：
       - 失败点。
       - 覆盖缺口。
       - upgrade 冲突。
       - repair 冲突。
       - override 冲突。
       - vertical 组合产物摘要。
     - 可被 CI artifact 消费。

### 暂不推进

- 第二后端目标栈、Java、Elysia、游戏/LiveOps 扩展。
- marketplace、托管运行时、托管验证平台。
- 无约束自维护或核心 compiler pass 自改写。

## 新增整合：全局决策框架

### 现在必须决定

- `v0.1` 仍以当前 Customer Admin 母例为实现目标，不在首条闭环前切换到 ticket/work-tracking。
- 权威输入必须是 `app.plan.yaml`、`block.manifest.yaml`、`graph.lock.json`、slot、acceptance、policy 和 provenance，而不是聊天记录或生成源码。
- AI 只能作为受控 pass：`Align`、`Synthesize`、`Repair`，不能成为全仓主控制器。
- 真实源码必须落地，不能只保留 UX 映射或虚拟描述；源码是可审查、可部署、可调试的编译产物。
- `v0.1` 必须先证明 `resolve -> compose -> adapt -> verify -> lock` 的重复闭环。

### 现在不用实现但必须预留

- `ticket/basic` 或 work-tracking 行业母例，作为 `v0.2+` 更强 demo。
- `Kernel Block`、冷热路径、性能预算和 benchmark harness，用于未来高性能/底层系统接入。
- `provenance.json`、`explain-graph.json`、`acceptance coverage graph` 和 `policy gate` 的正式字段。
- upgrade / override 冲突分析、rule-backed override、迁移计划和回滚路径。
- 私有 registry、团队 CI、托管验证、双视图工作台和权限审计。
- 自举与自维护路径：先让系统描述和生成外围，再逐步接管 block、spec、验收和平台工具，而不是直接自改核心编译器。

### 现在明确不做

- 不做自由 chat 式整仓生成器。
- 不做全领域通吃承诺。
- 不做社区随意贡献整块代码的开放 marketplace。
- 不做多语言、多后端、多运行时并行扩张。
- 不把 Bun、Java、游戏、实时系统或底层 runtime 提前变成主线。
- 不让 AI 修改 plan、manifest、lock、registry block 源、generated 产物或未授权路径。

### 晚想会导致返工

- 如果不先冻结 compile contract，后续多栈、多块和升级都会退化成模板拼接。
- 如果不先设计 provenance 和 graph，团队 review 会退回“看 diff 猜 AI 做了什么”。
- 如果不先定义 override 与升级优先级，人工修改会在下一次 compose/upgrade 中丢失或冲突不可控。
- 如果不先区分冷/温/热路径，系统会错误承诺生成性能关键内核。
- 如果不先规定 AI 任务信封和写入边界，平台会退化成普通 Agent 自动改仓库。

## 阶段 A：文档与规格冻结

### 目标

- 把口语化讨论压缩成权威规格。
- 冻结 `v0.1` 母例、技术栈、三块、单槽位、三类核心文件。
- 写清终局方向，避免实现时误把系统做成增强版 vibecoding。

### 输出物

- [01-用户能力模块化开发-主题整理稿.md](D:\Project\pjc\docs\01-用户能力模块化开发-主题整理稿.md)
- [02-工程编译器-MVP-PRD与架构稿.md](D:\Project\pjc\docs\02-工程编译器-MVP-PRD与架构稿.md)
- [03-MVP实施计划与路线图.md](D:\Project\pjc\docs\03-MVP实施计划与路线图.md)
- [04-AI自主实现执行蓝图.md](D:\Project\pjc\docs\04-AI自主实现执行蓝图.md)
- [05-编译器核心实现规格.md](D:\Project\pjc\docs\05-编译器核心实现规格.md)
- [06-Registry与Block协议规范.md](D:\Project\pjc\docs\06-Registry与Block协议规范.md)
- [07-Pass状态机、错误码与恢复机制.md](D:\Project\pjc\docs\07-Pass状态机、错误码与恢复机制.md)
- [08-Verification、Provenance与Graph规范.md](D:\Project\pjc\docs\08-Verification、Provenance与Graph规范.md)
- [09-AI Runtime、任务信封与治理规范.md](D:\Project\pjc\docs\09-AI Runtime、任务信封与治理规范.md)
- [10-升级迁移与Override规范.md](D:\Project\pjc\docs\10-升级迁移与Override规范.md)

### 退出条件

- 四份文档对技术栈、母例、阶段目标、块边界、AI 写入边界描述一致。
- `app.plan.yaml`、`block.manifest.yaml`、`graph.lock.json` 已冻结为可编码接口。

### 风险

- 如果文档混合愿景、事实和实现细节，会再次变成对话纪要。

## 阶段 B：v0.1 首条闭环

### 目标

- 在单栈、单母例、三块、单槽位条件下，跑通第一条可信闭环。

### 子阶段

#### B1：规格与编译骨架

- 实现：
  - `app.plan.yaml` parser
  - `block.manifest.yaml` parser
  - `graph.lock.json` 生成
  - resolver 最小规则
  - composer 骨架
  - CLI 壳命令

#### B2：三个官方块

- 实现：
  - `auth/basic-session`
  - `tenant/basic-workspace`
  - `entity/customer-basic`

#### B3：单槽位 AI 与验收

- 实现：
  - `customer_normalizer` 骨架生成
  - 单槽位 AI 写回
  - `Vitest + Playwright` 主链路

### 退出条件

- 从空目录开始，CLI 能产出可运行项目。
- 三个块来自 registry 安装，不靠手工搬运。
- AI 只能修改 `custom/customer_normalizer.ts`。
- 主验收链路通过。

### AI 可自主承担

- 仅可实现已声明 slot。
- 不参与解析、安装和依赖求解。

### 里程碑

- `M1`：规格冻结并可生成 `graph.lock.json`
- `M2`：三块可被确定性安装
- `M3`：AI 只在单一 slot 生效
- `M4`：端到端验收通过并可重复执行

### 风险

- 过早引入通用 IR、图形界面或多目标栈，会直接破坏闭环验证。

## 阶段 C：v0.2 工程可持续化

### 目标

- 把“能跑一次”升级为“可以反复编译、可升级、可解释、可审查”。
- 把主链从单一母例验证，推进到业务块与治理块组合验证。
- 把 AI 从“只会生成”推进到“会解释、会定位、会局部修复”。

### 进入条件

- 阶段 B 闭环已稳定重复运行。
- `resolve -> compose -> adapt -> verify -> lock -> explain` 已具备基础可用版本。
- Customer Admin 母例已能作为回归基线。

### 当前阶段拆分

- C1：补齐 provenance、review、explain 的细粒度归因。
- C2：把 repair、upgrade 从“能出结果”推进到“能审查边界与失败原因”。
- C3：把官方块矩阵扩到业务块与治理块组合。
- C4：补齐 `PostgreSQL` contract 与本地治理产物基线。
- C5：冻结复杂度、性能、E2E 验收和 JSON contract 治理面。

### 连续功能切口

- 切口 A：增强 explain/review/local view 归因：
  - policy 节点、pin 节点、override 节点口径统一。
  - generated runtime route 到来源 block 的显式连接。
  - vertical 级组合摘要。
- 切口 B：增强 upgrade：
  - 新 migration 类型。
  - preflight 阻断。
  - diagnostics/review/explain 聚合。
- 切口 C：增强 repair：
  - failure point 到 file/slot/acceptance/policy 的细映射。
  - repair task 分类。
  - repair 前后 diff 与 verify trace。
- 切口 D：增强 Work Tracking / Ticket 母例：
  - `ticket/basic`。
  - `reporting/ticket-summary`。
  - `audit/basic`。
  - `notify/email-basic`。
  - `export/csv-basic`。
  - `rbac/basic`。
  - `table/filter-search`。
  - `file/upload`。
  - `infra/postgres`。
- 切口 E：增强 policy / acceptance / override 联动：
  - policy violation 归因。
  - acceptance coverage 缺口聚合。
  - override 冲突与 upgrade 冲突并列呈现。
- 切口 F：复杂度 / 性能 / E2E / contract 治理冻结：
  - 重复概念检查。
  - 命名漂移检查。
  - 类似逻辑分散检查。
  - 测试胶水逻辑检查。
  - 过度抽象检查。
  - compiler -> registry -> upgrade/repair -> verification -> explain/report 链路验收矩阵。
  - CLI 普通文本 contract。
  - JSON summary contract。
  - artifact contract 汇总。
  - E2E chain summary。
  - 性能预算与慢测分层。

### 推荐新增官方块

- P0：当前已进入主线组合的块：
  - `ticket/basic`
  - `reporting/ticket-summary`
  - `audit/basic`
  - `notify/email-basic`
  - `export/csv-basic`
- P1：当前治理与交互增强块：
  - `rbac/basic`
  - `table/filter-search`
  - `file/upload`
  - `infra/postgres`
- P2：下一批业务增强块：
  - `worklog/basic`
  - ticket comment/attachment
  - ticket SLA/reporting 扩展

### 母例演进

- 基线母例：Customer Admin 继续作为最小闭环回归基线。
- 当前扩展母例：Work Tracking / Ticket SaaS 最小纵切面。
- 下一阶段演示母例：
  - ticket + governance 组合 demo。
  - ticket + private registry + override + upgrade demo。

### 默认执行顺序

- 先完成切口 A：把 explain/review/local view 归因补全。
- 再完成切口 B、C：把 upgrade/repair 补到可审查。
- 然后推进切口 D：持续扩 ticket vertical。
- 最后推进切口 E：把 governance 联动收束到统一口径。
- 穿插推进切口 F：每轮密集功能后做复杂度、性能、E2E 与 contract 冻结检查。

### 验证口径

- 主测：
  - `tests/pipeline.test.ts`
  - `tests/explain-graph.test.ts`
  - `tests/review-summary.test.ts`
  - `tests/repair.test.ts`
  - `tests/upgrade.test.ts`
- 组合测：
  - `tests/expanded-blocks.test.ts`
  - `tests/override-manifest.test.ts`
  - `tests/policy.test.ts`
- 主链回归：
  - `verify -> lock -> explain`

### 退出条件

- 产物中每个 slot、每个安装块、每个关键 generated file 都可追溯来源。
- repair 失败时能说明：
  - 为什么不可修。
  - 哪个边界阻断修复。
  - 下一步应由谁决策。
- 至少一类块升级可稳定通过 `upgrade + verify + lock + explain`。
- ticket vertical 与治理块组合后，仍能稳定通过回归与解释产物检查。

### AI 可自主承担

- pin/slot 对齐建议。
- 局部 repair patch。
- override 回写建议。
- 升级风险摘要。
- review/local view 摘要生成。

### 风险

- 如果 provenance、review、graph 口径不统一，团队会失去对 AI 产物的信任。
- 如果 upgrade/repair 仍停留在“脚手架式一次性输出”，平台价值会被腰斩。
- 如果 ticket vertical 只有业务功能、没有治理归因，后续团队演示会缺乏说服力。

## 阶段 D：v0.5 团队可用化

### 目标

- 从单人编译器升级为小团队可协同的平台。
- 让团队能够共享 block、policy、验收与升级资产，而不是复制源码仓库。

### 进入条件

- 阶段 C 的 explain、repair、upgrade、policy 基线稳定。
- 官方块组合已能覆盖至少一个业务纵切面和多个治理横切面。

### 当前阶段拆分

- D1：私有 registry 与命名空间通路。
- D2：块版本策略与升级矩阵。
- D3：团队 CI 模板与 artifact 合同。
- D4：review assist 与治理使用规范。

### 连续功能切口

- 切口 A：私有 registry：
  - workspace source。
  - private block 解析与安装。
  - 来源元数据保留。
- 切口 B：版本治理：
  - block version 约束。
  - upgrade lane 约束。
  - 版本冲突摘要。
- 切口 C：团队 CI：
  - 状态：active。
  - 标准命令序列：
    - 状态：done。
    - `platform contract ci --json [--compact]` 输出 PR fast gate、full runtime gate、diagnostic review/matrix/explain/demo checklist 与 artifact upload 标准入口。
  - artifact 上传清单：
    - 状态：done。
    - `platform artifacts --json` 生成清单。
    - CI 上传步骤消费清单路径。
  - 失败时 review/explain 产物暴露。
- 切口 D：团队审查：
  - review summary 稳定字段。
  - policy gate 默认规则。
  - override/repair/upgrade 审批点。

### 默认执行顺序

- 先做切口 A，稳定私有来源。
- 再做切口 B，把版本与升级口径固定。
- 然后做切口 C、D，把团队协作路径跑通。

### 验证口径

- `tests/private-registry.test.ts`
- `tests/cli.test.ts`
- `tests/pipeline.test.ts`
- 团队 CI 样板项目的定向回归。

### 退出条件

- 团队可在不直接改主干块源码的前提下，共享块、策略、验收与规则。
- CI 中可稳定执行 `resolve -> compose -> adapt -> verify -> lock -> explain`。
- 失败构建能给出来源、差异、阻断点和修复建议。
- review/explain 产物可被团队成员在不读全量源码的前提下消费。

### AI 可自主承担

- 变更说明生成。
- 风险摘要。
- 回归影响面说明。
- 初步安全和权限检查。
- 私有块接入建议。

### 风险

- 如果没有团队边界和版本策略，私有 registry 会迅速退化成另一个源码仓库。
- 如果 CI artifact 口径不稳定，团队 review 仍会回到看 diff 的低效模式。

## 阶段 E：v1 平台化

### 目标

- 把系统正式做成团队级工程平台，而不是本地工具集合。
- 让规格、图谱、验证、治理、升级成为统一工作台的一部分。

### 进入条件

- 阶段 D 已跑通团队级私有 registry、CI、review 与 policy 基线。
- 官方块库已覆盖后台母体常见场景。

### 当前阶段拆分

- E1：Strategy Pack / Infra Pack / Governance Pack 正式化。
- E2：graph explorer 与双视图工作台。
- E3：policy center 与托管验证。
- E4：官方块库覆盖与运营口径。

### 连续功能切口

- 切口 A：平台包：
  - Strategy Pack。
  - Infra Pack。
  - Governance Pack。
- 切口 B：图谱工作台：
  - acceptance graph。
  - explain graph explorer。
  - Source / Slot Rule 双视图。
- 切口 C：治理中心：
  - policy center。
  - 托管验证。
  - 审计日志。
- 切口 D：块生态：
  - 官方块覆盖矩阵。
  - 生命周期状态。
  - 使用建议与风险标签。

### 默认执行顺序

- 先做切口 A，稳定平台包边界。
- 再做切口 B，建立统一浏览与审查入口。
- 然后做切口 C、D，补齐治理和生态面。

### 验证口径

- 平台演示仓回归。
- graph/explain/review 产物一致性检查。
- 多项目共享 pack 的组合验证。

### 退出条件

- 一个团队可以只通过规格和少量 slot 维护多个同类项目。
- 大部分样板、策略和治理逻辑由系统确定性装配。
- 人类 review 面积显著低于传统全仓 AI 生成模式。
- 图谱、策略、验证、升级都能在统一平台面被查看和追踪。

### AI 可自主承担

- 多 slot 协同综合。
- 多模块局部修复。
- 验收覆盖缺口提示。
- 升级迁移草案。
- 平台包接入建议。

### 风险

- 如果没有图谱和双视图，平台复杂度会重新退回到“看 diff 猜 AI 做了什么”。
- 如果平台包边界不清，最终会重新退化成源码模板集合。

## 阶段 F：v2 多目标编译器

### 目标

- 从“单栈平台”升级为“多目标编译器”。
- 在不破坏现有 block/slot/verification 合同的前提下，支持第二目标栈。

### 进入条件

- 阶段 E 的单栈平台已证明可持续升级、可多项目复用、可团队协同。
- 升级、repair、provenance、policy 在单栈下已稳定。

### 关键能力

- 第二后端目标栈。
- 更完整的升级/迁移引擎。
- marketplace / 受控生态。
- 托管编译、托管验证、托管观测。
- 运行时集成而非重造 runtime。

### 技术路径

- 保守路径：
  - 先完成 `Next.js + Prisma + PostgreSQL`。
  - 再补 `Bun` 次级运行支持。
  - 再评估 `Nest`。
  - 最后再评估 `Elysia`。
- 不变原则：
  - 新目标栈必须能复用 block interface、slot contract、verification contract。
  - 不能为了适配新栈破坏已有编译合同。
  - 不能用“新模板体系”绕过现有 graph/provenance/repair/upgrade 口径。

### 连续功能切口

- 切口 A：单栈巩固：
  - `PostgreSQL` 主基线。
  - upgrade/repair 跨版本稳定。
- 切口 B：第二目标栈试点：
  - 最小 block install。
  - 最小 slot contract。
  - 最小 verification lane。
- 切口 C：跨栈治理：
  - 跨栈 provenance。
  - 跨栈 explain。
  - 跨栈 acceptance 报告。
- 切口 D：托管能力：
  - 托管编译。
  - 托管验证。
  - 托管观测。

### 默认执行顺序

- 先完成切口 A。
- 再进入切口 B。
- 跨栈验证稳定后再进入切口 C、D。

### 验证口径

- 至少两个目标栈共享同一 plan 结构。
- 同一块契约在不同目标栈下有一致的安装/验证结果。
- upgrade/repair/report 在两个目标栈下都可运行。

### 退出条件

- 至少两个目标栈可以共享上游 plan 结构和大部分块契约。
- 块升级、迁移和验收可以跨目标栈工作。
- 团队不需要维护两套完全割裂的 block 与治理体系。

### AI 可自主承担

- 迁移计划生成。
- 兼容性差异说明。
- 目标栈适配 slot 生成。
- 跨栈风险摘要。

### 风险

- 多栈扩展最容易把系统重新打回“模板拼装器”，所以必须以接口和验证契约为核心。
- 如果先做第二栈、后补 contract，会导致首栈和次栈都难以维护。

## 阶段 G：v3 跨领域扩展

### 目标

- 把后台母体扩展到更广的软件工程域，但仍保持“规格优先、块优先、验收优先”。
- 让平台具备跨领域迁移与增量替换能力，而不是一开始就追求全覆盖。

### 进入条件

- `v1` 平台化稳定。
- 升级和 provenance 机制成熟。
- 块接口和验证体系已被证明可迁移。

### 当前阶段拆分

- G1：内部工具与工作流系统扩展。
- G2：旧系统现代化与增量替换。
- G3：重领域场景试点。

### 可见方向

- Java / 旧系统现代化。
- 内部工具与工作流整合。
- LiveOps / 运营后台。
- 玩法系统 / 内容管线。
- 组织级系统现代化与增量替换。

### 连续功能切口

- 切口 A：内部工具模板化：
  - 表单。
  - 列表。
  - 审批。
  - 通知。
- 切口 B：旧系统映射：
  - schema 映射。
  - API 映射。
  - 验收映射。
- 切口 C：增量替换：
  - 新旧接口桥接。
  - 数据同步策略。
  - 回滚路径。
- 切口 D：重领域试点：
  - 仅在平台基线稳定后评估游戏/LiveOps。

### 默认执行顺序

- 先做切口 A。
- 再做切口 B、C。
- 最后才评估切口 D。

### 验证口径

- 新领域块仍可复用既有 block/verification/provenance 口径。
- 至少一个旧系统替换案例可稳定回归。
- 新领域扩展不破坏后台母体核心路径。

### 退出条件

- 至少两个非当前母例领域可共享平台核心合同。
- 旧系统现代化场景中，平台能给出可执行的迁移顺序与风险解释。
- 跨领域扩展未引入新的“无合同模板体系”。

### AI 可自主承担

- 旧系统映射建议。
- 新旧接口桥接建议。
- 迁移顺序规划。
- 回归风险分析。

### 风险

- 过早切入 Java 或游戏主循环会把平台拖回大量领域特定细节，必须晚于平台核心成熟。
- 如果没有增量替换路径，跨领域扩展会重新变成整仓重写项目。

## 阶段 H：终局平台面

### 目标

- 形成完整的工程编译基础设施层。
- 让上游规格、下游运行和平台治理最终形成统一闭环。

### 进入条件

- 多项目、多团队、多栈、多升级周期已经被证明可稳定运行。
- 图谱、策略、验证、升级、审计都已有可运营基线。

### 当前阶段拆分

- H1：上游 authoring 与治理。
- H2：中游编译与修复编排。
- H3：下游 artifact、deploy、observe 闭环。
- H4：平台运营、市场与审计层。

### 终局能力

- 上游：
  - spec-first authoring。
  - block graph editing。
  - policy and slot authoring。
- 中游：
  - compiler pipeline。
  - alignment / synthesize / repair passes。
  - upgrade and migration engine。
- 下游：
  - repo artifact。
  - provenance。
  - acceptance and policy reports。
  - deploy and observe hooks。
- 平台：
  - official + private registry。
  - marketplace。
  - audit and governance。
  - visual graph。
  - hosted verification。

### 连续功能切口

- 切口 A：上游建模体验。
- 切口 B：中游编译调度与预算控制。
- 切口 C：下游部署与观测接入。
- 切口 D：平台层审计、市场与权限治理。

### 验证口径

- 多团队多项目长期运行数据。
- hosted verification 与本地验证结果一致性。
- 审计链、变更链、升级链可追踪。

### 退出条件

- 平台可以稳定支持多个项目、多个团队、多个栈、多个升级周期。
- AI 的主要职责已经收敛为：对齐、综合、修复、迁移、解释，而不是从零写整仓。
- 人类只需要在关键审批点介入，而不是接管日常编译细节。

## 阶段 I：分层自举

### 目标

- 让工程编译器逐步用自身规格描述和维护自身外围，而不是一次性“自改核心”。
- 保持“外围先自举，核心最后自举”的保守路线。

### 进入条件

- 平台外围工具已足够稳定。
- provenance、graph、verification、权限边界已成熟。

### 当前阶段拆分

- I1：用规格描述 block、slot、acceptance、policy、registry metadata。
- I2：用平台生成与维护外围工具和报告。
- I3：逐步把外围工具 block 化。
- I4：最后才评估核心 pass 的自描述与受控迁移。

### 路线

1. 宿主语言实现内核：parser、resolver、composer、verifier、lock、权限边界继续由 TypeScript/Node 确定性实现。
2. 用工程规格描述官方 block、slot、acceptance、policy、registry metadata 和升级计划。
3. 用平台生成和维护文档视图、explain graph、报告、测试 harness、block scaffolding 和 demo 项目。
4. 将平台外围工具逐步迁移为自身 block：registry admin、upgrade center、policy center、verification dashboard。
5. 最后才评估核心 pass 的自描述、自测试和受控迁移。

### 默认执行顺序

- 先做 I1、I2。
- 再做 I3。
- 最后才触碰 I4。

### 验证口径

- 外围工具迁移后，输出与原实现一致。
- 自举生成的报告、视图、测试 harness 能稳定替代手工维护版本。
- 核心 pass 在未得到批准前始终保持宿主语言权威实现。

### 退出条件

- 平台外围能力可以由平台自身规格持续描述和演进。
- 自举只扩大维护效率，不削弱核心确定性与审计性。

### 不做

- 不允许系统直接无约束改写核心编译器。
- 不把自举作为 `v0.1-v1` 成功条件。
- 不用“自举”作为跳过验证和审批的理由。

## 阶段 J：自维护系统

### 目标

- 在 provenance、observability、权限、回滚和验收成熟后，让系统对项目进行有限自诊断、自修复和自升级。
- 把自维护限制在可审查、可回滚、可预算控制的边界内。

### 进入条件

- 失败诊断已经稳定映射到 spec/composition/slot/kernel 四类问题。
- repair/upgrade/override 已有成熟权限模型。
- 审计链与回滚链已跑通。

### 必备前提

- 可观测：构建、测试、运行、验收、用户行为和错误都能回到 graph/provenance。
- 可诊断：失败能映射到 spec issue、composition issue、slot issue 或 kernel issue。
- 可执行：repair / upgrade / override 都有明确权限、写入范围和预算。
- 可回滚：migration、compose、override 和生成产物都有恢复路径。
- 可审计：每次 AI task、人工 override 和升级决策都能解释。

### 当前阶段拆分

- J1：诊断闭环。
- J2：执行预算与审批模型。
- J3：冷路径与温路径自修复。
- J4：受控自升级。

### 连续功能切口

- 切口 A：诊断：
  - failure focus 视图。
  - root cause 分类。
  - 自动建议下一步。
- 切口 B：权限：
  - 写入预算。
  - 批准门槛。
  - 热路径阻断。
- 切口 C：执行：
  - slot repair。
  - policy 调整建议。
  - 文档/报告自更新。
- 切口 D：升级：
  - 受控 rollout。
  - 自动回滚条件。
  - 审批后执行。

### 默认边界

- 自维护优先处理冷路径和温路径：slot 修复、policy 调整、验收补齐、文档/报告、升级计划。
- 热路径、核心编译器、基础设施权限和数据迁移必须保持人工审批。

### 验证口径

- 自修复必须保留前后 diff、验证结果和回滚点。
- 自升级必须在受限环境先通过 verify/lock/explain。
- 审批边界不可被自动流程绕过。

### 退出条件

- 系统能在无人工逐文件介入的情况下处理一批低风险问题。
- 所有自动执行都能被解释、回放、回滚、审计。
- 人类只在真正高风险决策点介入。

### 风险

- 如果缺少预算、审批和热路径阻断，自维护会重新退化成高风险自动改仓库。
- 如果没有稳定 root cause 分类，自维护只会制造更多噪音任务。

## 阶段 K：产品线、组织与 Reality Compiler 研究线

### 目标

- 把平台从“单项目编译器”推进到“产品线编译器”和更长期的组织编译器研究线。
- 维持研究线与当前工程承诺之间的明确边界。

### 进入条件

- 多项目、多团队、多栈平台已经稳定。
- 自维护能力已有可审计的安全边界。

### 当前阶段拆分

- K1：产品线编译器。
- K2：组织编译器。
- K3：Venture / Reality Compiler 研究线。

### 产品线编译器

- 目标：
  - 编译一族同源产品。
  - 管理行业包、客户包、差异化配置、override、版本矩阵和升级策略。
- 连续切口：
  - 变体模型。
  - 产品线升级矩阵。
  - 共性块与差异块治理。
- 完成定义：
  - 同一产品线中的多个项目可共享大部分规格、块与升级资产。

### 组织编译器

- 目标：
  - 把角色、权限、流程、审批、数据对象、agent 和软件界面编译成组织协作系统。
- 连续切口：
  - 组织角色模型。
  - 审批与流程 DSL。
  - 组织级 policy/agent 编排。
- 完成定义：
  - 组织配置变化可稳定映射到系统行为与界面装配。

### Venture / Reality Compiler

- 目标：
  - 把商业想法或现实目标转化为软件、agent、人类角色、流程、外部服务和反馈回路组成的行动网络。
- 连续切口：
  - 目标建模。
  - 反馈回路建模。
  - 外部系统接入边界。
- 默认边界：
  - 该方向只作为长期研究与产品想象，不进入当前工程承诺。

### 默认执行顺序

- 先做 K1。
- 有稳定产品线资产后再评估 K2。
- K3 只保留研究，不进入当前交付承诺。

### 验证口径

- 产品线编译器需先证明多变体复用收益。
- 组织编译器需先证明流程/权限/界面可由统一规格驱动。
- 研究线只记录模型与原型，不绑定当前主仓里程碑。
## 新增整合：采用与影响路线

### 早期采用

- 目标用户：重复构建后台、管理台、B2B SaaS、小型内部平台的小团队。
- 默认交付物：可运行母例、官方块、CLI、验收、explain 报告和源码下钻。
- 成功标准：用户能在不理解全部长期愿景的情况下完成一次可信编译和一次局部修改。

### 中期采用

- 目标用户：需要维护多个相似项目、多个客户变体、私有组件和团队 CI 的组织。
- 默认交付物：私有 registry、policy gate、upgrade center、provenance、graph explorer 和 review assist。
- 成功标准：团队把块、规则、验收和升级当作资产复用，而不是复制项目源码。

### 长期影响

- 软件项目从一次性手工工程变成可组合、可编译、可验证、可持续演化的产品线资产。
- 新需求会集中在高质量功能块、行业块包、验收套件、规格工程师、项目变体管理、自维护服务、AI 成本压缩和企业软件现代化。

## 当前优先级矩阵

### 必须先做

- `v0.1` 闭环
- provenance 预留
- upgrade 入口
- graph / explain 基础能力

### 可以晚做

- marketplace
- 托管运行时
- 第二目标栈
- Java 和游戏扩展

### 现在不要做

- 全领域通吃承诺
- 自由 chat 式整仓生成
- 社区整块自由贡献

## 关键决策门槛

### 什么时候能从 B 进 C

- 首条闭环稳定重复运行
- 单槽位边界未被破坏
- 验收可以稳定裁决成功与失败

### 什么时候能从 C 进 D

- provenance 成型
- upgrade 有第一条通路
- 官方块已形成最小母库

### 什么时候能从 D 进 E

- 团队可在 CI 中稳定使用
- review / explain 与 policy gate 可用

### 什么时候能从 E 进 F

- 单栈平台已证明不是一次性脚手架
- 多项目、多版本、多升级周期都可控

## 总体风险

- 方向风险：
  - 把平台做成模板市场或 Skill 壳
- 范围风险：
  - 在 `v0.1` 前引入多栈、多块、多 slot、多治理
- 信任风险：
  - 没有 provenance、双视图和 acceptance graph
- 生态风险：
  - 官方块未稳定就开放社区整块代码
- 架构风险：
  - 没有 compile contract，导致每加一个目标栈都要推倒重来

## 路线摘要

- 短期看，先证明“工程规格 -> 块安装 -> AI 填 slot -> 通过验收”。
- 中期看，要补齐 provenance、upgrade、graph 和私有 registry，证明这不是一次性脚手架。
- 长期看，目标不是做另一个 runtime，而是做 AI 时代的软件工程编译层。
