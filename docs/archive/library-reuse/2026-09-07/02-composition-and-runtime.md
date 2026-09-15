---
title: SEC 复用审查 23至44
status: historical
domain: external-provider
---

# SEC 复用审查 23至44

本文件是冻结研究裁决，不是 live Provider 状态。通用限制、来源层级和执行路径见 [README](README.md)。


## R23 Prisma 文本合并引擎

消费点：`src/compiler/compose/prisma-schema.ts`；`src/compiler/compose/merge-prisma-template.ts`；证据层级：`source-read`。

方案：@mrleebo/prisma-ast；Prisma 官方校验；裁决：`priority-pilot`。

机制/依据：当前是有边界的逐行scanner并保留幂等/注释，不应继续扩展成完整PSL parser。第三方AST可提供编辑，但上游明确不验证schema正确性，需官方验证补齐。

保留：字段冲突不由顺序决定、原注释/顺序、无变化字节、支持子集和 Target版本。

退出：先验证同版本语法和源保真，再删手写分块/字段扫描；内部Prisma SDK/WASM不自动当稳定公共API。

验收：relation/index/attribute、escaped string、注释、duplicate model、unsupported、noop、官方validate。

反转：候选未支持目标PSL或破坏comments/noop则不替换；上游检索部分页面缓存较旧，精确发行状态待核。

