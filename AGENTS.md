# SEC 仓库与设计入口

先核当前用户目标、授权对象与必须保持的结果。SEC-086 是目标设计；现有代码、测试和工作记录提供实现事实与迁移义务，不反向覆盖设计。文档身份与当前位置由[当前身份表](.documentation/documents.json)定位，规范责任由实际正文承担；本入口不拥有产品规则，不签发作用或完成权限。

首次进入、恢复或不能确认同版规则已实际读取时，完整读取[产品要求](docs/产品/产品要求与工作约束.md)与[根原则](docs/产品/原则总纲与归属.md)，按本次动作核相交条目。设计维护读取[任务规则](docs/维护/设计任务规则.md)；整体架构从[总体设计](docs/架构/总体设计.md)开始，具体任务沿[任务路线](docs/任务路线.md)与[主题导航](docs/README.md)找到真正拥有者、消费者、理由和未决。已经取得同版内容后复用相交读取，不预读所有规范或依赖聊天记忆。

写docs前先过[规范文档写入准入](docs/维护/规格写作与完整性.md#documentation-write-admission)：实现、测试、重构、文件布局、提交或一次运行事实没有改变稳定公共合同、架构责任、长期保证、理由或未决时，**docs写集保持为空**。只有真实规范语义变化才回到唯一正文，并同步相交结构、来源、图、代码围栏、身份与实际消费者；独立机制、反例、代价及恢复责任不得因整理丢失。完整规则见[文档架构](docs/维护/文档架构.md)与[来源保全](docs/维护/组织修改与来源保全.md)。`.documentation`只在源文档实际变化后机械刷新；当前内容摘要在[基线](.documentation/baseline.json)，`bun run docs:doctor`检查文档制品与独立能力台账；摘要与静态检查不证明实际采用、运行或全部语义正确。

## 工作追踪身份

仓库工作的身份层级由[工作追踪合同](config/repository/work-tracking-contract.json)固定。G 是根目标，U 是稳定问题主题；两者都不是开发 task、GitHub Issue 或进度单位。当前实施顺序由正式实施主链选择，协同范围由工作组表达，真正可执行且有作用边界的工作由 Active Work Package/operation 承担，commit、branch、PR 和 Evidence 只证明或运输相应结果，不反向创造工作身份。

新增 U 只允许记录现有 U 无法容纳的独立义务；同一问题的新反例、来源、消费者或实现缺口回写原 U，不为“看起来还有工作”增加编号。任何进度汇报都必须给出当前主线交付、活动工作组或 Work Package、已闭合/仍开放的相交义务、绑定修订证据与阻塞；不得把 U/G/branch/commit 的数量或“还剩多少 U”当完成率、任务数或燃尽指标。

完整机制变更先遵守[完整变化的一次闭合](docs/维护/规格写作与完整性.md#complete-change-closure)；实现命名消费[实现命名与上下文压缩](docs/维护/设计任务规则.md#实现命名与上下文压缩)，命令面消费[命令名称、长运行与可恢复执行](docs/开发/工具协议/README.md#命令名称长运行与可恢复执行)。再按短时工具预算实施；不以局部PASS或文件存在代签全链完成。规范写入准入也覆盖原文的真实错误与遗漏，不是“没有代码变化就不许修文档”。权威/投影/缓存与源包/制品身份消费[唯一身份域合同](docs/维护/文档身份与重组协议.md#documentation-identity-domains)；不得为生成器或旧缓存改写权威输入。

## 仓库实施与恢复

下列入口消费[仓库开发准入与恢复](docs/开发/AI协作/规则装载与任务恢复.md#sec自身仓库开发的行为准入工作身份与恢复)的实现接合，不要求所有SEC目标工程复制本仓库控制面。

1. 新任务、续跑、压缩恢复与实施前先运行`bun run work:status -- --json`，绑定live main、exact candidate、工作区、活动Work Package及有效operation。按机器返回的continuation route继续；unresolved/invalid只阻断依赖它的动作并报告typed blocker，不能由PR、branch、聊天或测试绿色补足权限。
2. 写入前核唯一写者、前像、dirty归属及并发。保护用户和无关工作，不reset/stash/restore/格式化/清理或纳入交付。当前用户授权决定提交、推送、合并、发布、安装和删除的作用上限，scope/envelope与实际Effect admission分别约束具体执行。用户已明确授权仓库终态后，该义务持续到settlement/readback；默认分支保护拒绝直推时，自动转入同内容的最小branch→PR→Gate→merge通路，不等待重复授权。force、改保护、额外发布等扩大作用仍须另行授权。
3. 从可观察终态做删除反事实，判断保留对象的独立价值、真实消费者、失败恢复、并发、资源、外部能力、迁移及验证成本。原生Git/compiler/provider等成熟能力按最窄稳定接口使用；展示、路径、摘要、caller字段和测试seam不创造事实或权限。
4. 一个logical run保持一个mutable candidate。只有独立结果与owner/文件边界明确、并行有实际收益时委派；子任务权限只收窄，主线程保留授权、架构裁决、集成、验证和收口，不能让多个writer修改同一owner。
5. 编辑期执行最小有效哨兵；frozen对象才生成昂贵证据。执行集合按`RequiredClosure ∩ MissingOrStale`选择，同一ActionKey的fresh PASS、确定性失败及authenticated in-flight分别复用、停止该失败路径及join。证据只证明其绑定对象与环境。
   **Hosted evidence budget 是硬约束：**GitHub Actions、Default CodeQL及其他托管CI只用于最终候选上无法由本地/静态等价证明的必要证据，不用于探索、问题定位、试错、逐步调参或“看看结果是否变化”。在创建/更新会自动触发hosted检查的PR前，先在process candidate中穷尽适用约束、静态source→sink审查、owner/consumer/ownership、生成投影和focused本地证据，并冻结最终tree；随后只生成一次满足集成形状的clean candidate。同一revision、input、environment与ActionKey已有fresh evidence时必须复用，禁止重复dispatch/rerun。只有新的不可等价事实使既有evidence失效时，才支付新的hosted执行成本。
6. 失败先定位owner、失效前提、影响闭包和恢复入口，不用扩大timeout、切换Provider、删测试或重复运行绕过。反证使旧计划失效，修正相交唯一owner；无关且安全的工作继续。实现迁移、独立审查与真实发布按其自身合同处理。
7. 作用后取得真实settlement/readback；merge后重新绑定new main与新一代权限，完成声明区分设计、源码、局部测试、受信Gate、远端入库、合并与branch/worktree/runtime残留。辅助工作树先用generated-state/compiler-dependency退役与`worktree-physical-closeout`结算受管locator，不把`git worktree remove`当完整清理；旧操作责任不因换attempt、新提交或删除配置而消失。

上述机器载体的实现与当前状态以各自producer/consumer、原生能力和回读为依据。Skill只保留有界判断规则；文件存在不证明进程已加载或未来行为符合。规则投影或当前作用权限不能确认时保留相交unknown，不自报已完成。
