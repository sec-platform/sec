---
title: SEC 全域复用审查与实施映射
status: historical
domain: external-provider
---

# SEC 全域复用审查与实施映射

## 身份、范围与证据等级

研究日期：2026-09-07；仓库：`sec-platform/sec`。实现观察固定在 `refactor/repository-architecture-convergence-v1@d5af1adb1fba96f274bf0b8e0e041ff70d0f19a7`；政策和文档观察固定在 `codex/document-architecture-convergence-v1@54936bba20b836b06bc27ce4ebac9488882be90a`；读到的 main 为 `28b92d5293900d5f2108d2d349c726e9cacba5d5`。这三个身份不同，不把文档分支代码当作代码收敛分支当前实现。

本目录是带来源的不可变研究快照，不是第二份 Provider 状态、ImplementationWorkAdmitted、完成台账或发布证明。实时状态仍归 `docs/governance/external-capability-ledger.yaml` 及 live receipts；采用规则仍归 `docs/external-provider-policy.md`；工作准入归现有开发治理。记录采用研究标签，不能据此自动安装包、授予网络/进程/写入权限或标记产品支持。

覆盖方式：盘点 `src` 全部15个顶层域，另检查根依赖声明、config、catalog、tests、docs、Agent规则与既有外部能力台账；深入读取下列 source-index 中的核心消费点。根目录递归响应在展示层发生截断，本轮不是全部文件逐行审计，未检视函数不猜测其行为。`source-read` 表示已读相关正文，`source-and-inventory` 表示已读核心入口但未展开全部引用闭包，`inventory/target-design` 只形成带触发条件的提案。64项是独立复用决策单元，不是64个新增包、64个缺陷或64项已实施工作。

读取次序：[语言与语法 R01–R22](01-language-and-syntax.md)，[组合与运行时 R23–R44](02-composition-and-runtime.md)，[工具链与交付 R45–R64](03-toolchain-and-delivery.md)。来源身份与域映射在 [source-index.json](source-index.json)，可执行隔离探针在 [syntax-boundaries.mjs](syntax-boundaries.mjs)，实际结果在 [syntax-boundaries.results.json](syntax-boundaries.results.json)。这些探针不是新产品/测试工程，只是本次论点的最小证据。

## 去锚后的裁决

不能把 Nexus 的“缺少复用前置规则”原样复制到 SEC。SEC 的 AGENTS 第8项、external-provider-policy 和 external-capability skill 已经要求成熟能力、直接稳定接口、唯一owner、A/B conformance、消费者迁移和旧实现退役。现有强规则本身应该保留；实际缺口是需要在“准备手写/扩写/修补通用能力而没有打算加依赖”时也触发选择，不让自研默认免于成本论证。

现有 runtime 依赖声明为 commander ^15.0.0、diff ^9.0.0、ora ^9.4.1、p-limit ^7.3.2、picocolors ^1.1.1、yaml 2.9.0、zod ^4.5.4。dev 中已有 Knip 6.34.0、jscpd 5.1.1、Prettier ^3.9.6、TypeScript 6.0.3 API 和 @typescript/native 的7.0.2别名；Bun声明1.4.0。这里是 package.json 声明，不是本轮已安装版本，也不冒称上游最新。

已核验的正确复用：TypeScript factory/printer/scanner；生成文件使用Prettier且结合任务组/预期旧字节发布；Bun.semver供受限升级范围；YAML strict Document封装；p-limit供普通并发；native crypto/structuredClone；Knip/jscpd作为开发工具。不能把这些重新当“待引入轮子”。

优先缺口：docs doctor的Markdown/frontmatter语法正则；Plan/Manifest没有通过已有严格YAML入口；纯结构guard可复用已有Zod；Prisma分块合并在持续承担语法责任；通用GitHub请求胶水可做受限Octokit对照；更多固定回归应结合fast-check，不能都手写生成器。这些先完成消费点闭包与对照，随后决定实际替换。

必须保留的SEC合同：语言无关语义模型、canonical字节epoch、可信issuer/opaque capability、目标身份、权限、实际完成/settlement、资源账本、唯一写入者、独立读回、部分失败和unknown。它们不因第三方库返回成功而消失。但“SEC特有”也不是自研豁免：每层wrapper仍须证明新增具体边界，能直接用稳定接口且无新增边界时应直接用。

## 本轮探针与重要反证

