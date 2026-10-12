# Gift 仓库与设计入口

## 开放语义与采用边界

领域/业务 Meaning 由唯一 Definition 拥有；[抽象与开放定义](docs/20-语义与组合/组合/抽象与开放定义.md#gift-abstraction-calculus)保留共同结构、独特差异及观察、规范、权限边界。Intent、Method、Target、Effect、Claim 分属其实际 owner。只有现有构造不能保持的可检验跨域差异才能触发核心晋级。增加Schema、案例或章节不证明产品资格。


现行设计文档的语义主张按[规范表述与无损收敛](docs/90-治理与参考/维护/规格写作与完整性.md#semantic-claim-editing-contract)审查；历史版本文字不覆盖现行 owner。

收到“全工程设计/落地设计”请求时，不以增加一个规范断言或总架构名代替施工成果。当前包的作者源码、文档、样例只有一份；按任务阅读使用当前目录、主题导航和正文链接定位，不再打包独立精简工作集，也不把检索投影当作新写源。先由[工程构造手册](docs/70-工程系统与演进/工程构造手册/README.md)取得准确模块源、API、数据关系、算法、状态/失败/恢复、消费者与验收，然后与各自当前语义owner核对。**施工设计改进**可以独立于公共语义变更进入工程文档；实现完成或CI运行事实仍由真实代码/证据承担。不得为了“落地”暗中获得执行、文件写入或发布权限。

本目录是离线设计候选，不是完整可执行仓库。当前成员是专业规范、必要 Schema/JSON 设计示例、研究说明、来源和许可；根 README 说明实际结构。本包不含可执行工具、包内成员 manifest 或 `_meta/` 目录。交付字节核对与比较材料保存在包外，不成为理解设计的前置。reader、Contract Unit locator、查询索引及重型文档/章节/链接分析视图都在包外按需生成。仓库 dev 命令与实施准入只在真实仓库存在并由当前版本定义时消费；本文不授权为阅读/设计而运行产品、安装、推送或使用历史权限。

先核当前用户目标、授权对象与必须保持的结果。**当前采用配置选中的 canonical owner 正文共同构成目标设计；需要跨容器稳定引用的规范闭包使用显式 `gift-unit-*` Contract Unit，物理路径只负责当前定位。** 历史交付号、归档名、旧包、分支、PR、聊天、代码、测试和工作记录只能提供对应版本的事实、来源与迁移义务，不反向覆盖当前设计。包名、交付字节摘要、来源记录和派生索引都不签发规范权威。规范责任由实际正文承担；本入口不拥有产品规则，不签发作用或完成权限。

首次进入、恢复或不能确认同版规则已实际读取时，完整读取[产品要求](docs/00-系统与原则/产品/产品要求与工作约束.md)与[根原则](docs/00-系统与原则/产品/原则总纲与归属.md)，按本次动作核相交条目。设计维护读取[任务规则](docs/90-治理与参考/维护/设计任务规则.md)；整体架构从[总体设计](docs/00-系统与原则/总体架构.md)开始，具体任务沿[任务路线](docs/00-系统与原则/导航/任务路线.md)与[主题导航](docs/00-系统与原则/导航/主题导航.md)找到真正拥有者、消费者、理由和未决。已取得同版内容后复用相交读取，不预读所有规范或依赖聊天记忆。

写docs前先过[规范文档写入准入](docs/90-治理与参考/维护/规格写作与完整性-方案名称与实际控制的同步.md#documentation-write-admission)：实现、测试、重构、文件布局、提交或一次运行事实没有改变稳定公共合同、架构责任、长期保证、理由或未决时，**docs写集保持为空**。只有真实规范语义变化才回到唯一正文，并同步相交结构、来源、图、代码围栏、身份与实际消费者；独立机制、反例、代价及恢复责任不得因整理丢失。完整规则见[文档架构](docs/90-治理与参考/维护/文档架构.md)与[来源保全](docs/90-治理与参考/维护/组织修改与来源保全.md)。本离线包直接运输可读 Markdown 作者源；查询索引和审计投影从 SourceProfile 按需生成到包外。真实仓库若有额外文档检查命令，按其当前版本与真实消费者使用。摘要、索引与静态检查都不证明实际采用、运行或全部语义正确。

## 工作追踪与当前前沿

工作追踪只保存会改变下一步行动的当前事实，不维护一份永久“问题编号历史”。根目标说明为什么做；未决义务说明还缺什么及哪个 owner/consumer 受影响；真正可执行且有作用边界的工作由 Active Work Package / Operation 承担；commit、branch、PR、Issue 和 Evidence 只证明或运输对应结果，不反向创造产品身份、设计义务或完成状态。

同一未决的新反例、来源、消费者或实现缺口回到原 owner 更新，不为了“看起来还有工作”创建新的编号。已闭合的问题由其 canonical 规则、代码或 Evidence 承接，状态页不再复述历史结论。进度汇报给出当前主线交付、活动 Work Package / Operation、已闭合与仍开放的相交义务、准确修订证据和阻塞；branch/Issue/commit/历史问题数量都不是完成率。

正式仓库若现有版本仍实现旧 tracking carrier，只按该版本的兼容实施事实消费；它们不能成为新设计必须拥有的概念，也不能要求 current canonical 维护第二份历史问题账本。迁移或退役时先保全仍有真实消费者的责任，再让旧 carrier 随消费者归零退出。

当前跨 owner 的实现、接入、资格和现实证据统一从[实施闭包](docs/90-治理与参考/状态/实施闭包.md)读取；旧 `U###` 不属于当前 source package，也不作为任务队列。新增工作若已有 owner 就更新同一闭包，不再重新发行历史式问题号。

完整机制变更先遵守[完整变化的一次闭合](docs/90-治理与参考/维护/规格写作与完整性-方案名称与实际控制的同步.md#complete-change-closure)，再按短时工具预算实施；不以局部 PASS 或文件存在代签全链完成。规范写入准入也覆盖原文的真实错误与遗漏，不是“没有代码变化就不许修文档”。权威/投影/缓存与源包/制品身份消费[唯一身份域合同](docs/90-治理与参考/维护/文档身份与重组协议.md#documentation-identity-domains)；不得为生成器或旧缓存改写权威输入。

## 真实仓库获准实施时的进入与恢复

以下规则仅在另行获得真实仓库实施授权、相应工具和 producer/consumer 实际存在时适用；本设计包不能执行这些命令。下列设计入口从[原生维护的仓库控制面](docs/80-开发者与接口/原生维护/README.md)按 authority/lifecycle 路由到相应 owner；它们只服务 Gift 自身仓库的 self-hosting 实施，不要求任何使用 Gift 的目标工程复制这些控制面。

1. 新任务、续跑、压缩恢复与实施前按[源码检查点与正式采用的分流](docs/80-开发者与接口/原生维护/源码检查点与正式采用分流.md#source-checkpoint-publication)选择`dev:status`入口。正式工作绑定live main、exact candidate、工作区、活动Work Package及有效operation；已明确授权的独立源码检查点使用`--source-checkpoint --base <exact-sha> --expected-head <exact-sha> --owned-path <exact-path>`观察固定源码范围，不要求先恢复正式Work、MainHealth或Gate。两路状态都只给continuation，不签发作用权；unresolved/invalid只阻断依赖它的动作，不能由PR、branch或测试绿色补足权限。
2. 写入前核唯一写者、前像、dirty归属及并发。保护用户和无关工作，不reset/stash/restore/格式化/清理或纳入交付。当前用户授权决定提交、推送、合并、发布、安装和删除的作用上限，scope/envelope与实际Effect admission分别约束具体执行。用户已明确授权仓库终态后，该义务持续到settlement/readback；默认分支保护拒绝直推时，自动转入同内容的最小branch→PR→Gate→merge通路，不等待重复授权。force、改保护、额外发布等扩大作用仍须另行授权。
3. 从可观察终态做删除反事实，判断保留对象的独立价值、真实消费者、失败恢复、并发、资源、外部能力、迁移及验证成本。原生Git/compiler/provider等成熟能力按最窄稳定接口使用；展示、路径、摘要、caller字段和测试seam不创造事实或权限。
4. 一个logical run保持一个mutable candidate。只有独立结果与owner/文件边界明确、并行有实际收益时委派；子任务权限只收窄，主线程保留授权、架构裁决、集成、验证和收口，不能让多个writer修改同一owner。
5. 编辑期执行最小有效哨兵；frozen对象才生成昂贵证据。执行集合按`RequiredClosure ∩ MissingOrStale`选择，同一ActionKey的fresh PASS、确定性失败及authenticated in-flight分别复用、停止该失败路径及join。证据只证明其绑定对象与环境。
   **Hosted evidence budget 是硬约束：**GitHub Actions、Default CodeQL及其他托管CI只用于最终候选上无法由本地/静态等价证明的必要证据，不用于探索、问题定位、试错、逐步调参或“看看结果是否变化”。在创建/更新会自动触发hosted检查的PR前，先在process candidate中穷尽适用约束、静态source→sink审查、owner/consumer/ownership、生成投影和focused本地证据，并冻结最终tree；随后只生成一次满足集成形状的clean candidate。同一revision、input、environment与ActionKey已有fresh evidence时必须复用，禁止重复dispatch/rerun。只有新的不可等价事实使既有evidence失效时，才支付新的hosted执行成本。
6. 失败先定位owner、失效前提、影响闭包和恢复入口，不用扩大timeout、切换Provider、删测试或重复运行绕过。反证使旧计划失效，修正相交唯一owner；无关且安全的工作继续。实现迁移、独立审查与真实发布按其自身合同处理。
7. 作用后取得真实settlement/readback；merge后重新绑定new main与新一代权限，完成声明区分设计、源码、局部测试、受信Gate、远端入库、合并与branch/worktree/runtime残留。辅助工作树先用generated-state/compiler-dependency退役与`worktree-physical-closeout`结算受管locator，不把`git worktree remove`当完整清理；旧操作责任不因换attempt、新提交或删除配置而消失。

上述机器载体的实现与当前状态以各自producer/consumer、原生能力和回读为依据。Skill只保留有界判断规则；文件存在不证明进程已加载或未来行为符合。规则投影或当前作用权限不能确认时保留相交unknown，不自报已完成。

## 分支、CI 与 session-resilient 生命周期

Gift 自身仓库把 **Git branch 当代码演进路线，把 CI/Actions 当执行与证据载体**，两者不互相代替。正式产品变化使用 `feat/*`、`fix/*`、`refactor/*`、`docs/*` 或 `chore/*`；大型未知架构探索使用 `spike/*`，默认不得把整个 spike 直接合并，验证成立后提炼正式变化；只有两条真实、并行且规模较大的产品演进线需要承担总装风险时才建立临时 `integration/*`；`validation/*`、`diagnostic/*` 只承载验证/隔离/日志证据，默认不合并。suite 分片、参数矩阵、一次性探针由 workflow/job/matrix/artifact 承担，不创建长期 `validation/case-*`、`final-exact-*`、`current-*` 分支。

进入 `main` 的变化必须同时满足：仍是有效正式产品/维护结果；当前 `main` 尚未包含其有效结果且未被后继实现替代；与当前权威架构一致或同步修正文；实际所需 Gate 通过；无未解决 review thread 或有效 `REQUEST_CHANGES`；已理解 base/head/merge-base、冲突和 squash 后“内容已进入”与“commit ancestry 已进入”的差别；不混入 probe、日志采集驱动、旧 snapshot 或无意生成物漂移。大型 integration 历史含大量实验噪声时，验证最终 tree 后优先 squash。满足门禁就及时收口，不为制造“持续开发”继续无证据修改。

PR/分支完成后确认产品结果真实进入目标分支，关闭废弃/镜像/probe/diagnostic PR，权限允许时删除使命完成的远端 head/临时分支，退役一次性 workflow/探针并复核 open PR/Issue 与 CI。不得保留只能靠历史聊天解释用途的活动结构。

所有长时间、易中断、远程或有副作用的执行默认采用 **session-resilient** 语义：把 durable identity、exact subject/revision、输入摘要、effect key、settlement/readback 和 continuation 写入其原 owner；单次工具调用有界，避免依赖长连接；超时、断流、未知响应首先按 operation identity 读回，确认是否已发生，再决定 join、恢复、补偿或新 attempt，禁止把 UNKNOWN 当失败后盲目重发。并发只用于真正独立的 owner/写集，一个 mutable candidate 保持单写者。

本地可等价验证的事实先用本地原生工具取得；Docker、远端 runner 和 hosted CI 只有在目标环境本身构成被验证语义或本地不能等价证明时才进入，不把容器/云执行当仪式性前置。类型错误、静态路径错误、格式/生成差异等可在本地确定的问题不得用 hosted CI 做调试循环。

## 研究输入的同包接入

普通实现查询先使用 canonical；设计发现、比较、反证和取证任务主动使用 research 或分组 all，读取[研究与规范接合入口](research/README.md)及相交完整资料，不只看来源标题。领域/理论/组合/挑战研究用于发现、解释、反证和已有方案复用；研究内的历史类型、拟定接口、验收语句不自动变成当前规范或运行记录。相交当前 owner 承担采纳、修正、保留候选或反证的裁决；未采用但有独立内容价值的资料继续保留并可从当前问题进入。保留资料不等于安装或执行资料中的命令。

读取范围与记录修改遵循[知识记录与分域检索](docs/90-治理与参考/维护/知识记录与分域检索.md)。不把生成阅读页和 JSON 源重复装载为两份证据，不在同一未分域候选池中靠相关度决定规范权威；带父上下文取得场景和反例。读取器未接入该范围协议时明确限制，不能仅靠本文存在自报已隔离。
