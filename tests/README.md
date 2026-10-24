# 测试导航

先找观察层，再找被测职责。文件名说明对象与行为，测试标题说明输入条件、结果或拒绝边界；不按修复批次、审计轮次或 `hardening` 历史组织新文件。

## 观察层

- [unit](unit/)：直接观察一个责任模块及其明确适配边界。
- [contract](contract/)：公开协议、准入、可信边界和跨模块约定。
- [integration](integration/)：真实组合、持久化、资源与恢复链。
- [e2e](e2e/)：从命令或用户工作流入口观察完整结果。

这四层描述观察范围，不等于 fast/slow，也不签发平台资格。已有测试仍按其实际观察判断，不凭所在目录宣称端到端或物理验证。

## 物理测试源码与运行边界

**单一真实测试源码，不复制第二套 Gift/SEC 测试代码。** Claim、ProofObligation、VerificationMethodSelection、CasePlan/casesRef 表达的是逻辑要求、选择与准确用例引用；真实测试由原语言、runner 和宿主执行。Gift 可以按已接受的声明为目标工程物化测试，但不能由同一个被测实现推导 expected 然后宣称自己证明自己。

| 物理位置 | 稳定责任 |
| --- | --- |
| `src/**/<owner>.test.ts` | 已存在并与稳定模块/合同 owner 共置的原语测试；经现有注册与 selector 发现，不为美化目录统一移动。 |
| `tests/unit/<domain>/` | 纯规则、局部模块、算法、有限输入与已建立的单一适配边界。 |
| `tests/contract/<domain>/` | 实际消费者承诺的公共协议、身份、权限、接口和拒绝合同。 |
| `tests/integration/<domain>/` | 真实组件、文件、进程、Git、跨 owner 组合、物理终态与恢复读回。 |
| `tests/e2e/<domain>/` | 真实 CLI／开发者工作流的可观察完成结果；不重复下层整个算法矩阵。 |
| `tests/testkit/`、`tests/helpers/`、`tests/fixtures/`、`tests/setup/` | 有实际消费者的测试隔离／清理设施、共享构造／断言、固定输入及必需初始化。设施的防假绿、资源结算责任须保留，但不能与生产共用 expected 生成器自证。 |
| `catalog/registry/official/*/files/tests/`、`src/**/templates/tests/` | 由安装清单／编译输出物化到**目标工程**的测试、共享 suite 与模板；源模板不是仓库 Bun runner 已注册或已运行的用例。 |
| `tools/**/tests/`、`**/*.typecheck.ts` | 已采用 Python 工具测试及编译期类型观察，各按真实测试／编译资格发现，不混入 Bun 执行统计。 |

`<domain>` 取本导航的真实职责域，仅在该层确有必要观察时建目录。时间、性能、随机、压力、安全和回归是方法及执行资格属性，不额外制造另一套物理目录。测试文件名字描述能力与行为，不按修复批次、历史轮次或纯内部实现细节分组；既不把每个断言独立成文件，也不为少注册塞入跨独立 timeout／失败终态的巨型用例。

新增测试先检查现有主责测试是否足以承接；只有独立失败模型、不同宿主资格、隔离／结算窗口等真实需要时才新建测试文件。迁移或删除须对齐源码身份及动态发现、所有直接／间接消费者、固定独立 oracle、共享 fixture、fast/slow／平台／超时资格、生成工程安装路径与接受关系，先落实承接再退役。文件移动并非无成本格式工作；无实质收益不得挪动。运行中生成的报告与资源归原工作空间及临时作用 owner，不能污染编译源码或代替静态测试定义。

## 职责域

每层使用同一套域名；只建立有实际测试的目录。

