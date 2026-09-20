---
title: 动态工程控制面
status: active
domain: current-control
last-reviewed: 2026-09-20
---

# 动态工程控制面

- `current-state.yaml` 只保存 resolver 配置和跨候选稳定的 authority 入口。
- `rolling-plan.md` 只保存一个当前包和二至五个条件候选；候选不是授权。
- `active-work-package.md` 只保存 frozen manifest path 与 raw Git blob digest。

持久工作身份/current spec归既有Issue或canonical machine owner，长期依赖归work-selection catalog，#221
`WorkDecision`拥有eligibility/priority，#207/#349拥有order/conflict，rolling plan只投影结果。
发现新问题时先做existing identity/owner census；命中则同步原identity，不能用聊天、comment recency、
AI评分或新增计划文件重建下一步。Phase C writer切换前，人工rolling更新必须标明A0 reconciliation；
切换后由trusted document-control进程从exact main重新运行#221 live adapter，只接受manifest
`id + tracking`与`select-next`一致的generated projection；receipt文件本身没有写authority，投影不一致
返回`reconcile`/`unresolved`。normalized近端记录只内嵌在canonical `work-selection.md`，不得另建计划或
registry文件。选中manifest保留到下一decision消费，下一纵切片再删除旧manifest和已消费catalog item。
effectful freeze必须运行clean trusted-main脚本，并用`--workspace`显式指向物理隔离、attached到非default
branch的候选；branch前缀只是locator命名习惯，不参与authority判断。rolling-plan的WorkDecision、
committed-candidate replan与MainHealth repair由同一typed projection union和全文renderer生成；
标题、prose、JSON与digest不能分开维护；committed replan只消费exact HEAD/tree与source control raw
bytes digest，不复制旧projection digest或旧prose；
直接运行候选修改过的控制脚本不能给候选授权。

当前 Git、PR、CI、Review 和 resolver 状态在运行时生成，不写入稳定架构文档。
仓库只保留 pointer 当前引用的一个 Work Package manifest；下一任务原子替换 pointer 与 manifest，
不能累积历史包。pointer 引用的同字节 manifest 已进入 default branch 时，resolver 返回
`none/matching-default-blob`，表示没有活动候选。历史、差异、Review、Evidence 和恢复由
Git commit、PR、Issue 与 Actions artifact 承担，`docs/`只允许当前设计源。

Proposal 的 `retirementTarget` 是不可物化 tombstone identity，不是文件搬迁目的地。
迁移和 readback 完成后，proposal record 与源文件从当前树删除；corpus census 拒绝
实际落盘的 archive path，也拒绝 Evidence/Superpowers 叙事 Markdown 回流。

默认分支变化要求重新绑定候选基线和相交准入；Review、Action Evidence 和 manifest key
分别按其实际绑定输入与策略判定失效，不把未变的独立内容证据机械作废。树相同也不代签
历史敏感构建、权限、main-only检查或merge authority。即使变化已经进入`main`，只要缺少
可验证merge authority，也必须登记incident并按新主干重新裁决；不得用“main已包含”抹掉
来源缺陷，也不得静默force-reset。平台级禁止admin bypass由Issue #279独立闭环，未完成
ruleset readback前不得声称GitHub物理保护已经成立。

已合并 Work Package manifest 在 pointer 仍指向它时保持 `conditional`；repository audit
使用 trusted exact base 区分 default branch 上的惰性当前记录与 active candidate。该记录不获得
产品 authority，也不能被复制为第二份历史目录。

<a id="work-tracking-and-fulfillment"></a>
## 工作追踪与进度裁决

本节拥有上述现有控制面的追踪、完成判断及报告接合设计，不再创建任务数据库、第二roadmap、通用资源管理器或另一套Evidence authority。产品目标、能力和领域算法仍由其原规范拥有；这里规定如何消费它们而不把主题、活动和成果混为一谈。

**交付层级：本节是实施设计，不是实现或执行证明。** `work-tracking-contract.json`中的角色标签是兼容中的描述性约定，不因存在`progressUnit:false`就约束了真实报告。只有解码、真实输入接合、裁决、输出消费者和必要的迁移均具备相应证据，才可声明对应强制能力。发现实现损坏时，设计结果继续有效，运行声明必须保留阻塞。

### 1. 目标与不引入的东西

系统应直接回答：当前接受了什么结果；哪些义务属于它；谁正在处理；哪些结果已取得；什么依据支持哪一项关闭；还缺什么；为何轮到下一项；改变范围或证据后哪里需要重开。回答必须能从原记录重算，不能依赖某次聊天解释。