原始来源：[1](https://github.com/mrleebo/prisma-ast)；[2](https://docs.prisma.io/docs/orm/reference/prisma-schema-reference)。


## R24 用 Prisma 多文件能力减少合并需求

消费点：`src/compiler/compose`；`catalog`；证据层级：`source-and-inventory`。

方案：Prisma multi-file schema；裁决：`pilot-if-consumer`。

机制/依据：模块只增加独立模型时可交官方多文件读取，省去文本拼接；同模型扩展/冲突仍需SEC规则，不能宣称多文件自动解决字段融合。

保留：唯一schema目录、生成目录隔离、migration路径、旧schema版本与用户改动。

退出：迁移满足条件的独立模板后删除对应拼接路径，不并存两份schema定义。

验收：配置指向目录而非单文件、生成输出不被重复扫描、客户端模型集合和迁移差异。

反转：旧Target版本不支持或需要同模型合并时保留有界适配，不能自动升级用户ORM。

原始来源：[1](https://docs.prisma.io/docs/orm/v7/prisma-schema/overview/location)；[2](https://github.com/prisma/prisma/issues/27495)。


## R25 受限模板与通用模板库

消费点：`src/compiler/compose/render-template-string.ts`；`src/compiler/compose/template-engine.ts`；证据层级：`source-read`。

方案：现有受限插值；Handlebars；裁决：`retain-narrow-dialect`。

机制/依据：现有KEY与布尔IF不是通用模板语言；有own-property、无accessor、depth/directive/input/output预算。Handlebars的转义/真值/helper语义不能透明替换。

保留：无eval、无对象任意访问、插值字节预算、未知key失败、上下文冻结。

退出：TS输出优先factory；只有新通用authoring需求才候选预编译模板，证明等价后退役具体旧路径。

验收：注入、原型、helper执行、嵌套、surrogate跨片段、超大展开和未知占位符。

反转：仅现有微型方言仍足够时保留，不为使用库扩张语言和执行权限。

原始来源：[1](https://github.com/handlebars-lang/handlebars.js)。


## R26 生成结果格式化

消费点：`src/compiler/compose/format-output-files.ts`；证据层级：`source-read`。

方案：现有 Prettier；裁决：`retain-and-tighten-boundary`。

机制/依据：已用 Prettier并结合任务组和expected-preimage发布，不再实现排版。配置/插件可能成为执行面，真实调用前需区分数据配置与可执行配置。

保留：目标集合先校验、部分完成不假回滚、group等待物理完成、精确旧字节fence。

退出：去掉确认冗余的格式规则；不建第二个formatter风格权威，外部插件须受实际adoption许可。

验收：相同版本配置、no-op、CRLF、插件加载身份、任务失败后无晚写、工作区配置不越权。

反转：某输出语言未支持时显式unsupported，不用不保真正则补齐。

原始来源：[1](https://prettier.io/docs/api)。


## R27 文本差异与补丁

消费点：`package.json`；`src/change-management`；`src/semantic/impact`；证据层级：`manifest-and-inventory`。

方案：现有 jsdiff；裁决：`retain-existing`。

机制/依据：diff库已声明，应复用其文本算法；语义Impact、冲突决策和写入授权不是文本diff问题。

保留：行尾/Unicode、原文件preimage、patch applicability、超时与不完整状态。

退出：发现新手写LCS/文本diff时先迁入同一引擎，不把领域delta改成行diff。

验收：重复行、大改动、二进制拒绝、budget abort非零差异、patch后读回、old-only。

反转：专门语义差异有不同等价关系时保留领域算法；不按库数量衡量优化。

原始来源：[1](https://github.com/kpdecker/jsdiff)。


## R28 强连通分量基础算法

消费点：`src/system-architecture/foundation/runtime/directed-graph.ts`；证据层级：`source-read`。

方案：当前迭代SCC；@dagrejs/graphlib；裁决：`retain-pending-measurement`。

机制/依据：当前小型迭代SCC已经封闭节点、去重边、稳定输出与无递归。图算法是通用工作但单一SCC不当然值得引入可变多图依赖。

保留：unknown endpoint拒绝、顺序不影响结果、重复边幂等、深图不栈溢出、readonly输出。

退出：若更多图算法确有消费者，统一到graphlib算法层；先证同分区及内存，删重复算法不删语义edge类型。

验收：自环、深链、多环、孤点、未知端点、随机图与独立慢oracle、规模实验。

反转：graphlib带来更多转换/开销或失去边界时保留当前；候选应是维护中的@dagrejs命名空间。

原始来源：[1](https://github.com/dagrejs/graphlib)。


## R29 工程事实图的存储与查询

消费点：`src/semantic`；`src/brownfield/source-program-model/typescript.ts`；`src/runtime-state`；证据层级：`source-and-inventory`。

方案：现有索引；Bun SQLite；裁决：`watch-with-trigger`。

机制/依据：事实量和持久查询真的超过现有分片/反向边索引时试验SQLite；不因为叫图就默认装Neo4j或把全部实体膨胀成另一数据库镜像。

保留：canonical实体/关系身份、revision、反向可达失效、opaque事实与coverage。

退出：成功后只保留一个持久事实源或可重建投影，旧索引明确retire；缺失缓存不得变缺失事实。

验收：全量/增量、并发读、crash/rebuild、旧schema迁移、source witness与内存/磁盘。

反转：进程内索引已经足够或持久化成本更高就不迁移。

原始来源：[1](https://bun.sh/docs/runtime/sqlite)。


## R30 约束求解

消费点：`src/compiler`；`src/semantic`；`src/control/work-selection`；证据层级：`inventory-and-provider-design`。

方案：Z3；裁决：`watch-with-trigger`。

机制/依据：只有实际兼容/绑定组合问题需要SAT/SMT时使用成熟solver；不要自写通用求解器，也不要把简单DAG决策包装成SMT。

保留：约束含义、可满足模型的领域解释、unknown/timeout、可信来源与所有权。

退出：特定求解域证明覆盖后删除搜索算法；solver模型不自签admission。

验收：矛盾、unknown、资源限制、模型独立复核、增量求解与版本变化。

反转：公式不能忠实表达业务或规模无收益时保留显式领域规则。

原始来源：[1](https://github.com/Z3Prover/z3)。


## R31 Git 数据与引用更新

消费点：`src/external-capabilities`；`src/control/integration`；`src/workspace/runtime/project-tracked-files.ts`；证据层级：`source-and-inventory`。

方案：原生 Git plumbing/porcelain；裁决：`retain-native`。

机制/依据：使用Git机器接口而非自写对象数据库/命令展示解析；simple-git类包装不自动增值，也不能替换精确引用CAS。

保留：repository/executable/cwd绑定、NUL输出、目标SHA、并发移动、失败读回与最终settlement。

退出：只删经证明重复的参数与输出胶水，保留唯一操作会话；不复制Git事务实现。

验收：worktree/linked gitdir、对象格式、packed refs、移动base/head、原子多引用和回复丢失。

反转：有真实新平台只提供库接口时独立admit；不能默默换成不同Git实现。

原始来源：[1](https://git-scm.com/docs/git-update-ref)。


## R32 GitHub 请求与分页胶水

消费点：`src/external-capabilities/github-api/internal/operation-session-runtime.ts`；`src/external-capabilities/github-api/contract.ts`；证据层级：`source-read`。

方案：@octokit/request；受限Octokit分页组件；裁决：`priority-pilot`。

机制/依据：Octokit可减少route参数、协议错误和分页胶水；现有closed-operation capability、credential隔离和总请求/字节预算不可删除。

保留：read/status-write/merge-write区别、repo/principal、absolute deadline、stream字节限制与敏感信息。

退出：用同一受控transport接入后退役通用HTTP拼接；禁止向业务层暴露万能Octokit实例。

验收：429/Retry-After、redirect凭据、分页完整性、空结果与未运行、巨响应、非幂等写入不能盲重试。

反转：库先缓冲再检查size或自开超时无法适配时保留native fetch owner，不给它安全证明豁免。

原始来源：[1](https://github.com/octokit/request.js)。


## R33 子进程与跨平台启动

消费点：`src/toolchain/dependencies/runtime`；`src/external-capabilities`；`src/runtime-state/physical`；证据层级：`inventory-and-provider-design`。

方案：Bun.spawn/Node child_process；Execa；裁决：`pilot-if-consumer`。

机制/依据：Execa可接管普通argv、pipe和错误包装；当前受控运行的身份、子树、breakaway和终止读回不是spawn库能证明。

保留：执行文件loader closure/cwd/env/token、继承句柄、输出背压、真实物理结束与primary+cleanup失败。

退出：先分解大runtime的纯机制与安全owner；若采用Execa删除对应平台胶水，不加同义层。

验收：Windows/POSIX、PATH禁绕过、超时后子树、非合作子进程、截断输出、同时失败。

反转：错误地把Promise reject当进程终止或隐式shell改变注入边界则拒绝候选。

原始来源：[1](https://github.com/sindresorhus/execa)；[2](https://bun.sh/docs)。


## R34 并发限制、排队与完成

消费点：`src/system-architecture/foundation/runtime/concurrency.ts`；`src/system-architecture/operation`；证据层级：`source-read`。

方案：现有 p-limit；条件性 p-queue；裁决：`retain-existing-boundary`。

机制/依据：普通并发已使用p-limit；结构化任务组另有关闭首失败、取消并等待所有已启动任务的合同。p-queue timeout/abort不等于底层操作结束。

保留：物理在途许可、aggregate budget、稳定错误顺序、AbortSignal与join。

退出：普通队列可用库替代；不能把结构化任务组降格成Promise.all或clearQueue。

验收：队列取消、无法取消操作、第一失败后无新Effect、双失败保留、调用者返回时无晚写。

反转：需要priority/rate机制且现有限流不够才引入队列；不要因库有同名timeout就替换。

原始来源：[1](https://github.com/sindresorhus/p-limit)；[2](https://github.com/sindresorhus/p-queue)。


## R35 结构化资源管理

消费点：`src/system-architecture/foundation/runtime/concurrency.ts`；`src/runtime-state`；`src/system-architecture/operation`；证据层级：`source-and-inventory`。

方案：Effect Scope；裁决：`watch-with-trigger`。

机制/依据：Scope/finalizers可减少纯资源组合胶水，但并非实际进程/句柄物理终止证明。先试一个有限资源域，不全仓改Effect类型。

保留：唯一OperationKey、typed residue、物理resource ledger、独立readback与错误优先级。

退出：成功后删除该域重复finalizer组合；不能新增第二调度/权限/完成状态机。

验收：获取一半失败、并行释放、cleanup再失败、不可合作任务、外部句柄替换。

反转：迁移扩大状态和调用闭包或仅换术语则拒绝；现有proposal反对额外总kernel仍有效。

原始来源：[1](https://effect.website/docs/v3/resource-management/scope)。


## R36 原子文件写入

消费点：`src/workspace/runtime/file-publication.ts`；`src/runtime-state/physical`；证据层级：`source-read`。

方案：write-file-atomic；原生fs；裁决：`retain-authority-pilot-nonauthority`。

机制/依据：临时文件rename库适合普通输出，却不覆盖当前保留parent identity、exact preimage、no-follow、commit fence和readback。

保留：权限、路径/字节快照、durability、目标未被替换以及部分失败后状态。

退出：可重建非权威cache域可试用；不能把发布owner一对一换成库后删除所有检查。

验收：同名替换、symlink/reparse、跨设备rename、fsync失败、Windows、故障后读回。

反转：若未来库明确覆盖同一威胁和持久性模型再重新评估，普通atomic名词不够。

原始来源：[1](https://github.com/npm/write-file-atomic)；[2](https://nodejs.org/api/fs.html)。


## R37 写租约与锁

消费点：`src/workspace/state/write-lease.ts`；`src/runtime-state/physical`；证据层级：`inventory-and-contract`。

方案：proper-lockfile；原生锁/既有SEC租约；裁决：`reject-drop-in`。

机制/依据：proper-lockfile基于mkdir/mtime，官方列出移除后重获等不能发现的情形；不能透明替代SEC fencing、foreign owner与恢复合同。

保留：旧持有者不能继续Effect、ABA、租约issuer、foreign残留、admission及清理权限。

退出：133KB文件只是需要分解的线索不是全部自研浪费；抽取普通协议/序列化再验证复用。

验收：时钟跳变、停顿、删除/重获、进程死后、网络FS和不同参数混用；独立物理反例。

反转：仅善意进程协调且无强fencing要求的可重建域可采用；不得扩大到核心写入。

原始来源：[1](https://github.com/moxystudio/node-proper-lockfile)。


## R38 运行日志、journal与本地事务

消费点：`src/runtime-state`；`src/toolchain/dependencies/runtime/dependency-transition`；`src/workspace`；证据层级：`inventory-and-provider-design`。

方案：Bun SQLite；裁决：`pilot-if-consumer`。

机制/依据：若多个文件journal手工维护查询/版本/事务，可比较原生SQLite；数据库事务不包含任意外部文件、子进程或远端Effect。

保留：state版本、旧journal可恢复、来源、actual terminal、不可丢失的未完成操作。

退出：一个明确的数据域迁移后删除旧写入者与恢复分支；不建立DB加文件两份权威。

验收：crash各提交点、WAL/锁、只读/满盘、旧schema迁移、SQL↔外部Effect补偿。

反转：只有一次小记录或可重建cache无需数据库；若不能删除足够胶水则不迁。

原始来源：[1](https://bun.sh/docs/runtime/sqlite)。


## R39 有界缓存

消费点：`src/compiler/parse/manifest-cache.ts`；`src/brownfield/source-program-model/typescript.ts`；`src/toolchain/dependencies`；证据层级：`source-and-inventory`。

方案：lru-cache；现有精确key缓存；裁决：`pilot-if-consumer`。

机制/依据：库可接管eviction/size算法，不能决定source/target/revision/provider key或有效性。TTL本身不等于新鲜度证明。

保留：原始来源摘要、scope、unknown结果、缺失后的重算、不可淘汰资源持有责任。

退出：只迁可重建data cache并删重复eviction；不要缓存admission、lease或secret作为普通LRU值。

验收：内存预算、stale无正向复用、同路径新文件、schema更换、eviction清理和并发读取。

反转：简单单次operation Map即可时不增加库；当前README展示BlueOak许可证，精确版本须重新审查。

原始来源：[1](https://github.com/isaacs/node-lru-cache)。


## R40 目录匹配与文件盘点

消费点：`src/workspace/runtime/discovery.ts`；`src/workspace/runtime/project-tracked-files.ts`；`src/control/documentation/doctor/shared.ts`；证据层级：`source-and-inventory`。

方案：Git ls-files；Bun.Glob；裁决：`reuse-native-first`。

机制/依据：tracked清单交Git，普通候选文件匹配交原生glob；不要每域手写遍历。但glob找到路径只是候选，不是安全读取许可。

保留：tracked/untracked区别、忽略规则、排序、平台逻辑路径、no-follow、输出条数与字节。

退出：相同候选盘点集中复用，保留各域筛选谓词；禁止改变完整inventory语义以减少扫描。

验收：dot目录、ignore、删改文件、symlink、Windows separator、Unicode和大小写碰撞。

反转：库不支持当前精确文件集合时显式保留，而不是缺失项静默忽略。

原始来源：[1](https://bun.sh/docs/runtime/glob)；[2](https://git-scm.com/docs/git-ls-files)。


## R41 文件监听

消费点：`src/development`；`src/brownfield`；`src/workspace`；证据层级：`inventory-and-provider-design`。

方案：native watch；Chokidar；裁决：`watch-with-trigger`。

机制/依据：确需跨平台监听再采用成熟watcher；事件只是invalidations，不能把watch通知当完整权威文件事实。

保留：反向闭包失效、删除/替换、补盘点、退出释放和无静默后台服务。

退出：只替代事件兼容胶水；监听后仍按当前读边界取事实，不新增全树常驻扫描。

验收：rename/atomic save、漏事件、睡眠恢复、大目录、预算、退出和新root。

反转：当前按需操作足够时不为了“更增量”常驻；无Bun匹配测量不声称更快。

原始来源：[1](https://github.com/paulmillr/chokidar)。


## R42 包完整性字符串与算法

消费点：`src/toolchain/dependencies`；`src/release`；证据层级：`inventory-and-provider-design`。

方案：ssri；native crypto；裁决：`pilot-if-consumer`。

机制/依据：SRI解析/多算法校验有真实重复实现时复用ssri；原生hash继续用crypto。digest不是发布者身份或权限证明。

保留：exact材料、算法准入、来源链、lock与实际安装图一致性、字节流上限。

退出：删除同一规范的自有SRI语法/组合，保留SEC provenance policy。

验收：多token、unsupported算法、格式歧义、截断字节、错误hash和大流。

反转：当前只处理一种明确的内部sha256格式则无需SRI全库。

原始来源：[1](https://github.com/npm/ssri)。


## R43 包获取与安装

消费点：`src/toolchain/dependencies`；`src/change-management/upgrade/upgrade-workspace.ts`；证据层级：`source-and-inventory`。

方案：已有Bun/目标package manager；pacote；裁决：`retain-manager-pilot-fetch-only`。

机制/依据：冻结安装和依赖解析优先既有包管理器。pacote只在明确packument/tarball消费缺口时候选，下载/提取/脚本是独立Effect。

保留：provisioning许可、registry/token、精确版本/lock、offline、install scripts、loader closure。

退出：如果采用fetch层删除对应HTTP/压缩胶水，不保留自制第二dependency resolver。

验收：source替换、锁漂移、peer/optional/platform依赖、恶意tar、网络拒绝与脚本零扩权。

反转：不得因提供者unknown在生产会话内自动安装；已有Bun.semver窄合同不换node-semver。

原始来源：[1](https://github.com/npm/pacote)；[2](https://bun.sh/docs/runtime/semver)；[3](https://github.com/npm/node-semver)。


## R44 归档读取与安全提取

消费点：`src/release`；`src/toolchain/dependencies`；证据层级：`inventory-and-provider-design`。

方案：Bun.Archive；node-tar；裁决：`pilot-if-consumer`。

机制/依据：标准tar/zip处理应先评估成熟实现；最新Bun文档有Archive，但当前固定1.4.0须实测。其规范化..或Windows跳symlink语义可能不同于SEC严格拒绝合同。

保留：entry集合/路径/类型、无逃逸、duplicate/collision、字节和解压预算、权限与确定性。

退出：先比较提取语义再删手工archive机制；不以较小包为由绕过source/loader证明。

验收：zip-slip/tar绝对路径、hard/symbolic link、device entry、重复条目、bomb、Win/POSIX元数据。

反转：不能暴露严格entry拒绝或无法流式限额时留当前边界；精确包漏洞审计未完成前不安装。

原始来源：[1](https://bun.sh/docs/runtime/archive)；[2](https://github.com/isaacs/node-tar)。