| 域 | 应保护的结果与输入边界 | 最终集合的观察选择 |
| --- | --- | --- |
| core | 规范编码／摘要身份；集合、图、错误合同的空值、重复、乱序、非法输入与资源边界 | unit 用独立固定向量、小域参考关系或适用性质；仅真实跨边界格式增加 contract，不在每个调用者重复算法矩阵。 |
| cli | 参数与来源捕获、路由、输出和退出语义；成功、拒绝、未知、取消与部分结果 | unit／contract 覆盖选项和协议等价类；e2e 只补不同装配路径的真实 stdin/stdout/stderr/exit 见证，不重跑编译和恢复全集。 |
| compiler | 当前支持的 IR、引用／根选择、转换与生成语义；缺失、冲突、共享依赖和第二次编辑 | unit 用手写小模型或独立参考关系；contract 保公共结构；integration 用真正下游消费者检验生成结果，不用生产编译器生成自己的 expected。 |
| workspace | 作者源与 candidate 隔离、来源解析、组合和写回；受管／原生／未知文件、前像漂移、部分作用与恢复 | 纯规则在 unit，owner／授权在 contract；integration 对独立源字节、成员集合和 journal 读回；e2e 保小型连续开发流程，物理原语矩阵归 runtime。 |
| runtime | 文件与路径身份、锁、进程／句柄寿命、预算、取消和结算；检查后漂移、并发、超限及失败清理 | unit 保状态与预算规则；contract／integration 保真实 FS、进程及平台故障模型。Linux／Windows 资格分别成立，mock 平台名不取得原生资格。 |
| toolchain | 工具调用、依赖代次、安装／物化／借用／退役；缺工具、冷暖／离线、损坏、取消和中断 | unit／contract 保本仓适配合同；integration 读回真实工具和依赖结果，只验证新增接合与生命周期，不重测上游工具全部语义。 |
| providers | Git／GitHub／Docker 等请求与结果绑定；权限、过期身份、分页、部分响应和作用后失联 | 协议等价类在 unit／contract，必要真实能力在 integration；以独立原生读回或真实查询确认效果，不用 mock 预设回包证明远端成功。 |
| repository | 源码观察、架构边界、依赖／影响及审计判错；合法变体、真实违规、缺输入和过期结果 | unit 保规则逻辑；contract 保范围；integration 用小型实际源码／Git fixture 注入违规。文档源身份与保全工具同理，不锁偶然源码字符串或文件数量。 |
| verification | 证据适用性、选择、复用、in-flight join 和准确结算；subject／规则／输入／环境变化、缺覆盖、伪造与迟到结果 | 手写需求集合和适用关系作 oracle；integration 观察真正所选目标、启动及终态。每个 suite 只补其发现／接线差额，不复制调度器矩阵。 |
| development | 工作准入、源码检查点／正式采用、freeze、分支／Hooks 和续接；准确 main/head/tree/index、proposal／activation、dirty 归属及原操作恢复 | unit 保纯状态／投影，contract 保权限与身份，integration 用真实 Git＋持久状态，e2e 只补 dev 入口。复用 providers/runtime/verification 的原语保障，保留本域组合差额。 |
| release | 发布闭包、成员、来源与真实消费；源漂移、缺依赖／资源／许可、错误平台、打包中断及制品不一致 | unit 保选择，contract 保声明，integration 独立解包核成员，e2e 用真实目标消费者。语义任务列表不冒充完整可运行包，也不复测压缩器或编译器全集。 |

同一能力的不同观察层可以各有测试，但必须保护独立结果或边界，不复制整套相同输入矩阵。共享保障集中到实际责任拥有者，入口只保留接线和自身差异。

这张表指导按已有分类选择最终测试集合，不是为每域分配数量或要求四层齐全。先从当前有效合同、真实消费者和失败后果确定输入等价类与独立判错依据，再复用已经足够强的测试作为骨架；旧测试只用于核对遗漏的反例、平台和恢复责任，不反向决定哪些行为必须存在。尚未实现的设计保留实现缺口与验收条件，不以占位成功标绿。

## 主责能力族与跨族保障

四个观察层与十一个职责域是正交视图，不是测试族的数量配额。语义主责树按职责域组织，只细化到稳定的公开能力族；族由有效用户结果、准入与失败边界、生命周期及恢复责任划界，不按文件、清理批次或任意条数划界。物理目录保持现有布局，`src` 共置、目标工程模板和 Python 工具仍按各自入口核对。

每个已归属的测试身份只有一个主责族，按其主要公开保障归属；跨族依赖、共同保障与承接关系允许多对多，不因跨文件或跨观察层而重复计算成员。不能唯一判定时保留“未归属”，必要性未决另记；归属、已读和当前应保留不是同一结论。全仓尚未形成完整唯一映射时，不从文件数、批次或局部审查组推算总族数。

沿已有来源身份和审查记录渐进补映射，缺少映射不阻塞已有独立证据的清理；不要求小任务先建立全仓族树、每条测试新增分类声明，也不另建注册表或执行平台。只有实际义务、消费者或保障差额变化才修订设计和相交映射；设计写入不代表全仓已经应用。合并仍须保执行资格、反馈频率和各自预算窗口，不为减少注册数压缩原生多世界的有效保障。