六个隔离探针使用Node v22.16.0；从 `src/control/documentation/doctor/shared.ts` 的三个函数取出实现，去掉类型并重新排版，未把断言伪装成canonical Bun测试。结果：reference link未返回；fenced code中的链接样例会返回；Setext H1未识别；重复status选第一个；普通ATX/inline link正确；现有H1 fence防护正确。结果只证明helper语义。如果正式Markdown profile故意不允许这些形式，应显式拒绝而非擅自扩大支持；尚未证明整个doctor均存在相同绕过。

Exact JSON不应被“JSON.parse再Zod”替代：原文重复键已经被对象构造丢掉。jsonc-parser自身容错，必须查全部errors并保留decoded-key、深度、UTF-8、BOM和字节边界。是否能替代现有iterative scanner尚未做SEC差分。

canonical serializer与RFC8785并非天然等价。当前实现将排序键放回普通对象，再按自身枚举序列输出；整数样式键、lone surrogate及输入拒绝集合要逐一比较。不能通过换JCS/stable-stringify改变历史身份、hash和证据。当前代码已把normalize/序列化/hash迭代化，不应倒退到递归全对象stringify。

proper-lockfile上游明确列出无法发现的锁被删除后重新获得、参数不一致等情况，因此不能据其“跨进程锁”名称替掉SEC fencing。write-file-atomic的rename也不等于完整no-follow/retained parent/preimage/readback。p-queue的超时不终止用户底层工作；Effect finalizer也不是物理结束证明。

Prisma AST库不验证schema业务正确性；多文件配置必须指向目录，且生成输出不能又被当输入扫描。同模型冲突仍需要SEC resolution。保留已有有界scanner和测试直到对应能力真正被接管，不能把新库“能parse”当retirement许可。

固定密码认证样例与 `postgres-contract` 内存store仅被确认存在于reference/安装模板链；本轮没有证明其实际生产部署，也不报告已发生漏洞。真实目标若要求认证或持久化，分别绑定成熟OIDC/JWT与SQL/ORM Provider，不能用名称自证支持。

## 新旧工作如何取舍

保留 d5 分支的迭代canonical/hash、闭合SCC图边界、取消后的任务join、file publication字节快照、预期旧值和no-follow、受限template的长度/深度/无getter合同、GitHub opaque会话及字节总额。保留 #572 已有资源分类、语言无关架构、唯一VerificationSession/NextTransition等设计。本轮不合并两个分支、不回退main、不重写产品源码、不替换锁文件。

可避免成本分三类：未比较专业解析器就继续扩写通用语法；先修旧引擎再迁移却没有明确应急退出；已经有成熟依赖仍维护同义旁路。它们应在本次映射指向的消费点重新选型。必要工作是规范行为、强反例、状态身份、安全与迁移；即使底层算法被替换也应保留。现有记录不足以给出浪费工时/比例，不按大文件字节数、提交数或候选库数制造百分比。

同样要防止反向过度设计：不要为所有函数增加薄包装；不要让schema、类型、validator三份独立权威；不要把每个Map都搬数据库；不要为了图算法启动图数据库；不要为CLI任务增加Temporal/另一总kernel；不要同时常驻重叠MCP。接口、边界与旧实现删除量构成评估，不是包数。

## 上游状态、许可和平台边界

本次在线核查的原始资料逐项在三份明细中；基于接口/机制，不基于stars/作者微基准排名。公开文档的当前页面不等于仓库固定版本具有全部能力。Bun当前文档出现1.4.1入口，并提供Markdown/YAML/Archive/SQL资料；当前仓库1.4.0必须独立验证。Bun Markdown公开callback未提供本次所需源码位置合同；Bun YAML支持多文档且可能产生共享/循环对象；Archive会规范化路径且Windows/Linux处理symlink不同，不能直接当严格同义替换。

Dagger的既有台账记录是旧版本成本证据与watch裁决；当前文档展示1.0-beta，触发重新核查，而不是证明旧基准适用于新版本或自动改成selected。Codegraph无精确版本/许可/差分证据不升级，graph-it-live-MCP原有reject/retired保留。旧availability记录不能证明现在可用。

CodeQL私有仓库使用许可必须实际确认；新CLI/node/WASM绑定还要检查OS、libc与运行时。graphlib应比较维护中的@dagrejs命名空间；lru-cache当前README显示BlueOak而非凭记忆一律写MIT。PrismaAST部分网页缓存较旧，精确发行版维护状态仍未知。所有新候选的selectedVersion、分发许可证闭包、安全公告与SEC conformance在本轮均未关闭；不存在“查过README=安全/许可证通过”的跳步。