不以U数量、提交数、分支数、文档篇幅、任务拆分数或检查器数量证明产品进度。不追求这些数字一律归零。数字可作库存、变化量和开销诊断，不能未经可比性与目标论证冒充完成率、生产率或收益。

不把所有纯阅读、设计和短代码任务强制装入生产发布流水线。需要的身份、条件和证据可由已有记录引用；只有当前动作所必需的信息进入请求，显示层允许简洁，不丢影响判断的未知和条件。

### 2. 已有权威与消费者接线

| 信息或决定 | 当前拥有者 | 本设计的接合，不新增其副本 |
| --- | --- | --- |
| 已接受用户要求与原则 | `docs/产品/产品要求与工作约束.md`、`原则总纲与归属.md`及当前有效授权 | 取得适用范围及修订；工具建议不升级为用户命令 |
| 根目标、U主题、关闭与重开条件 | `docs/状态/前沿与登记规则.md`及五个分题正文 | 双向引用，不把主题标题转为任务实例 |
| 产品实施主链、能力前置和激活 | `docs/演进/实施/主线前沿与准入.md`及其指向的唯一能力正文 | 使用语义引用；工作组、阶段表是视图，不复制另一份主线 |
| 具体工作及current spec | 既有GitHub Issue或已确认canonical work owner | 绑定仓库、原生对象身份和实际版本；Issue可是真实工作规范，不被一概降为镜像 |
| 候选目录及选择 | `work-selection.md`；`src/adapters/self-hosting/control/work-selection/contract.ts`、`live-contract.ts`、`runtime.ts` | 原catalog、WorkDecision、CurrentSpecObservation和RegistryObservation继续负责 |
| 活动包、候选和规则冻结 | `active-work-package.md`、`rolling-plan.md`及document-control owner | 同一控制切面绑定manifest、选择回执与候选；不手工盖章 |
| 必需验证、Action状态及现场保证 | 各自required-closure、Action Journal、Assurance、VerificationSession和MainHealth owner | 消费原回执；本投影不重选测试、不签发PASS或merge许可 |
| 分支、工作树、provider及物理残留 | 各自branch-lifecycle、worktree、generated-state和resource owner | 只引用生命周期回执；报告者无删除权 |
| 人机进度显示 | 在既有WorkSelection/continuation输出中派生的完成投影 | CLI、JSON、报告和Issue更新引用同一裁决；不手工维护done百分比 |

`SecWorkCurrentSpecObservation.providerState`是平台状态，不是任务满足证明。`scopeClosure`表示选择输入中的范围判断，不是完成证据。`reproductionOrEvidenceFreshness`必须追溯其观察，不能靠一个`fresh`字符串自证。上述区别必须进入真实解码和消费路径，而非只写注释。

### 3. 身份、地址、版本与角色

G回答目标；U保存稳定问题主题；Requirement/Obligation表达必须满足的具体条件；Delivery把当前承诺组织为可验收成果；Work Package组织一次有边界的工作；Attempt记录实际尝试；Evidence保存观察或论证；Verdict判断证据能否支持条件；Artifact承载结果。它们是不同语义角色，不要求每种角色建立一个服务、文件或全局编号。

当前`G01`、`U001`等是命名空间内的可读地址，不是行业标准。解析规则必须显式版本化；不将三位数、固定66项、U000保留或编号递增升格为任务语义。已有发布编号不得复用给另一含义；改名、移动、拆分与合并保留解析去向和有效修订。跨仓库引用至少携带repository identity，不能把两个仓库的Issue #398当同一对象。

稳定语义身份与位置分离。显示标题、文件路径、Markdown自动锚点、Issue number和branch可变；需要可靠追踪时绑定原生对象ID、document identity或稳定显式锚点与内容修订。路径能打开只证明定位，不证明含义、权威或新鲜度。不同格式的digest绑定其规定字节，不能以归一化后的相似文本替代raw Git blob要求。

新U的条件是已确认的独立关切不能在现有条目保持清楚的对象、机制、责任和关闭条件。新反例、消费者或平台可能扩大原U，也可能揭示独立机制；不能机械规定它们永远新增或永远不新增。没有方案也记录真实缺口；只有相似度或研究标题不能制造必做任务。并发分配在同一提交/版本前像下裁决冲突，不靠大家各取下一个整数。

### 4. 从目标到有限但不缩水的交付

