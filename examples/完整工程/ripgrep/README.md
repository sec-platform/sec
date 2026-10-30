# ripgrep：通用意图语言的整工程检验案例

**通用语言设计从 [第一层语言](../../../docs/作者/第一层语言.md#intent-language-product)进入；本案例从 [PRODUCT](intent/PRODUCT.md)进入。** 本目录保存 ripgrep 的要求、作者候选和真实反例，用来检验语言的表达、组合、固定解释及再次修改。案例的 [开发操作](intent/WHOLE-PRODUCT.md#case-development-surface)及[缺项](intent/WHOLE-PRODUCT.md#case-design-state)按实际范围审查；本目录不发布通用语言 V1，也尚不是可编译的完整 Gift 作者工程。

本任务的成品是 **可用于开发不同工程的通用第一层意图语言及其开发面设计**。ripgrep 的 CLI、九库及工程资产保留为大型检验范围，用于抽取和反驳共同规则；它们的迁移完整性单独报告，不决定语言构造，也不作为先补齐九库才能交付语言的前置。按[总体责任分工](../../../docs/架构/总体设计.md#intent-to-source-responsibility-levels)，有效意图包含被引用定义的准确合同；不逐句或逐函数翻译 Rust。实现选择或创作、数据结构、存储/并发与目标生成由下层承担，作者明确固定的算法、资源或 ABI 仍须保持。

**当前全工程第一层源仍未完整。** [gift.project.json](gift.project.json) 已选择新的 [第一层意图源](intent/README.md)，当前形成退出决定、参数来源合同和部分路径选择等局部草稿；真实输入、作用、完整公开库和工程输出尚未接合。参数来源的阶段函数、中间记录及其唯一串接实现已退役，准确输入与作用关系仍由产品合同拥有，后续须接到固定解释。这些局部定义不构成全工程覆盖。`author/` 已有算法、类型、数据和接口候选，其定义、独特规则与实现事实仍待逐项归位，不进入该新项目的活动源集合。`models/`、`methods/`、`patches/` 和 `materialize.ps1` 保存局部混合原型，其完整原生工程及十个 native 根不是本次终点。ripgrep 原有产品 Rust 源作为对照，目标 Rust 作为后续产物；真实标准库和外部 crate 可按准确合同成为目标依赖，不靠应用作者手写 Rust 包装填补 Gift 缺口。生产 Reader 与 Rust 生成链尚未执行。

全量语义范围包括 CLI 参数/配置/命令、文件发现与 ignore/类型、匹配与捕获、编码/行/多行搜索、输出/颜色/超链接/统计、错误与退出、并发/资源及九库公开接口；构建、维护、测试和发行资产同样纳入。成熟 regex/PCRE2、OS、线程/原子/IO 等供给按真实边界复用。被引用含义须有实际定义；一个库名、空 Goal 或“同上游一致”不能替代产品规则。完整含义缺失、实现供给缺失和运行未验证分别保留。

[globset 要求根](intent/globset.module.json) 已通过真实规则引用 [模式与集合规范](library/globset-contract.md)，该正文作为设计源由项目捕获，定义单模式、精确正则文本、候选字节及集合的独立结果关系。它没有恢复旧算法草稿的活动写权，也不把 Markdown 视为已实现的解释器。公开类型、开放回调／格式观察、RuleMeaningMethod 和目标接合仍有明确缺项；当前要求根不冒充完整 Rust 库输出根。

## 产品作者实际需要的开发入口

本工程的[联合产品合同](intent/WHOLE-PRODUCT.md)现在拥有 CLI、九库、包/feature 和工程资产共同成立的关系：共享定义与独立运行、库结果与命令处置、完整交付集合，以及同一名称政策修改怎样同时约束独立库和命令。它补入了实际产品含义，仍是待固定解释的设计源；没有用十个空主体或输出根占位替代尚缺的公开定义与接合。

顶层源应让作者从本产品的用途与公开承诺入手；系统利用已有上下文、继承合同或按需形成本项目的准确规格，作者只补无法推导或在有效委派内决定的独立信息，并可主动控制必要细节。复用已有定义是可选路径，不要求先建设或提供一套产品能力目录。当前局部模块和核验用关系不是完整作者体验；下表说明真实决定的来源与责任，不是每个作者必须逐项填写的表。

| 作者要表达或修改的内容 | 本工程的实际决定与现有来源 | 系统承担的工作 |
| --- | --- | --- |
| 成品与公开边界 | `rg` 命令及九个可独立使用的库；完整范围见本页与 [PROFILES](PROFILES.md) | 形成共同产品根、真实主体与 API/目标绑定，保持跨根合同；当前根与装配仍未闭合 |
| 使用者能完成什么 | 搜索内容、列出候选路径、查询文件类型、取得帮助和生成补全；结果与失败归[命令合同](intent/COMMAND.md) | 形成并组合本项目准确规格，复用已有合同，取得或创作合格实现；不要求作者编排阶段或先提供搜索能力库 |
| 什么行为必须保持 | [CLI 兼容](intent/CLI-OPTIONS.md)、[参数来源](intent/ARGUMENT-SOURCES.md)、[路径选择](intent/PATH-SELECTION.md)、[输出格式](library/JSON-OUTPUT.md)及库公开合同 | 继承适用的正常、失败、作用和资源义务；形成类型、观察关系与验证，不让作者重新填写已确定保证 |
| 哪个产品含义发生变化 | 修改对应合同的唯一发生点，保留独立接受来源；真实 P→Q 差异见下文 | 找到实际消费者，重算受影响定义、实现和证据；不要求作者同步修改投影、方法、缓存或目标源码 |
| 哪些实现自由确实要限制 | 只保留独立要求固定的目标平台、公开 ABI、资源/性能或实现选择；其余保持可选择 | 在全部硬要求内取得或创作实现，处理工具链、并发、缓冲、布局、目标与恢复；没有已定义含义时明确补齐责任 |

真实 P→Q 修改现在有[可编辑的唯一名称政策](intent/PATH-SELECTION.md#path-name-policy)和[只改拒绝条件的补丁](changes/tail-dot-name.patch)：修改后的非空 Unix 路径仅在最终分量恰为 `.`、`..` 时无名称，其他尾点名称包括 `.foo.`、`a/.foo.` 和 `visible.` 均保留。空路径、非 UTF-8、尾斜杠的空名称与非 Unix 平台合同继续保持。作者修改这一公开含义，系统应沿 Types、hidden、Walk、IncrementalIgnore 以及搜索输出和退出处理相交变化；[消费者审查](changes/README.md)给出实际发生条件与未闭合处。该补丁展示了设计源的真实编辑，不证明生产解释、目标生成或整条修改链已经运行，也不把旧 `FileName` 算法体修改作为新的作者入口。

104 个旗标的公开拼写与独特行为属于必须保全的兼容数据。73 个正常结果投影和五种归约是此前选取的解释组织；它们没有成为顶层必填内容的资格。该关系表退出活动 Project 后作为审查对照保留，没有搬入库继续充当作者负担。已有合同可继承，新含义可按项目需要形成；首次形成、固定消费及后续维护的成本均须计入，不能由简短入口隐藏。当前还缺可实际使用的完整作者源、准确规格的形成与固定消费、产品根及目标接合；缺口并不要求先造一套通用产品能力库。本节不宣称已有可生成成品的顶层源码。

## 当前维护入口与责任

| 内容 | 唯一维护位置 | 当前边界 |
| --- | --- | --- |
| CLI、九库与工程交付的共同义务 | [联合产品合同](intent/WHOLE-PRODUCT.md) | 共享/独立状态、公开连接、包/feature 与资产集合已具体化；完整库正文、固定解释及输出根仍未闭合 |
| 一次命令的开放行为、模式结果和同次退出 | [命令合同](intent/COMMAND.md)与其实际引用定义 | 人工语义已审查；固定解释、全旗标/搜索/呈现及目标接合未闭合 |
| 参数来源、路径政策与退出决定 | [意图入口](intent/README.md)下的合同与局部定义 | 参数来源保留产品关系，已撤去阶段流程草稿；不等于完整运行产品 |
| globset 的模式与集合行为 | [规范来源](library/globset-contract.md)及其 Rule | 不含私有匹配算法；公开边界、解释和目标仍有缺项 |
| 共享匹配与真实内容搜索 | [匹配协议](library/MATCHER-CONTRACT.md)、[搜索合同](library/SEARCH-CONTRACT.md) | 字节/捕获、覆盖、输入/回调/停止/错误及兼容差异已形成具体关系；完整公共声明、解释、外部依赖与 Target 尚未接合 |
| 实际后端、呈现和路径库 | [引擎](library/ENGINE-CONTRACT.md)、[呈现](library/PRINT-CONTRACT.md)、[遍历](library/IGNORE-CONTRACT.md) | 开放公共行为与 CLI 用法分开，保留默认、复用、作用和版本例外；固定机器消费与完整目标仍待接合 |
| 命令行公共工具与子进程 | [工具库](library/CLI-LIBRARY-CONTRACT.md) | 模式/转义、解压、标准流、默认、close 与错误优先已有具体合同；进程作用和固定解释资格仍未取得 |
| 默认文件类型 | [真实数据](library/default-file-types.module.json)及[来源](library/DEFAULT-FILE-TYPES.md) | 原字节保留；TypesBuilder/命令与筛选消费者仍待接合 |
| JSON 输出格式 | [格式与观察](library/JSON-OUTPUT.md)及原生 JSON Schema | CLI/库分开入口；可检查单条值，不代替完整搜索、流与目标语义 |
| 帮助、man 与补全 | [同源合同](intent/CLI-DOCUMENTATION.md)、词表及原格式资产 | 产品文字与生成关系已设计；生产解释、完整命令和 shell 运行未取得资格 |
| 原格式许可与 CLI 资产 | [资产说明](assets/README.md) | 保留真实来源与明确行尾；完整发行尚未闭合 |
| 构建、维护、fuzz/benchmark 与发行集合 | [工程交付](intent/ENGINEERING.md) | 实际输入、版本/feature 与成员关系已具体化；完整资产物化、输出根及运行/发行证明未取得 |

`author/` 与 `native-support/` 属已停止的逐函数草稿和手写包装路线，不在活动 Project 中；尚未完成安全退役的文件暂时留作来源与恢复现场，不再作为开发待办或新作者面。真实公开数据、合同和有条件观察必须按对应消费者承接，不能只因文件未选中就删掉，也不能将旧 AST 的局部 PASS 升级为产品完成。已有共同记录、借用、trait 与原生导入语义继续由原规范拥有；未采用的新增解释形状不因旧草稿需要就自动成为通用核心。

声称本案例已完整迁移时，仍须闭合 CLI、九库、工程/资产装配、固定解释与实现/目标接合、逐项等价及再次修改。声称通用语言设计完成则另须通过[语言验收](../../../docs/运行/验收/第一层开发面.md#intent-language-delivery-acceptance)，两种声明不互相代替。原生产品 Rust 是对照与后续产物；不能保留几乎全部原产品实现再增加一个入口充作第一层减负。

## 已核验的局部混合原型（不作为总目标完成）

| 文件或目录 | 责任 |
| --- | --- |
| [gift.project.template.json](gift.project.template.json) | 创建实例时原样保存为`gift.project.json`；声明实例源范围和十个产品根，原生源、设计、资产与模型分别保留作者身份 |
| [PROFILES.md](PROFILES.md) | 新设计的 SourceProfile/Target、完整库公开面、私有 CLI 入口、准确模型—方法—使用点绑定与失效规则 |
| [EQUIVALENCE.md](EQUIVALENCE.md) | 整个工程逐项保持、P→Q允许差额、消费者闭包、借用/效果证明及验证边界 |
| `models/P/`、`models/Q/` | 两版完整 Gift 路径算法；相同模块身份，只有 FileName 函数体发生语义修改 |
| `methods/P/`、`methods/Q/` | 对应的普通 Rust 借用切片实现；不是按项目名称命中输出的生成器 |
| `patches/P.patch`、`patches/Q.patch` | 原 Unix wrapper 接合与 private 模块声明；其余上游作者源保持 |
| [materialize.ps1](materialize.ps1) | 从精确上游修订创建全新完整实例；不解释 Gift AST、不生成 Rust、不安装工具或依赖 |
| [verification/path_policy.rs](verification/path_policy.rs) | 独立期望的22组字节用例；两版返回值与输入后缀指针检查 |

上游地址为 [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep)。固定版本：

- P：`4c2362d359d9913c7a5e391ccd79cb4da22bc89b`，tree `e41450e1cd2b5b7a3fef684b5c38cf5d504fc030`。
- Q：`7155f6408d370e699795dc75e954635abfaf08a6`，tree `4325a55a66d44bfa3bb25303bfcc30336cfd491d`；是P的直接子提交，修复尾点名称的hidden判定。

完整上游内容通过精确Git对象分发，不在维护仓库中重复提交两套第三方源码。本目录是版本化分发材料，项目模板的路径相对装配后的实例，不把同时包含P/Q两版材料的分发目录当成单一活动工程。装配后的实例实际包含所有224个上游跟踪成员及新增方法文件；并非只有远端引用、调用已安装rg的薄壳或源码摘要。上游许可证及原文件模式随Git对象保留；本例派生的两个方法沿用上游 MIT OR Unlicense。

CLI 旗标、参数解释、命令模式、并行观察与错误/退出含有真实产品决定。历史混合原型仍以 Rust 拥有这些决定，因而没有交付本次要求的完整第一层源。恢复工作要将这些准确含义落到第一层定义与使用点，解析表、循环和线程组织再由下层落实；不能仅把 `defs.rs` 改名成供给或放到一个回调后面就称意图已表达。旧原型不证明全工程 Gift 完成，也不证明作者总负担降低。

### 旧混合原型的装配与编辑说明

本节保留原型的复现方法和原作者归属，用于核验既有证据。这里创建的是旧 Mixed 实例，不是正在设计的第一层成品；其中可编辑 Rust 与方法联动只描述旧原型，不能作为新主线的作者修改路径。

在PowerShell中指定**尚不存在**的目录，其父目录须存在：

```powershell
& './examples/完整工程/ripgrep/materialize.ps1' `
  -Checkpoint P -Destination './.tmp/ripgrep-author-p'
& './examples/完整工程/ripgrep/materialize.ps1' `
  -Checkpoint Q -Destination './.tmp/ripgrep-author-q'
```

默认从官方Git仓库取得固定修订。已有准确本地仓库时，可用 `-SourceRepository '<本地仓库绝对路径>'` 复用对象；仍核对准确commit。脚本拒绝覆盖已有实例，失败时保留部分目录并明确报错，不删除未知工作。P/Q为两个独立检查点，没有运行时版本分派。

每份实例的结构是：

```text
gift.project.json
PROFILES.md
EQUIVALENCE.md
design/path-policy.module.json
native/                         完整独立的上游Git checkout
  Cargo.toml / Cargo.lock
  crates/ ...                   全部原生可编辑作者源
  crates/ignore/src/gift_path_policy.rs
  tests/ fuzz/ benchsuite/ pkg/ ...
```

实例内方法的唯一Rust写源是 `native/crates/ignore/src/gift_path_policy.rs`。分发目录的 `methods/P|Q`只用于创建新实例，之后不会自动覆盖实例修改。原 `pathutil` 的Unix wrapper已移除算法分支，只保留字节视图、调用和OsStr借用转换；非Unix分支不变。实例保留自身`.git`，防止 `build.rs`误读外层维护仓库的版本。

原生构建仍从实例的`native/`通过原Cargo入口执行；这只能构建已经提供的原生实现，不构成Gift模型被编译的证据。`gift.project.json`中的Target画像是设计请求，不能声称当前工具已有同名可执行Target。采用模型的准确边由[画像中的绑定设计](PROFILES.md#本例准确的模型方法使用点选择)给定，不能仅把JSON文件放进目录后宣称它已被消费。

Git对象还保存100755模式及 `HomebrewFormula → pkg/brew` 符号链接。Windows检出可能把后者保存为链接目标文本，且不能表达同一Unix执行位；这是保留源对象与宿主物化的区别。后续Unix/发行环境必须按原Git模式检出并核实链接目标与执行位。本次Windows实例不签发该平台物化或发行资格。

### 旧混合原型的等价、第二次修改与体量

保持关系分别是 `Native(P) ≈ Mixed(P)` 和 `Native(Q) ≈ Mixed(Q)`。P→Q本来就改变尾点名称，不能让两个版本对全部输入输出相同。审查覆盖Types、Walk串并行，以及公开IncrementalIgnore直接hidden判定和父目录缓存对后代的影响；完整说明见[EQUIVALENCE.md](EQUIVALENCE.md)。

后续修改仍在真实作者源进行。模型变化会使原模型—方法保持资格失效；原生方法变化也需重新核对同一模型。项目不会因已有P/Q材料就自动处理任意第三次修改。真正的生产增量编译、受管回源与运行资格必须由未来实现取得。

固定P有224个Git跟踪成员，Git blob合计3,195,883 bytes；其中101个Rust文件、54,490物理行，Git blob合计1,845,231 bytes，tokei识别39,461行Rust代码。先前Windows CRLF检出的对应数字为3,263,542与1,899,721 bytes；差额来自换行物化，不能算成Gift精简。物理行、代码行和字节是不同指标。完整混合实例仍保留这些源码，还增加模型、方法、项目配置和审查材料；所以**本例没有证明源码大幅压缩，实际完整交付体量增加**。JSON去空白只影响序列化体积，不减少作者需要维护的语义，也不允许排除原生部分再比较。

已取得的证据分别记录原版P基准、源成员/接合核验、结构检查及方法向量；未执行的生产Gift链、四对象运行比较、Unix与多平台、其他features、性能和发行验证均明列于审查文件。任何局部PASS都不代称“整个工程运行等价已证明”。