例如文档控制沿现有 development 域，按准入／纯投影、发布与幂等、持久切点恢复、物理身份竞态、终态退役五组选择保障；纯模型不必建立 Git 仓库，真实接合则必须读取 Git／文件系统结果。通用物理原语仍由 runtime 的测试承担，不为这五组另建目录体系。先落实缺失的必要观察及准确承接，再整组退出重复旧例、无消费者 helper 和多余准备；不是先删光再补，也不是把全部断言塞进一个巨大生命周期用例。

表驱动减少重复源码，不自动减少运行实例；性质测试须有适用输入域与独立性质，不能用随机次数代替覆盖。一个失败模型在上层没有新增风险时不重复整套下层矩阵；不同崩溃切点、平台或权限旁路确有独立后果时不为减数删掉。测试源码存在、静态承接判断、实际运行及平台资格分别报告。

## 完整主责结构快照

以下为一次已经完成的主责映射**历史快照**，不代表以后提交或当前分支的全部测试身份。绑定源码测试快照 [`55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3`](https://github.com/sec-platform/sec/tree/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3)，不是对以后 HEAD 的自动统计。该快照以后已经发生测试源码的增加、删除和重写，因此下列计数、能力族映射及 A/B/C 结论仅适用于该固定 SHA；不能代替当前 HEAD 的正式发现和必要性复核。测试或责任来源变化后须按变化闭包更新相交证据。

本快照共 **11 个职责域、154 个能力族、4722 个唯一静态身份、727 个源及模板路径**，每个身份恰有一个主责族，未归属 **0**。族按实际公开能力划界，不按操作系统、unit/integration 层次或文件拆分。不同族可共享底层保障；共享关系不是额外成员，也不构成此表声明的完整依赖图。

静态单位互斥口径：TypeScript 登记点及模板 **4536**（普通 3963、条件 268、参数/循环 300、动态标题 2、安装运行时模板 2、升级 fixture 注册 1），Python 方法 **165**，间接 suite **15**（安装 14、升级 fixture 1），编译期类型模块 **6**。这 4722 个混合单位不是 runner 发现或执行的用例总数；参数展开、实际运行实例与断言总数未据此推算。**全部执行状态为 NOT_RUN**，不得解读为测试通过。

必要性与组织归属分开：当前 **A 4716 / B 6 / C 0**。A 表示已完成来源绑定的有界公共保障集合比较，有明确保留观察，不宣称全仓全球最小或每个参数最小；B 表示目标、参数或执行资格仍有明确未闭合问题，保留待决；C 表示证据尚未续绑，本快照为 0。B 的主责也可明确，不因有族名而升级为 A。产品缺口、完整恢复资格和运行结果同样不能由这张表推定完成。

| 职责域 | 能力族 | 静态身份 |
| --- | ---: | ---: |
| [core](#snapshot-core) | 13 | 161 |
| [cli](#snapshot-cli) | 4 | 171 |
| [compiler](#snapshot-compiler) | 15 | 304 |
| [workspace](#snapshot-workspace) | 22 | 485 |
| [runtime](#snapshot-runtime) | 12 | 581 |
| [toolchain](#snapshot-toolchain) | 5 | 422 |
| [providers](#snapshot-providers) | 10 | 355 |
| [repository](#snapshot-repository) | 27 | 585 |
| [verification](#snapshot-verification) | 23 | 828 |
| [development](#snapshot-development) | 22 | 795 |
| [release](#snapshot-release) | 1 | 35 |

每域可展开查看全部族名与成员数。入口链接固定到上述源码快照，展示该族已有测试文件的代表；它们不是新增的执行入口或第二份注册清单。四个观察层与执行资格仍分别按本页前后两节理解，不能由主责域或文件名推得平台/原生资格。

<a id="snapshot-core"></a>
<details>
<summary>core：13 族 / 161 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| JSON诊断输出 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/cli/json-value-output.test.ts) |
| UTF8文本编解码 | 3 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/utf8.test.ts) |
| YAML文档准入 | 1 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/formats/yaml.test.ts) |
| 严格JSON准入 | 24 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/core/exact-json-depth-admission.test.ts) |
| 内容摘要 | 18 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/content-digest.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/content-hash-provider-boundary.test.ts) |
| 取消信号组合 | 6 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/native-abort-contract.test.ts) |
| 有向图强连通分量 | 10 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/directed-graph.test.ts) |
| 有界字节快照 | 2 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/byte-tail-snapshot.test.ts) |
| 版本化语义身份 | 13 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/identity-profile.test.ts) |
| 规范数据编码 | 35 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/core/canonical-array-traversal.test.ts) |
| 逻辑路径身份与包含 | 16 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/core/logical-path-device-names.test.ts) |
| 错误身份与安全诊断 | 20 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/failure.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/core/compiler-failure-formatting.test.ts) |
| 集合投影与只读快照 | 9 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/core/collections.test.ts) |