一次交付固定目的、被接受的结果、适用对象、保留条件和允许动作。总体目标仍保留，当前切片不能偷偷缩小总体承诺；未进入本轮的独立义务必须有现有归属、激活条件或明确尚未选择状态。

叶义务必须能指出：要使什么条件成立、作用于哪个对象与输入域、何种证据足以支持它、失效会影响谁。若还不能形成可判断条件，保留为未分解/未知，不以模糊大标题参与完成率。分解的目的是可交付与可核对，不是增加任务数；一个自然必须一起完成的合同不能按段落拆成多个成绩。

采用有类型的关系：`requires-all`、`select-one`、`conditional`、`implements`、`checks`、`consumed-by`、`invalidated-by`、`supersedes`、`conflicts-with`及来源关联。仅有`related`不具有前置、覆盖或证明效力。选择一个OR分支须记录选择依据和适用条件；不能把全部备选同时设成必需，也不能在失败后无授权换掉要求。

子义务齐全不由图的形状自动证明。父义务还需覆盖论证和跨子项组合条件：共享资源、接口约束、竞争写源、上下游假设及完整用户路径。所有单元各自成功而组合失败时，父项不得变为满足。

### 5. 覆盖域、遗漏与反证

区分四种信息：已声明支持域；本轮实际检查域；已发现的未覆盖部分；检查方法不具发现能力的未知部分。只扫了若干文件不能声称全仓无旁路；覆盖了现有U列表不能声称所有可能问题均已登记。

全类控制声明需要从真实构造点、入口、调用关系和资源流取得消费者集合，纳入替代provider、生成代码、动态入口、测试专用通路与生产边界；数据不足的通路标未知。记录排除理由和边界，不以名称没出现证明机制不存在。普通具体任务只展开必要切片，但对其声称的全类性质必须取得相称的覆盖。

向下检查义务是否有工作、证据计划和真实消费者，向上检查提交、测试、制品和新增工作是否能解释其目标作用。查无目标的工作先判断为恢复/基础义务、有效独立发现或无消费者候选，不立即删掉，也不自动升为主线。

语义搜索、LLM建议和相似提交可提出关联候选，不能自动签发`satisfies`、`duplicate`或“无需实现”。保留最强反例、负依赖和共同原因；没有搜索结果时声明覆盖与取得限制。遗漏发现复用稳定快照，输入或前提变化后重新计算受影响部分，不每轮重新审计整个宇宙。

### 6. 完成不是一个可随意写入的布尔值

至少分开下列维度；内部表示可以复用已有类型，不必制造全局状态笛卡尔积。

| 维度 | 必须保留的区别 |
| --- | --- |
| 要求处置 | 已接受、已撤回、延期、被替代、经授权豁免 |
| 当前适用性 | 适用、不适用且有理由、条件未知 |
| 工作执行 | 未开始、执行中、暂停/阻塞、结算中、尝试终止 |
| 证据裁决 | 支持、反驳、证据不足、相互冲突 |
| 证据有效性 | 对象/前提相符、已过期、已失效、来源不可取得 |
| 交付结果 | 范围内满足、未满足、未能判定；采用/发布/退出另有真实状态 |

尝试结束不等于成果满足；Issue被关闭可能是完成、重复、取消或不计划；豁免不等于符合原要求；延期不等于成功；有权接受残余风险不把反例改成不存在。

设计交付按完整规格与相交设计审查结束；实现交付按真实代码与接合结束；行为保证、受信Gate、实际采用和收益各自需要证据。不能要求纯设计先部署才能完成，也不能把设计已定作为软件可用证明。

### 7. 证据与裁决的最小接合

每份用于关闭条件的证据可追溯到以下信息；若既有回执已经拥有，传其引用，不再复制一份台账。

- 被检查的subject identity/revision、条件及其版本、适用域与输入；
- 方法、方法版本、实际工具/配置/环境及足以影响结论的假设；
- 观察或结果、正反证、来源/producer、取得时间及需要的失效规则；
- 原始材料或可复核记录的定位、必要完整性校验、覆盖与未检查范围。

digest证明内容绑定，不证明内容真、工具无错或producer有权。签名证明特定签名者作出声明，不证明其结论正确。JSON中的`verified:true`、文件存在、检查名字和LLM自述不构成信任。持久证据进入原Assurance/Action信任链，不靠进程内WeakSet之外的伪造同形对象升级权限。

