---
title: SEC 复用审查 45至64
status: historical
domain: external-provider
---

# SEC 复用审查 45至64

本文件是冻结研究裁决，不是 live Provider 状态。通用限制、来源层级和执行路径见 [README](README.md)。


## R45 构建与缓存机制

消费点：`src/release/build.ts`；`src/release`；`src/development`；`package.json`；证据层级：`source-and-inventory`。

方案：Bun build及当前编译工具；裁决：`reuse-native-first`。

机制/依据：构建/transpile/cache应复用工具，而发布资格、manifest与清理读回继续SEC。不要为换构建品牌新造一个Release owner。

保留：exactinputs、target、source maps、determinism、模块边界、已发布但cleanup未完成的区分。

退出：识别重复transpile/依赖闭包读取后合并；只有实际配置/性能缺口才比较其他bundler。

验收：真实导出/动态import/assets、安装版布局、复现构建、cold/warm/cache丢失、失败副作用。

反转：整套Turbo/Nx/Bazel迁移无证明净减少工作时不采用。

原始来源：[1](https://bun.sh/docs/bundler)。


## R46 容器化工作流

消费点：`docs/governance/external-capability-ledger.yaml`；`src/development`；`src/external-capabilities`；证据层级：`ledger-read`。

方案：Dagger；裁决：`retain-existing-watch`。

机制/依据：SEC已有Dagger基准与watch裁决，不能再当全新遗漏。它带引擎/层/cache/权限成本，不自动接管当前开发kernel。

保留：原owner、proof/readback、offline与不可变材料、预置能力采用和bootstrap分离。

退出：只有新增workload试验通过且可删除重复编排才迁移；无收益不扩大adapter。

验收：冷/热/离线/cacheloss、成本向量、真实删除量、物理generation与终止。

反转：当前台账证据范围外仍未知；禁止用历史availability时间戳证明现在可用。

原始来源：[1](https://docs.dagger.io/)。


## R47 持久工作流与总调度器

消费点：`src/development`；`src/verification`；`docs/proposals/development-run-kernel.md`；证据层级：`proposal-and-inventory`。

方案：Temporal；现有VerificationSession；裁决：`reject-second-owner`。

机制/依据：Temporal适合真实持久服务编排，不是给单次开发命令再增加一套总kernel。已有proposal已拒绝额外umbrella runtime，继续保留。

保留：当前VerificationSession、NextTransition、唯一任务与终态、权限和无重复Effect。

退出：仅独立外部长期服务确有消费者时新增replaceable provider，不覆盖当前控制面。

验收：replay/幂等、Activity副作用、跨版本、离线与服务不可用、取消后物理结束。

反转：没有持久分布式消费者或不能退役旧权威就拒绝，不以“企业级”作为理由。

原始来源：[1](https://docs.temporal.io/workflow-execution)。


## R48 日志输出

消费点：`src/system-architecture/foundation/logger.ts`；`src/toolchain/dependencies/runtime/operation-telemetry.ts`；证据层级：`inventory-and-contract`。

方案：Pino；现有轻量logger；裁决：`pilot-if-consumer`。

机制/依据：结构日志、序列化、redaction真有重复实现时试Pino；小型CLI不必为了日志品牌启动后台worker。

保留：秘密/主机细节过滤、stdout机器输出不受污染、日志失败不能改业务结论。

退出：替换单一编码/输出层，删除旧格式器，不建第二遥测状态库。

验收：巨大循环对象、慢sink、backpressure、flush失败、credential不泄露与CLI冷启动。

反转：现有轻量logger满足需求时保留；没有测量不宣称更快。

原始来源：[1](https://github.com/pinojs/pino)。


## R49 Tracing 与 profile

消费点：`src/toolchain/dependencies/runtime/operation-telemetry.ts`；`src/verification`；`src/development`；证据层级：`inventory-and-contract`。

方案：OpenTelemetry；原生profile；裁决：`pilot-if-consumer`。

机制/依据：复用trace标准与导出格式，把工具观测接在已有operation上下文；先原生CPU/heap定位瓶颈，不添加自写APM。

保留：未测量不是0、成本量纲、采样、敏感字段、本地优先、预算与effect权限。

退出：一个观测入口迁移后删除同义timing/export胶水；不让span完成代表业务完成。

验收：context传播、禁用时成本、export失败、长操作、数据外传明示和信号成熟度。

反转：没有trace消费者或无法控制成本/数据流就仅用本地profile，不默认上传。

原始来源：[1](https://opentelemetry.io/docs/languages/js/)。


## R50 无用依赖与导出

消费点：`package.json`；`config`；`src/system-architecture`；证据层级：`manifest-and-inventory`。

方案：现有Knip；裁决：`retain-and-improve-configuration`。

机制/依据：Knip已在devDependencies与脚本中，先把真实CLI/生成器/fixture入口配置完整，而不是再实现同用途全仓扫描。

保留：动态入口、模板安装源、可选provider与公有合同不能被误报删除。

退出：Knip可准确提供的引用事实迁移后删重复扫描；SEC独有closure规则保留。

验收：entry遗漏/动态loader/生成输出、旧only误报、确定性和无关改动影响范围。

反转：分析器不理解的入口必须配置或保留unknown，不直接按报告批量删文件。

原始来源：[1](https://knip.dev/overview/getting-started)。


## R51 依赖图与架构边界

消费点：`src/system-architecture`；`config`；`src/brownfield`；证据层级：`inventory-and-provider-design`。

方案：dependency-cruiser；已有TS图事实；裁决：`pilot-if-consumer`。

机制/依据：通用import/cycle/layer事实可以外包；已有TS sourceprogram facts能复用时先复用，不为同一事实再跑全仓。

保留：SEC module ownership、authority DAG、语义层级、豁免与Target范围。

退出：成功后删除同用途语法/解析胶水；只保留项目规则与事实适配，不引入第二事实权威。

验收：dynamic/type-only/import aliases、package exports、.module边界、报告complete/unknown。

反转：不能覆盖必要解析或重复成本更大时保留已有facts，外库仅离线对照。

原始来源：[1](https://github.com/sverweij/dependency-cruiser)。


## R52 重复代码检测

消费点：`package.json`；`config`；证据层级：`manifest-and-inventory`。

方案：现有jscpd；裁决：`retain-existing`。

机制/依据：jscpd已声明，不新增第二clone scanner。相似文本是审查线索而非可删除证明；上游当前能力不能套用到仓库声明5.1.1。

保留：领域边界、受控fixture重复、原语义与error behavior。

退出：发现真实重复后收敛owner；不要为了压指标把独立业务耦合。

验收：忽略配置合法性、生成/fixture范围、false positive、相似但不同安全语义。

反转：没有实际维护成本的重复不强行抽象；不能以行数削减充当correctness。

原始来源：[1](https://github.com/kucherenko/jscpd)。


## R53 属性与状态机测试

消费点：`tests`；`src/system-architecture/foundation/runtime/canonical.ts`；`src/system-architecture/foundation/runtime/exact-json.ts`；`src/system-architecture/foundation/runtime/directed-graph.ts`；`src/workspace`；证据层级：`source-and-inventory`。

方案：fast-check；裁决：`priority-pilot`。

机制/依据：用生成、shrinking与replay补充固定向量，尤其图分区、canonical bytes、parser、状态迁移和失效顺序；不重复手工发明随机测试器。

保留：独立oracle、领域不变量、真实实现入口、明确seed/版本和故障分类。

退出：保留已有强反例，删真正重复生成胶水；不以随机覆盖代替资源/安全证明。

验收：模型和实现不同源、缩水反例可重放、边界定向、异步取消/late-write序列。

反转：canonical Bun适配未验证时先限定pure helper，不能修改runner仅为通过。

原始来源：[1](https://fast-check.dev/docs/introduction/)。


## R54 变异测试

消费点：`tests`；`src/verification`；证据层级：`inventory-and-provider-design`。

方案：StrykerJS；裁决：`watch-with-trigger`。

机制/依据：用于验证关键断言能杀死真实错误，而不是追求任意全仓分数；先核验Bun/custom runner兼容。

保留：mutation sandbox、时间/进程预算、生成物清理、关键规则与真实断言。

退出：若成熟runner可用，删除等价自写mutator；不为它换掉SEC验证权威。

验收：selected operators、survivor人工解释、超时单列、隔离未授权Effect、可重放。

反转：兼容层比收益大或测试不能受控运行则暂不采用。

原始来源：[1](https://stryker-mutator.io/docs/stryker-js/introduction/)。


## R55 真实数据库/服务集成测试

消费点：`tests`；`catalog`；`src/reference`；`src/external-capabilities`；证据层级：`inventory-and-provider-design`。

方案：Testcontainers；裁决：`watch-with-trigger`。

机制/依据：需要真实Postgres/服务协议时复用容器测试工具；容器引擎必须预先获权，不可在测试中偷偷获取。

保留：image digest、credential isolation、ports、唯一resource owner、数据删除许可与cleanup。

退出：替代重复测试服务启动胶水，保留Target conformance；本任务不运行Actions或拉引擎。

验收：restart/transaction/网络中断、端口冲突、session cleanup、镜像离线与engine不可用。

反转：pure单元用不到真实服务就不加；无法证明引擎权限/清理时不执行。

原始来源：[1](https://node.testcontainers.org/)。


## R56 内存文件系统测试替身

消费点：`tests`；`src/workspace/runtime`；`src/runtime-state/physical`；证据层级：`inventory-and-provider-design`。

方案：memfs；真实临时目录；裁决：`pilot-if-consumer`。

机制/依据：memfs适合纯目录布局/普通读写失败组合，但不会证明NTFS reparse、native handle、fsync或真实TOCTOU行为。

保留：真实物理安全测试继续在实际OS/FS执行，mock结果不得冒充平台证据。

退出：只删通用浅mock胶水，不删物理反例和故障注入边界。

验收：与真实FS对子集差分、路径分隔/大小写、fault injection和清理；严禁mock扩大production authority。

反转：只涉物理句柄/锁的模块不采用memfs替代真实测试。

原始来源：[1](https://github.com/streamich/memfs)。


## R57 既有工作流静态语法

消费点：`.github/workflows`；`src/control`；`src/verification`；证据层级：`inventory-and-provider-design`。

方案：actionlint（本地静态工具）；裁决：`watch-with-trigger`。

机制/依据：可接管YAML/expression/action输入的通用静态检查，不必自写完整GitHub Actions语法。检查文件不等于运行Actions。

保留：SEC独有workflow identity、required checks、scope与权限；用户禁止Actions执行保持。

退出：仅迁通用静态语法部分，不新建执行workflow或移除授权门禁。

验收：表达式注入、shell差异、reusable workflow、锁定工具版本、falsepositive与禁止联网。

反转：无该类静态缺口则不添加；本任务不触发/分发任何Actions任务。

原始来源：[1](https://github.com/rhysd/actionlint/)。


## R58 SBOM 与许可证清单

消费点：`src/release`；`src/toolchain/dependencies`；`catalog`；证据层级：`inventory-and-provider-design`。

方案：cdxgen/CycloneDX；裁决：`pilot-if-consumer`。

机制/依据：包识别、标准BOM生成可交专业工具；安装图不等于发布产物保留闭包，源码复制和native二进制同样有来源责任。

保留：exactsource/lock/build/artifact、原始材料、新鲜性、许可证分发和产品Target。

退出：采用后删除手工标准格式拼装，保留source→artifact归属验证与独立readback。

验收：双依赖域、dev/runtime、workspace、vendored/native、最终产物漏项和旧SBOM拒绝。

反转：目标锁格式不支持或工具执行默认联网超界，则仅候选或受限离线输入。

原始来源：[1](https://github.com/cdxgen/cdxgen)。


## R59 签名与执行来源

消费点：`src/release`；`src/semantic/provenance`；`src/verification`；证据层级：`inventory-and-provider-design`。

方案：Sigstore/cosign；裁决：`watch-with-trigger`。

机制/依据：签名验证与标准attestation可复用；摘要只证明字节，签名只绑定某身份声明，不自动证明业务正确或真实测试完整。

保留：trusted issuer/subject、材料、执行环境、时间/撤销、policy版本与离线验证范围。

退出：确需外部供应链互认时替换标准签名胶水，不替换SEC acceptance/merge owner。

验收：wrong issuer/artifact、过期/离线、missingtransparency、keyrotation、failclosed。

反转：无身份信任需求只做内部sha256时不引入全签名基础设施；不上传秘密。

原始来源：[1](https://docs.sigstore.dev/about/overview/)。


## R60 应用认证与会话

消费点：`catalog/registry/official/auth.basic-session/files/src/installed/auth/session.ts`；`catalog/registry/official/auth.basic-session/block.manifest.yaml`；`src/reference`；证据层级：`source-read`。

方案：OIDC Provider；openid-client；jose；裁决：`separate-fixture-from-production`。

机制/依据：已读样例有固定用户和password字面量，manifest可copy安装。它可保留为reference fixture，不能靠auth/session名称充当生产认证。

保留：tenant/actor/session合同、CSRF/redirect/cookie、secret与provider故障；不自动改变现有用户。

退出：真实目标通过成熟认证适配后退役该生产route，保留清楚标记的测试fixture和负例。

验收：wrong audience/issuer、session撤销、租户隔离、回调绑定、重放/过期、无default密码生产准入。

反转：本轮未证明实际部署使用该fixture，不报告已发生认证漏洞；无真实服务消费者不安装框架。

原始来源：[1](https://github.com/panva/openid-client)；[2](https://github.com/panva/jose)。


## R61 生成应用的真实持久化

消费点：`src/compiler/compose/templates/lib/database.ts.template`；`catalog`；`src/reference`；证据层级：`source-read`。

方案：目标既定Prisma；pg/Bun.SQL；裁决：`separate-fixture-from-production`。

机制/依据：模板无论memory或postgres-contract均createDatabase内存数组，标签不构成Postgres连接。复用真实SQL/ORM provider，不自写生产数据库引擎。

保留：schema、tenant过滤、事务、读回、连接ownership、未知/回滚/副作用和显式Target。

退出：生产路由迁移后删除假持久化路径；reference memory store保留清楚用途，不误认数据迁移已完成。

验收：真实数据库重启保留数据、rollback、多tenant、连接释放、重复提交与契约升级。

反转：只有fixture需求维持memory；pg事务必须同client，不能用pool.query假装一笔事务。

原始来源：[1](https://node-postgres.com/features/transactions)；[2](https://bun.sh/docs/runtime/sql)。


## R62 基础hash、clone、时间与取消

消费点：`src/system-architecture/foundation/runtime/canonical.ts`；`src/system-architecture/foundation/runtime/native-abort.ts`；`src/system-architecture`；证据层级：`source-and-inventory`。

方案：原生node/Web Crypto；structuredClone；AbortController；裁决：`retain-native`。

机制/依据：原生标准能力已在使用，优先继续复用；不要为一层同名封装新增随机/深拷贝/哈希工具包。

保留：typedarray真实字节快照、禁止hook、clock域、不可克隆对象、abort观察与物理settlement区别。

退出：删除真的重复pure算法，但品牌对象与能力不能被clone成可传递权限。

验收：负0/NaN/BigInt、accessor/prototype、clock跳变、早取消、非合作操作。

反转：只有原生缺算法或流式能力的实际消费者才引入专项库，不能仅按速度宣传替换安全原语。

原始来源：[1](https://nodejs.org/api/crypto.html)；[2](https://nodejs.org/api/globals.html)。


## R63 Agent/MCP 与上下文检索

消费点：`docs/governance/external-capability-ledger.yaml`；`src/external-capabilities`；`src/control/agent`；证据层级：`ledger-and-inventory`。

方案：已存在受控接口；必要时官方MCP SDK；裁决：`retain-minimal-surface`。

机制/依据：现有ledger已拒绝无必要消费者的常驻graph-it MCP，codegraph仍watch。复用协议不等于同时开放多套重复检索/写入服务器。

保留：delegation边界、query字节/条数/期限、source witness、principal、write操作和无默认遥测。

退出：必要SDK仅接管协议胶水，成功后删自写消息格式；无用provider、配置、凭据、cache完整退役。

验收：prompt/tool output不授予权限、过时protocol、断连、引用失效、响应超界。

反转：明确cross-file消费需求且单一provider有净收益才重开候选；本次不安装/调用MCP。

原始来源：[1](https://modelcontextprotocol.io/specification/2026-07-28)。


## R64 图形与编辑器投影

消费点：`src/interface`；`docs`；`public-docs`；`src/semantic/projection`；证据层级：`inventory-and-target-design`。

方案：既有Mermaid/LSP；条件性编辑器/图布局库；裁决：`watch-with-trigger`。

机制/依据：可视化或结构编辑确有用户界面消费者时复用渲染/布局/编辑器，不为CLI仓库先安装整套前端。图像/坐标不是canonical语义。

保留：实体与Clause身份、round-trip、访问权限、只读投影与显式mutation、可访问性。

退出：真实UI试点通过再删重复布局/编辑胶水，不建立视图与IR两份可变业务模型。

验收：大图、循环、增量布局、选择映射、隐藏字段、undo/冲突、无法表达操作显式拒绝。

反转：无真实UI消费者维持文档/CLI投影；未选择具体库不是静默默许自写通用渲染器。

原始来源：[1](https://microsoft.github.io/language-server-protocol/)。