</details>

<a id="snapshot-cli"></a>
<details>
<summary>cli：4 族 / 171 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| 命令参数捕获与派发 | 70 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/cli/environment.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/cli/artifact-command-input.test.ts) |
| 命令结果投影与展示 | 42 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/cli/ci-command-contract.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/cli/verification.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/cli/block-usage-map-presentation.test.ts) |
| 查询入口与制品选择 | 30 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/cli/acceptance-inspection-routing.test.ts) |
| 输出与失败协议 | 29 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/cli/cli-usage-process.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/cli/cli-failure-lifecycle.test.ts) |

</details>

<a id="snapshot-compiler"></a>
<details>
<summary>compiler：15 族 / 304 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| Block身份与清单准入 | 2 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/compiler/block-physical-key-codec.test.ts) |
| IR身份与事实差分 | 27 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/compiler/fact-delta-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/canonical-ir-identity-revision.test.ts) |
| Manifest 依赖闭包 | 54 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/versioned-manifest-resource-overlay.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/manifest-graph-resolution.test.ts) |
| Pipeline 执行策略 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/architecture-contracts.typecheck.ts) |
| Plan声明准入 | 7 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/plan-schema-reuse.test.ts) |
| Prisma模式合并 | 13 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/prisma-merge.test.ts) |
| YAML声明准入 | 30 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/override-schema-reuse.test.ts) |
| 工程IR准入与事实索引 | 90 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/semantic-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/canonical-keyed-deduplication.test.ts) |
| 影响传播 | 12 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/compiler/impact-propagation-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/impact-propagation.test.ts) |
| 模板条件与字节渲染 | 7 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/render-template-string.test.ts) |
| 状态迁移源码生成 | 9 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/state-transition-source.test.ts) |
| 目标物化模式 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/opaque-materialization-mode.test.ts) |
| 语义目标发布 | 14 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/workspace/semantic-runtime-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/semantic-lowering-admission.test.ts) |
| 语义视图与生成计划 | 30 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/semantic-projections.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/compiler/semantic-architecture-boundary.test.ts) |
| 运行依赖与类型边界 | 1 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/toolchain/dependency-contract-imports.test.ts) |

</details>

<a id="snapshot-workspace"></a>
<details>
<summary>workspace：22 族 / 485 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| 升级计划与修复 | 106 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/workspace/dry-run-plan.test.ts) · [升级 fixture](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/fixtures/block-upgrade-workspace/tests/acceptance/customer-flow.test.ts.fixture) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/dry-run-directories.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/db-expand-contract.test.ts) |
| 参考工程一致性 | 8 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/workspace/reference.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/workspace/reference-pipeline.test.ts) |
| 工程写回授权与漂移防护 | 34 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/check-drift.test.ts) |
| 工程源捕获与候选隔离 | 35 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/author-candidate.test.ts) |
| 工程状态与制品读回 | 34 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/cli/artifacts.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/cli/overview.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/artifact-command-read.test.ts) |
| 当前验证证据与写回准入 | 8 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/current-verification-cutover.test.ts) |
| 生成应用运行时组合 | 2 | [运行时模板](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/compilation/compose/templates/tests/runtime/unit/customer-runtime.test.ts.template) |
| 目标工程Agent任务执行 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/agent.executor/files/tests/acceptance/agent-classifier-flow.test.ts) |
| 目标工程CSV导出 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/export.csv-basic/files/tests/unit/customer-export.test.ts) |
| 目标工程审计记录 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/audit.basic/files/tests/unit/audit-log.test.ts) |
| 目标工程客户管理 | 2 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/entity.customer-basic/files/tests/acceptance/customer-flow.test.ts) |
| 目标工程工单报表 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/reporting.ticket-summary/files/tests/unit/ticket-summary.test.ts) |
| 目标工程工单管理 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/ticket.basic/files/tests/acceptance/ticket-flow.test.ts) |
| 目标工程工单评论 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/comment.basic/files/tests/acceptance/comment-flow.test.ts) |
| 目标工程工时记录 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/worklog.basic/files/tests/acceptance/worklog-flow.test.ts) |
| 目标工程持久化合同 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/infra.postgres/files/tests/unit/postgres-contract.test.ts) |
| 目标工程身份与授权 | 2 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/auth.basic-session/files/tests/acceptance/auth-flow.test.ts) |
| 目标工程通知出站记录 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/notify.email-basic/files/tests/unit/email-outbox.test.ts) |
| 目标工程附件管理 | 1 | [安装 suite](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/catalog/registry/official/file.upload/files/tests/acceptance/customer-attachments-flow.test.ts) |
| 组合发布与生命周期 | 95 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/workspace/workspace-lifecycle-template-boundary.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/cli/workspace.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/pipeline-workspace-write-lease.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/add-block-application.test.ts) |
| 编译事务与阶段接合 | 44 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/workspace/pipeline-journal-isolation.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/workspace/pipeline.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/pipeline-kernel.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/pipeline-context-admission.test.ts) |
| 语义变更计划与事务恢复 | 105 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/workspace/semantic-mutation-apply-contract.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/workspace/semantic-runtime-contract.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/semantic-mutation-apply.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/semantic-mutation-admission-lifecycle.test.ts) |