static inspection、syntax/schema/typecheck、模型证明、行为测试、真实平台观察和用户采用是不同方法。按条件选择足够证据；验证者与被验证者共用同一错误假设时不能称独立佐证。修改检查器时不得让候选检查器凭自己的新测试给自己发布可信通过；沿原信任基础取得独立静态审查或实际批准的验证。

新证据或反例追加到相应历史关系，不篡改过去在旧范围成立的结果。当前判定可因修订变化变为stale、unknown或refuted；原结果仍保留其历史适用范围。来源丢失、撤权、工具缺陷和负依赖变化都是可能的失效输入，不只检查源文件hash。

### 8. 关闭算法与空真防护

下面是既有WorkSelection与Assurance的接合算法，不是一个新的全局证明器。

1. 解析被接受的交付及其版本，取得当前允许的动作和范围。来源缺失返回准确unresolved，不从聊天补造。
2. 固定输入切面：相关Git对象、current spec版本、选择回执、策略与环境观察。混合新旧版本先reconcile。
3. 从交付根展开AND、已选OR和条件关系；未知条件不自动变成不适用。检查未解析引用、冲突、重复身份和覆盖缺口。
4. 对适用叶条件向原证据拥有者求裁决；证据不相符或未取得为unknown，不计通过。出现可靠反例则保留反驳。
5. 检查组合义务、在途责任、规定的退出条件及分解覆盖。硬前置环不通过删除任意边“修成DAG”；联合设计环形成可裁决组，运行等待环按运行owner处理。
6. 只有所需条件均满足、组合成立、无相交未知/冲突/反驳、所需结算和覆盖要求成立，才形成该范围的关闭判断。其他情况返回明确未满足或未能判定及其最小阻塞原因。
7. 生成可追溯投影。投影引用实际裁决，不修改原要求、Issue或资源；后续实际写入仍走原effect owner。

空catalog、读取失败后的空列表、尚未分解的根和0/0都不能得到100%。真正无工作或不适用必须由完整观察和相应规则作出明确结论；数学上的空集合真值不能代替工程上的范围已闭合证明。

### 9. 报告怎样直接回答“做了多少、还差什么”

报告消费同一投影，按问题显示必要信息，而不是每次填最大表单。询问当前进度时给出交付对象/范围、现有工作引用、实际新增成果、仍缺条件、证据层级和阻塞；询问分支数量时可以直接给完整库存，不强行转成产品进度。

库存指标允许包括G/U、工作、分支、提交、文件、字节和开销，必须带清点切面及完整性。成果指标按明确交付条件和可比范围定义，不能由这些库存数字推算。`已关闭k/n条件`只在有限集合、分解粒度和范围基线均明确时展示；它不是时间、价值或产品完成百分比。不同大小的条件不默认等权，不捏造权重来获得一条总进度条。

跨次比较分开报告：原范围内新增满足、回归/失效、新增义务、撤回或替代、证据补足及仍未知。拆分一个任务不会自动产生更多已完成成果；合并不会抹掉已满足的独立条件；共享义务按稳定身份去重，多个视图可引用同一证据但不重复计为多个物理成果。

总体主题长期存在并不妨碍其有限子义务闭合。反过来，关闭全部已登记叶项也只证明已声明和核对的范围，不自动证明未发现的问题不存在。总剩余没有完整分母时，必须显示“已确认剩余”和“覆盖尚未确认”，不能估造一个世界级总数。

### 10. 输入输出设计与真实接入点

拟在现有`work-selection/live-contract.ts`扩展一个只读完成投影，由`runtime.ts`装配真实观察；具体名字在同一次接口迁移中固定，不把下列设计字段当已发布API。

```text
FulfillmentInput
  deliveryRef + deliveryRevision + purpose
  selectedScopeRef + scopeRevision + decomposition/coverageRef
  exactSourceCut + currentSpecObservations
  workDecisionRef + criterionRefs
  evidenceVerdictRefs + lifecycle/settlementRefs
  coverageStatus + unresolvedSourceRefs

FulfillmentProjection
  subject/revision/purpose + scopeIdentity
  conclusions[criterionRef, applicability, verdictRef, remainingReason]
  deliveryVerdict + composition/coverageJudgmentRefs
  progressDelta[fulfilled, invalidated, added, withdrawn, unknown]
  sourceCut + dependencies + projectionDigest
  authority = observation-only
```

依赖关键字仅是语义槽，现有record持有信息时以引用取得。调用方不得直接传`allDone`、完成百分比或未经绑定的`closedObligations`让renderer照抄。renderer不得自己搜索、补证据、扩大权限或选择新的主线。需要写回Issue/rolling projection时，由既有owner比较原生前像并结算回读。