在实际采用前，每项必须固定 package/版本/完整性/源码/依赖图，核对license、安装脚本、native/WASM/子进程、网络/默认遥测、credential、动态配置/plugin执行、升级/撤销与离线策略；没有真实consumer的候选保持watch/reject，不一次安装全部清单。

## 实施映射：不再重新盘点同一批问题

以下T编号只索引本研究的激活顺序，不新建活跃工作状态；必须由现有dev:status和Work Package机制接纳。改变来源、consumer、版本、合同或安全边界才重开对应条目；不因开始下一轮就全量重复审计。

|任务|消费owner/决策|具体交付与关闭条件|
|---|---|---|
|T01 文档语法|documentation doctor，R21–R22|单一AST/strict YAML输入；保留Clause/fragment/path规则；处理六探针与复杂文档差分；删同义正则|
|T02 计划和清单结构|compiler parse，R16–R18|接已有YAML/Zod；明确每域limits/default/error；词法重复键不晚于对象构造；迁移后旁路为零|
|T03 代码生成与Prisma|compiler compose，R02/R04/R23–R27|保留TS/Prettier；PSL AST+官方验证pilot；独立模型考虑多文件；保真/冲突/注入/partial失败相同|
|T04 真实目标服务|catalog/reference，R60–R61|fixture与production资格分离；认证/持久化实际Provider；真实服务重启/租户隔离/失败回滚；不迁移用户数据作为研究副作用|
|T05 通用外部胶水|github/process/provider，R31–R35/R42–R44|按函数划分可替代机制和独有合同；一个闭包pilot；保留预算、凭据、物理settlement、readback；删除等价wrapper|
|T06 图与缓存|brownfield/semantic，R03/R28–R30/R38–R41|先复用已有facts；测实际查询/失效成本；仅有瓶颈的域试SQLite/LRU；不增加第二事实源|
|T07 测试有效性|verification/tests，R50–R59|Knip/jscpd配置、property/fault/mutation、真实平台/服务；报告只是证据不等于admission|
|T08 多语言与意图语法|brownfield/compiler/interface，R05–R15/R64|按target逐个绑定原生前端与coverage；明确语法/类型/flow不同；不把SEC限定为TS或假宣称已支持所有语言|
|T09 运行观测|foundation/development，R48–R49/R62|先原生profile再选日志/trace；无默认上传；测量缺失不是0；观测不能改变结果|
|T10 总体执行成本|development/control/external，R45–R47/R63|保留单一run owner；Dagger只重开真实变更的cost证据；无必要常驻Provider退役；不新造umbrella kernel|

## 对照试验与停止条件

每个采用任务冻结同一source、Target、配置、tool/OS、cold/warm/增量/全量条件。分别报告wall/CPU、RSS/heap、磁盘、网络、启动、序列化复制、call数量、工程迁移/维护成本；没有量纲的总分、任意“至少快20%”或未测包体不作为门槛。

差分必须解释 old-only/both/new-only/unknown，比较正确结果、拒绝集合、错误码、覆盖、状态失效、取消/超时/cleanup、资源极端与离线。强制失败反例不是只跑快乐路径。引擎事实可用不代表selected/deployed/supported。历史hash、用户数据、reference向量与既有正确功能必须有迁移/回滚定义。

通过后先迁全部合法consumer，再确认旧writer/route/cache/config/dependency为零，删除被支配的实现与只绑定旧实现的测试；保留协议反例与参考oracle。有限shadow可以，但必须有退出条件，不长期“新旧备用”。新库不能保持需求时保留已有合格实现并记录确切差距，不以不可达候选自写隐形fallback。

## 本次验证和提交边界

本轮完成：连接器读取源码/分支/PR、上游原始文档检查、6个Node隔离探针、研究条目和域映射完整性、局部文件格式/链接/哈希核验。未完成：canonical Bun dev:status、真实活跃ImplementationWorkAdmitted、完整SEC tests/docs doctor、候选库安装/基准/全consumer conformance、依赖安全审计或生产采用。当前环境没有Bun、没有认证本地clone，直接Git网络DNS失败；未用GitHub Actions绕过这些限制。

文档研究追加到既有文档收敛分支；代码分支只收到同一研究引用，不把它作为完成状态。没有创建新的Provider台账，没有修改其live availability，没有更新Work Package，没有合并main或宣称实施准入。提交成功与规则/产品全面验证成功必须分别报告。