</details>

<a id="snapshot-runtime"></a>
<details>
<summary>runtime：12 族 / 581 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| 原生目录变更观察 | 7 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/repository-change-observer.test.ts) |
| 原生进程执行与结算 | 76 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/linux-executable-sealing.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/pipeline-workspace-write-lease.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/observed-process-lifecycle.test.ts) |
| 宿主身份与可信位置 | 5 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/windows-known-folders.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/linux-unix-peer-native.test.ts) |
| 持久作用记录与恢复准入 | 15 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/workspace-state/durable-execution/contract.test.ts) |
| 派生状态登记与退役 | 68 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/generated-state/contract.test.ts) |
| 物理文件身份与安全变更 | 212 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/linux-directory-identity.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/workspace/pipeline-workspace-write-lease.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/canonical-publication-snapshot.test.ts) |
| 结构化并发与任务调度 | 32 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/concurrency-provider-contract.test.ts) |
| 语义操作授权与资源准入 | 17 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/execution/operation/effect-grant.test.ts) |
| 资源寿命与取消结算 | 41 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/resource-settlement.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/acquired-resource-scope.test.ts) |
| 运行状态存储与缓存 | 47 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/retained-runtime-state-directory.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/runtime-state-layout.test.ts) |
| 运行进度与非干扰诊断 | 11 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/execution-progress.test.ts) |
| 隔离执行输入与宿主能力 | 50 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/linux-immutable-repository-input.test.ts) · [Python](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/runtime-state/physical/runtime/linux-verification-unit-helper.test.py) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/runtime/physical-no-follow.test.ts) |

</details>

<a id="snapshot-toolchain"></a>
<details>
<summary>toolchain：5 族 / 422 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| TypeScript执行与增量状态 | 26 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/toolchain/typescript/incremental-state.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/toolchain/typescript-incremental-lifecycle.test.ts) |
| 依赖版本适用性评估 | 6 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/toolchain/dependencies/test/dependency-freshness-application.test.ts) |
| 原生 TypeScript 检查器发行与装载 | 4 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/toolchain/typescript-native-package-layout.test.ts) |
| 编译依赖协调与代际恢复 | 376 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/toolchain/dependencies/runtime/source-generation.test.ts) · [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/toolchain/dependency-capability-contract.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/toolchain/compiler-dependency-external.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/toolchain/compiler-install-invocation.test.ts) |
| 运行包入口与版本 | 10 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/toolchain/runtime/bun-version.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/toolchain/runtime-entrypoint-contract.test.ts) |

</details>

<a id="snapshot-providers"></a>
<details>
<summary>providers：10 族 / 355 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| Docker命令与端点生命周期 | 44 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/providers/docker/contract/windows-installation-profile.test.ts) |
| GitHub凭证资源与保密 | 10 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/github-api-credential.test.ts) |
| GitHub操作会话与权限观察 | 46 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/github-api-operation-session.test.ts) |
| GitHub验证运输与制品读取 | 25 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/providers/github-hosted-resume-dispatch.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/github-api-verification.test.ts) |
| Git对象名称身份 | 3 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/contracts/git-object-id.test.ts) |
| Git源码快照运输 | 22 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/providers/git-bundle/runtime-scale.test.ts) |
| Git观察与索引身份 | 159 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/providers/repository-git-observation.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/exact-git-blob.test.ts) |
| Git配置与引用作用 | 18 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/providers/git/config-effect.test.ts) |
| 包注册表读取 | 3 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/providers/package-registry/runtime/anonymous-registry.test.ts) |
| 受信宿主工具与运行环境 | 25 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/providers/windows-control-cli-provider-boundary.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/linux-verification-environment.test.ts) |