CLI、JSON、continuation、Issue同步和AI工作摘要分别检查其是否消费该投影。接入一个CLI不宣称所有客户端受控。LLM可以被提示遵守，但仓库文件不能物理约束任意聊天输出；可强制的边界限于实际接入的API、门禁和renderer。未接入消费者必须保留清单或精确覆盖缺口。

### 11. 自动选择下一工作而不吞掉产品

沿原W0—W7及WorkDecision推进：先恢复真实状态与已发生责任，再展开被接受结果的必要义务；区分硬前置、协同、顺序偏好和冲突。可选远程、数据库、GUI或高级语言不阻塞不依赖它们的普通任务；已被本次接受的全范围设计义务也不能因当前示例没用到就消失。

优先处理会使下一步建立在错误基础上的真实缺陷，然后选择能形成完整用户结果的就绪切片。正确顺序实现可以先闭合；只有明确独立写集、共同资源容量和合格consumer时才并行。工作组不是第二产品，branch不是任务，复制一个Work Package不能获得新预算或权限。

把active work、blocked work和未激活义务分开。设置在制品限制与期限须来自实际资源和约束，不复制某个方法论的固定配额。检查/研究成本与产品工作成本一起可见；同一稳定命题无新反例时复用，不把每次恢复变成全仓考古。父任务在子任务完成前退出，必须等待或完成明确接收的责任移交，不能靠摘要假装后台继续。

### 12. 并发、未知写结果与恢复

定义和静态设计保存在Git；具体工作可保存在既有Issue；动态观察和结算保存在现有runtime journal。只读投影可缓存且可重建，不成为第二事实来源。无需为本功能引入Kafka、RDF数据库、图数据库或新的中心调度服务。

发布过程固定intent/原输入版本，离权威ref构造候选，检查必要静态性质，然后使用服务原生的版本条件发布并回读。HTTP If-Match等条件写只在服务实际支持且作用域匹配时采用。GitHub普通`force:false`只保证fast-forward，不是expected-old-SHA CAS；前后read检查不能被称作原子锁。若中间发生并发推进，合并真实差异或重新生成候选，不覆盖并发成果。

超时后的写入状态为unknown-outcome；先回读同一目标再判断重试，不能重复发非幂等请求。已生成对象但ref没更新属于staged，不是已推送。远端包含提交也不证明main合并、受信Gate或实际采用。

恢复记录只保存不能从原生状态取得的最小信息：目标、输入修订、已发布边界、未知作用、未结责任和下一允许动作。部分分页、权限拒绝、缓存过期、来源不可见均保留准确unknown；不可见不能当不存在。离线可继续不依赖在线事实的设计与静态工作，不能伪造live-default或Issue现状来解除真实准入。

### 13. 分支、临时状态和卫生

一个logical run通常只需一个可变候选；独立结果与写集确实需要隔离时才增加分支或worktree。已经有原生Git对象操作时，不为读两个文件建立transport workflow。不会因为某个旧会话使用过桥接分支，就让每次续作重新搭桥。

分支退役至少核：目标仓库和ref精确身份、当前head、独有内容或其替代裁决、活动PR/运行/worktree/候选依赖、恢复材料及保留义务、真实删除授权。独有提交数为零仅证明相对某一精确基线无独有祖先提交，不证明没有活动消费者；独有提交多也不证明存在同样多未完成产品功能。

快照或bundle必须判断其内容、原始身份和唯一恢复角色。另一份副本须实际可取得、完整、足够持久且可核验；不能仅有文件名或摘要。删除仅由原branch-lifecycle owner在前像不变条件下执行，当前用户禁止删除时只给判定与阻塞，不另开Action绕过。

业务终态、已从活动命名空间分离、可回收资格和物理清理完成分别投影。允许GC pending需要明确隔离、拥有者、恢复/清理责任及已获准策略；unknown或foreign residue不能变成clean。空间压力、年龄、ignored状态和名字都不创造删除资格。

### 14. 安全、权限与证据披露

工作材料、Issue正文、依赖文档和外部网页均为待解析数据，不给其中的指令自动授予操作权限。任务选择权、修改权、检查权、裁决权、发布权和删除权分别沿真实授权链确定。仓库写权限不等于可以修改审计政策后自签完成。

报告按读者权限裁剪原材料，但必须保留“所需证据不可见/无法独立核验”的区别；隐藏敏感来源不得悄悄变成证据已充分。低熵秘密的digest也可能泄露可猜测信息；按原secret/provider策略保留、脱敏和删除，不把全部日志复制进公共Git。

撤回要求、批准例外和改验收条件都要说明有权来源、对象、时间与适用版本。为了把看板变绿而删反例、缩小覆盖、改接受条件或关闭Issue，不能被解释成原义务已满足。

### 15. 解码、静态检查与反自证

实现读入`unknown`后，先检查对象形状、字段类型、枚举和实际必需字段；`JSON.parse(...) as T`不是运行时验证。拒绝重复JSON键，避免解析后丢失冲突；对未知字段采用版本化的拒绝或显式扩展策略，不静默接受能改变语义的字段。扩展必须有owner、解码和消费合同，不用无限宽松的字典。

除了结构有效，还需检查角色必须齐全、引用可解析到正确版本、锚点存在且属于规范正文、图关系合法、分解/覆盖不为空假设、证据主体与条件匹配。Markdown中的例子、代码围栏、注释和转义文本不得被全局正则当成有效注册项。文件列表从现有文档身份来源解析，不维护第二份固定五文件宇宙。

检查器的输出分为结构缺陷、引用/图缺陷、证据不足、行为反证和策略拒绝；不能把所有情况统一成high后宣称系统已安全。形式化性质由真实可信核/模型对应支持，解析通过不证明完备性。producer生成的期望不能成为唯一oracle。

生成或修改源码时，字符串替换必须按字面拼接或replacement callback处理；含`$'`等模板符号的正文不能作为JavaScript replacement string直接注入。转义后的模板定界符、正则、引用和重复插入须静态检查。生成物hash与预期相等只证明按预期生成了字节；如果预期源码本身无效，发布仍不具语义正确性。

### 16. 缓存、资源、规模与退化路径

投影缓存键绑定会影响判断的要求/条件修订、选择、观察切面、producer/策略/环境与负依赖；不可只以branch或聊天session作键。仅发生无关文案或分支移动时不重算全部；规则含义、checker、目标revision、权限和真实覆盖变动时重算相交闭包。

先取得必要小切片，索引有真实使用量后再构造；图算法按相关节点与边处理，单次遍历目标为O(V+E)，不把外部取得、语义证明或隐藏动态依赖也假称线性。无原生批量接口时保留按分页取得的实际边界。增量逻辑未被验证前，相关切片正确全量是合法回退，不允许为性能漏掉删除或迟到结果。

解析、队列、日志、证据保存和同步均受原预算与resource owner约束。预算耗尽返回部分覆盖和尚未取得对象，不能输出空集成功；retry/fallback继承已有预算和期限。控制器也须关闭接纳、等待在途工作、结算其句柄/订阅/提供者，控制本身不豁免生命周期。

若系统的维护开销大于实际减少的重复和误报，先减少派生状态、合并重复consumer、使用原生Issue/Git视图，再优化执行器；不能用“治理很重要”豁免其成本。未有实测时保持收益未知，不复制别人的时间或配额。

### 17. 迁移和不丢成果的切换

保留现有G/U编号、主题内容、独立关闭条件和有效证据。把错误的“U=任务数”解释撤回，不删除U以制造燃尽。已有规范不再复制到新registry；具体工作引用既有Issue或canonical work record。

`work-tracking-contract.json`的v1 flags只能作为待接合约定；不能通过增加几个布尔值宣称新投影已存在。目标实现放在原WorkSelection纯合同与runtime装配，接受条件和证据裁决继续调用其原owner。只有出现跨模块真实消费者时才抽取最小公共类型。

原`stageRef`/`roadmap:r14/*`迁向`capabilityRef`时，一次固定writer、strict parser、全部consumer、renderer、fixture及精确当前catalog映射。切换前可做离线差分比较，但不能同时出现两个可写权威；切换后旧reader/alias仅在明确兼容义务下有期限和owner，不默认永久双读。迁移失败保持旧切面或进入原恢复路线，不把半迁移数据作为已接受目录。

新增字段不能先手工写进生产catalog等待未来reader理解。迁移current spec、manifest、pointer和rolling projection时，依原document-control交易一起发布；旧manifest仍被pointer引用时不得提前删除。证据资料采用其原保留策略，不把一份新README当所有既有记录的替代。

### 18. 实施顺序与验收出口