</details>

<a id="snapshot-repository"></a>
<details>
<summary>repository：27 族 / 585 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| Source Program审计wire与历史结果 | 32 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/repository-audit/source-program-audit-operation.test.ts) |
| 仓库unused诊断准入 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/repository-unused-code-admission.test.ts) |
| 声明引用拓扑 | 1 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/declaration-topology.test.ts) |
| 实现归属与意图匹配 | 22 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/implementation-dominance.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/owner-intent-index.test.ts) |
| 审计 worker 字节协议 | 11 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/repository-audit/worker-protocol.test.ts) |
| 审计worker结果与结算 | 4 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/repository-audit/terminal.test.ts) |
| 审计请求与公开判定 | 39 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/repository/repository-audit.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/repository-audit-cli-contract.test.ts) |
| 审计运行源与持久投影 | 7 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/repository-audit/dispatcher-projection.test.ts) |
| 密封Knip静态分析执行 | 1 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/repository-audit/knip-provider.test.ts) |
| 操作实现源码闭包 | 15 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/producer-closure.test.ts) |
| 文本字节与Git属性治理 | 15 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/repository/text-byte-census.test.ts) |
| 文档与Agent治理 | 20 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/development/agent-skills.test.ts) |
| 文档源身份与保全 | 51 | [Python](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tools/documentation/tests/test_check_documentation_identity.py) |
| 文档设计一致性 | 20 | [Python](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tools/documentation/tests/test_check_design.py) |
| 文档阅读投影与安全发布 | 81 | [Python](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tools/documentation/tests/test_build_html.py) |
| 权限引导源码投影 | 6 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/repository/permission-bootstrap-projection.test.ts) |
| 架构准入与职责边界 | 28 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/architecture/contract.test.ts) |
| 模块依赖图生成 | 17 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/embedded-programs.test.ts) |
| 测试保障价值与处置 | 18 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/reduction-test-retirement.test.ts) |
| 测试表面观察与影响 | 15 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/test-impact-projection.test.ts) |
| 源码编译与可信增量复用 | 57 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/repository-compilation-cache-provider.test.ts) |
| 源码能力与职责事实 | 14 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/repository-responsibility.test.ts) |
| 源码规约与替代计划 | 20 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/reduction-plans.test.ts) |
| 精确TypeScript语义观察 | 9 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/typescript-capability-closure.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/import-compiler-capability-admission.test.ts) |
| 能力机制诊断 | 26 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/audit-mechanism-projection.test.ts) |
| 跨版本声明对账 | 46 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/reconciliation-projection.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/reconciliation-declaration-matching.test.ts) |
| 输入面与资源分类 | 6 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/repository/source-program-model/contract.test.ts) |

</details>