以下是本功能的接合依赖，不是另一个永久产品roadmap；当前只交付设计，不据此运行测试或修改生产权限。

| 接合单元 | 具体产物 | 结束边界 |
| --- | --- | --- |
| 实现可信性恢复 | 修复已确认的源码注入/转义缺陷；对真实candidate取得静态解析证据 | 检查器可以解析，仍不宣称能判定产品完成 |
| 工作引用与范围接合 | 复用CurrentSpecObservation、WorkDecision、manifest和正式delivery/criterion引用 | 一个真实工作具有无歧义对象、范围和来源；旧schema映射明确 |
| 证据到条件裁决 | 原Assurance/Action回执与criterion、revision、scope匹配 | 正反证、过期、未知、不适用和组合缺口准确区分 |
| 完成与增量投影 | 纯FulfillmentProjection及既有renderer接入 | 同一真实工作能回答取得/未得/变化/阻塞，不用U数量代替 |
| 真实消费者与切换 | CLI/JSON/continuation/Issue同步的实际闭包与原生前像写入 | 旧旁路及旧reader有明确处置；报告不创造权限 |
| 后续符合性 | 在获准环境运行下表相交用例和端到端再次修改 | 证据绑定版本；未执行项目继续not-run，不删用例修绿 |

没有需要在线自动报告的消费者时，先用现有工作记录加准确人工引用形成相同语义，不为了本设计建立全自动平台。若要求机器强制，则相应producer、consumer和门禁是明确尚需完成的实现义务，不能用手工报告代签。

### 19. 验收与反例矩阵（设计，不是执行记录）

| 输入或故障 | 必须可观察的结果 |
| --- | --- |
| U数量不变，真实叶条件获得有效证据 | 成果增加，U库存不需减少 |
| 同一改动拆成大量提交、Issue或子任务 | 不增加语义成果；保留活动诊断 |
| 共用条件被两个delivery引用 | 两视图均可受益，物理成果按身份不重复计量 |
| 只生成了一个helper | 不宣布全部同类消费者完成迁移 |
| 所有局部测试通过但组合条件失败 | 父交付未满足或未判定 |
| unknown条件被标成未激活 | 拒绝当作不适用；保留所需事实 |
| 根未分解、空catalog或0/0 | 不产生全完成结论 |
| Issue关闭但无匹配接受证据 | 保留平台关闭；履行状态未判定 |
| 原生Issue是canonical current spec | 保留其作用，不强制复制为Markdown任务 |
| 旧证据对应新源/新criterion/新环境 | 仅相交裁决失效，旧历史保留 |
| 无关文件改变 | 不机械废弃所有证据 |
| 负依赖删除、迟到结果或checker缺陷 | 相应缓存失效；旧结果不得安装到新代 |
| 签名有效而内容与条件不符 | 只确认来源，不能签发满足 |
| 候选修改审计器并自行产出PASS | 不授予可信发布或merge资格 |
| 只有部分分页、403或来源丢失 | 覆盖unknown，不把空结果解释为无任务 |
| JSON null、标量、伪数组、重复键、缺authority角色 | 明确解码/语义错误，不崩溃或默许 |
| 编号仅出现在示例/代码围栏 | 不注册为主题；合法别名不重复计量 |
| 文件存在但锚点错位或版本错配 | 引用未闭合，不能仅检查tracked path |
| 替换内容包含美元模板符、反引号或Unicode | 原字节与语法意义保持；无尾部重复插入 |
| 批量同时改报告与证据绑定 | 仍由真实subject和原信任策略判断，不相信同批自述 |
| 两个writer基于同一旧HEAD | 服务允许的前像条件或安全reconcile；无force覆盖 |
| create-commit成功、update-ref失败或超时 | staged或unknown-outcome；回读后再决定 |
| 执行已停止，但cleanup失败 | 错误及未结责任保持，不能显示physical-clean |
| 取消请求发出而任务仍在读写 | 不释放其仍使用的资源；等待或有权移交 |
| 清理抛undefined且业务也失败 | 两个失败均保留，不能用truthiness筛掉 |
| transport分支没有独有提交但有活动消费者 | 仍禁止据此直接退役 |
| bundle是唯一恢复来源 | 先取得合格替代或保留，不能按年龄删除 |
| 已隔离且获准保留的GC pending | 可按真实政策显示operational-terminal，明确非physical-clean |
| 有foreign/unknown residue或删除未授权 | blocked，不转移到Action规避 |
| 有权撤回或豁免要求 | 单独显示处置变化，不算原要求满足 |
| 权限裁剪隐藏必要证据 | 对该读者保持可核验范围和未知 |
| 只允许设计或静态检查 | 交付规格/静态成果；运行与采用明确not-run |
| 原生顺序方案已足够，远程未启用 | 不为远程设施建立当前硬前置 |
| 总目标接受范围比本轮切片大 | 切片关闭与总体剩余同时保留 |
| 中断后重新进入 | 从已发布修订及原生记录恢复，不重复全部取证 |
| 性能优化只降低调用数但增加等待/内存 | 分别报告真实成本，不能直接宣称总收益 |