<a id="snapshot-verification"></a>
<details>
<summary>verification：23 族 / 828 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| CI作业与门禁装配 | 26 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/verification/ci-contract.test.ts) |
| CI结果输出发表 | 3 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/verification/ci-transition-output-publication.test.ts) |
| Source Program再评估准入 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/repository/source-program-reassessment-admission.test.ts) |
| Verification Action 生命周期 | 78 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/verification-action-ci-contract.test.ts) |
| 产物来源身份与准入 | 9 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/verification/provenance-projection-hash.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/provenance-validation.test.ts) |
| 变更影响与测试选择 | 51 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/verification/platform/test-impact/runtime/impact.test.ts) · [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/cli/test-budget.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/ci-git-changed-files.test.ts) |
| 可信计算闭包与引导 | 43 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/verification/ci-trust-closure-contract.test.ts) |
| 托管隔离执行与可信物化 | 68 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/verification/hosted-sut-supervisor.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/ci-hosted-sut-observation-contract.test.ts) |
| 托管验证来源与传输 | 57 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/verification/platform/ci/contract/hosted-step-output.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/verification-action-github-provider.test.ts) |
| 测试工作区与临时资源生命周期 | 52 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/test-process-temp.test.ts) |
| 测试请求规划与执行 | 105 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/cli/verification.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/providers/repository-git-observation.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/fast-test-concurrency.test.ts) |
| 独立 Review 资格与稳定结论 | 30 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/review-stability-contract.test.ts) |
| 策略报告与审查投影 | 9 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/policy-report-authority.test.ts) |
| 类型检查准入与执行 | 24 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/toolchain/typecheck-provider-boundary.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/toolchain/registry.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/toolchain/typecheck-command-startup.test.ts) |
| 语义变更隔离验证 | 27 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/verification/isolation/isolated-verification-child-outcome.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/assert-isolated-staging-tree-race.test.ts) |
| 验收身份与覆盖证明 | 17 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/acceptance-coverage-authority.test.ts) |
| 验证会话编排与恢复 | 93 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/local-preparation-v2-contract.test.ts) |
| 验证制品准入与发布 | 35 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/verification/verification-session-artifact-files.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/ci-artifact-authority.test.ts) |
| 验证报告与治理摘要 | 7 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/verification/summary.test.ts) · [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/cli/review.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/workspace/runtime-attribution-structure.test.ts) |
| 验证提供者能力投影 | 6 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/verification-provider-capability-contract.test.ts) |
| 验证策略与检查执行 | 9 | [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/verification/lanes.test.ts) |
| 验证结果与证据采纳 | 64 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/verification/verification-result-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/pipeline-proof-data.test.ts) |
| 验证重资源租约 | 11 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/verification/heavy-lease-lifecycle.test.ts) |

</details>

<a id="snapshot-development"></a>
<details>
<summary>development：22 族 / 795 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| Agent 任务规划与可信激活 | 68 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/self-hosting/control/agent/runtime-root.test.ts) · [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/development/operation-read-plan.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/agent-operation-activation.test.ts) |
| Git Hooks 与工作区过渡 | 72 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/self-hosting/development/workspace-transition/contract.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/development/install-git-hooks-actor-races.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/install-git-hooks.test.ts) |
| Issue 处置与目标收束 | 9 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/issue-disposition-contract.test.ts) |
| 主干健康与修复准入 | 35 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/verification/ci-trust-closure-contract.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/main-health-contract.test.ts) |
| 仓库主干权限策略 | 12 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/main-authority-ruleset-contract.test.ts) |
| 仓库维护与引用退役 | 13 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/exact-ref-batch-retirement.test.ts) |
| 仓库观察与零写入约束 | 9 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/providers/repository-git-observation.test.ts) |
| 候选工作树取得与退役 | 9 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/development/local-candidate-worktree.test.ts) |
| 分支收尾与恢复 | 88 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/branch-batch-recovery.test.ts) |
| 导入规范化与源码事务 | 63 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/self-hosting/development/import-normalization/contract.test.ts) · [e2e](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/e2e/development/import-organizer-staged.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/import-organizer-pre-commit.test.ts) |
| 工作树与本地残留退役 | 75 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/branch-local-residue-closeout.test.ts) |
| 工作选择与任务绑定 | 62 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/repository/repository-audit.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/work-package-contract.test.ts) |
| 开发命令执行与依赖准备 | 55 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/command-runner.test.ts) |
| 托管集成与恢复交接 | 3 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/verification/hosted-integration-output.test.ts) |
| 文档控制与正式采用 | 102 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/development/current-work-package-census.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/document-control-plane-github-observation.test.ts) |
| 文档源身份与封包 | 12 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/active-documentation-contract.test.ts) |
| 本地续接与失效 | 10 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/continuation-invalidation.test.ts) |
| 本地验证Runner生命周期 | 18 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/providers/local-github-actions-runner-lifecycle.test.ts) |
| 源码检查点与提交 | 23 | [共置](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/src/adapters/self-hosting/development/commit-admission/candidate.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/development-commit.test.ts) |
| 源程序过渡与观察 | 6 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/source-program-transition-use-case.test.ts) |
| 范围授权 | 4 | [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/scope-authorization-contract.test.ts) |
| 集成授权与合并门禁 | 47 | [contract](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/contract/development/merge-gate.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/development/integration-authorization-contract.test.ts) |

</details>

<a id="snapshot-release"></a>
<details>
<summary>release：1 族 / 35 静态身份</summary>

| 能力族 | 静态身份 | 现有测试入口（代表） |
| --- | ---: | --- |
| 可复现发布与制品闭包 | 35 | [integration](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/integration/release/documentation-source-capture.test.ts) · [unit](https://github.com/sec-platform/sec/blob/55271f3b8fb86336c2fefbb40d40cb5ecf5d28b3/tests/unit/release/release-artifact-manifest.test.ts) |

</details>

## 不应搬进这里的测试

- [src](../src/) 中共置的测试：跟随被测模块，适合局部合同与内部机制。
- [catalog](../catalog/registry/official/) 中的测试：属于安装到目标工程的 Block 内容，位置由各清单消费，不是本仓库测试的重复副本。
- [组合器运行时测试模板](../src/adapters/compilation/compose/templates/tests/runtime/unit/)：按已启用的 Block 物化到目标工程的 `tests/runtime/unit`，验证生成的数据库接线与能力组合；模板本身不是本仓直接执行的测试。
- [升级工作区测试 fixture](fixtures/block-upgrade-workspace/tests/)：准备升级工作区时去掉 `.fixture` 后缀，分别进入目标工程的 acceptance 与 runtime 测试入口。
- [文档工具测试](../tools/documentation/tests/)：跟随 Python 工具及其发现规则。

## 支持代码与执行资格

- [helpers](helpers/) 保存被实际多个用例消费的语义 fixture；[testkit](testkit/) 保存工作区、进程等通用测试设施。
- [fixtures](fixtures/) 保存输入与子进程程序；[setup](setup/) 保存运行环境准备。支持文件不冒充独立测试注册。
- 域内专属 fixture 跟随其消费者；共享准备不在模块加载时执行有副作用的工作。
- [测试预算](../src/adapters/verification/platform/test-impact/contract/budget.ts) 拥有 slow suite、宿主和预算声明；[fast 策略](../src/adapters/self-hosting/development/runner/fast-test-policy.ts) 拥有排除项、隔离与资源分组。移动文件须同步真实消费者，不改变 suite 身份、频率或平台要求。
- 测试价值、合并与退役判据见[测试设计](../.agents/skills/test-design/SKILL.md)。此页只导航，不另建测试清单、执行器或审计台账；静态整理不表示测试运行通过。

## 核对数量与保留依据

“测试声明”是源码中的真实注册调用或测试方法，不是要求再维护一份同名清单。注册点、参数展开后的实例、间接 suite、Python 方法、类型级模块和生成模板不是同一种计数单位；循环内一个注册点也不一定只产生一个运行实例。

数量视图绑定准确源码快照和发现范围，分别报告文件、普通／条件／参数登记点、已知潜在实例与展开未知、实际运行实例、断言，以及调用／fixture 等辅助成本；这些层级不能相加冒充测试总数，间接 suite 和类型模块不计作已发现运行用例。结构导航和主责映射也不替代实际发现、必要性裁决或运行结果。

在允许执行原审计命令的环境，可用 `bun src/bootstrap/engineering/repository-audit.ts --worktree-source-program --json` 取得绑定当前源码快照的 Source Program 报告。该命令会计算编译事实并使用受管 worker，不是轻量缓存查询；禁止产品执行、缺依赖或无对应运行资格时，不应为了刷新数字偷偷运行。

报告原 `testValue.candidateRegistrationCensus` 的 `count` 是该 Source Program 测试表面上已识别的静态注册点数，不是全仓或 runner 实例总数。`potentialExpansion` 在有静态依据时分别给出已知潜在实例小计和展开未知族数；缺失、非法或无观察时明确不可用。潜在数量只在注册到达且输入构造成功的前提下成立；重复参数不去重，未知族数不当未知实例数。`completeness` 与 `runtimeExpansion` 保留未建立／未观察状态，不能据小计反推完整发现。

Python 方法、类型级模块、间接 suite、未物化模板及目标工程的实际发现结果按各自入口另行核对，不拿本投影未覆盖的类别当作零。保存的报告只对其源码与发现条件绑定有效；源码或配置改变后，旧数字及相交保留判断须重新核对，不能只看 HEAD 是否相同。

“有注册”“已读”“有断言”和“当前应保留”是不同结论。每条被认定应保留的测试须能定位到独立保障、判错依据及删除后失去的差额；共享理由须明确映射到具体条目，文件级审阅不能自动批准全部条目。未评估、缺证据或已过期的项明确保留为未决，不以 `retained-unassessed`、一次审计成功或字段齐全证明所有测试必要。机器计数不代替这些语义判断。