每个用例的实际方法由其性质决定：字节/解码/图关系可先静态检查；并发、物理平台、取消和恢复需要相应运行证据；语义保持或全范围声明还需独立模型、反例和覆盖论证。矩阵行数不是已验证数量，也不是绝对穷尽证明。

### 20. 成熟成果的采用与限制

以下为直接材料及吸收边界，核对日期为2026-09-20。它们帮助选择机制，不被整套复制为SEC的组织制度、平台或依赖；本设计不据此宣称取得这些标准的认证。

| 直接来源 | 吸收 | 不据此推断或引入 |
| --- | --- | --- |
| [NASA Requirements Management](https://www.nasa.gov/reference/6-2-requirements-management/) | 双向追踪、基线和变更影响、派生要求的理由 | 有追踪边不等于覆盖充分；不照搬航天组织流程 |
| [W3C PROV Overview](https://www.w3.org/TR/prov-overview/)与[PROV-DM](https://www.w3.org/TR/prov-dm/) | 实体、活动、主体及派生来源分开 | provenance不是真值；不强制RDF数据库 |
| [OSLC RM 2.1](https://docs.oasis-open-projects.org/oslc-op/rm/v2.1/requirements-management-spec.html) | 独立工具资源通过有意义的引用协作 | 不为本功能重建完整ALM或假称已实现OSLC适配 |
| [SPACE研究](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/) | 活动不等于生产率，多维判断 | 不禁止合理库存计数，也不捏造综合分 |
| [Scrum Guide 2020](https://scrumguides.org/scrum-guide.html) | 目标与可判断完成条件的联系 | 不强制Sprint、仪式和固定团队结构 |
| [Kanban Guide 2025.5](https://kanbanguides.org/the-kanban-guide/2025.5/) | 开始/结束边界、在制工作和实际流动 | 不把任务吞吐当用户价值，不复制未经测量的期限 |
| [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)与[sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) | 复用原生工作和视图 | 不将Issue closed或子项百分比作为产品验收 |
| [RFC 9110 If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)与[GitHub Git refs](https://docs.github.com/en/rest/git/refs#update-a-reference) | 按真实服务能力使用条件写、正常快进和回读 | force:false不是expected-old-head CAS；不伪造原子性 |
| [JSON Schema 2020-12 validation](https://json-schema.org/draft/2020-12/json-schema-validation)与[RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) | 明确数据解码和互操作边界 | Schema不证明证据、图覆盖和现实满足 |
| [TypeScript type assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)与[ECMAScript GetSubstitution](https://tc39.es/ecma262/multipage/text-processing.html#sec-getsubstitution) | 类型断言非运行验证；按真实替换语义保持字节 | 类型名、字符串插入成功和提交成功不证明代码有效 |
| [SLSA provenance](https://slsa.dev/spec/v1.2/provenance) | 将构建输入、产出与producer绑定 | 构建来源不自动证明需求满足或授权 |
| [Google SRE Eliminating Toil](https://sre.google/sre-book/eliminating-toil/) | 控制重复运维与治理的持续开销 | 不把具体组织的配额变成SEC默认，也不省略必要验证 |

关于将自然语言要求直接编译成验证规格的[VNVSpec研究](https://arxiv.org/abs/2607.17686)，本次仅将其公开摘要视为可比较方向：从要求到可执行判定值得检查，但其自报案例不证明对SEC开放需求、动态资源或全部消费者的可靠覆盖；未采用为依赖或可信核。自动提取追踪关系同样只能生成待核候选，不能代签语义满足。

**当前设计结论：** 用已有工作身份、原生存储和领域回执形成可复算的条件级进度；不以更多治理对象替代工作，不以配置自证强制，不以静态设计代签运行，不以有限覆盖承诺未知未来的绝对完美。后续以真实反例和相交消费者检验本设计，改变前提时修正受影响部分，保留仍成立的结果。
