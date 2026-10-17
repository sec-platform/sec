# 冻结候选原文：Gift源码工程作者语言总合同

> 本文件完整保全输入包的候选设计，未采用为当前规范、未发行、未创建实施队列。原文中的“当前”“唯一”“正式”等词只属于输入包版本；当前采用面以仓库 main 的现行正文为准。地位、当前拥有者、反转与迁移边界见[本组说明](../README.md)。

来源：`SEC_Gift_main_61006088_fulltext_design_convergence_20261017.zip` 的 `SEC_Gift_Unified/docs/10-作者与输入/作者源/工程源/Gift源码工程作者语言总合同.md`。原文 45089 bytes，SHA-256 `826514fca3c6e252e5969a709d56e8ccfc1f313d1d1103d8f15ef7067a25a0c2`。下列 text 围栏中的字节为完整原文；原相对链接仅保留为来源文字，不作为现行导航。

~~~~text
# 历史计算文本 Profile：供语法设计吸收的非现行提案

## 开发者源码的完整构造接口与当前Profile的真实边界

**当前写源优先级**：唯一结构化作者Writer设计为 `gift.author-module/2`，其中27 Kind已涵盖业务语义、计算、意图、Pattern、Requirement和产品结构；计算是可选构造，不是第二门必修语言。旧 `/1` 仅历史读取。本篇下述`.gift`文本Profile/静态作者调用是原独立**未发布的计算/文本作者方案**，不得同时登记为当前业务Writer；必要原生TS/Rust仍拥有自己的算法/实现源权，不是业务含义的第二真源。见[唯一业务作者合同](工程清单模块与绑定锁协议.md#unified-current-author-writer)。


**统一分工**：`gift.author-module/2` 是唯一结构化业务与计算作者候选；其计算基础承接既有语法、类型、求值和效果边界。本文`.gift`文本Profile不是另外一条当前写源协议，只作为可吸收的紧凑文本语法研究。普通开发者可以继续直接写 TypeScript/Rust 原生实现；原生实现与业务意图处于不同Owner，不构成两份业务真源。当前[统一定义及专业消费](../../../20-语义与组合/作者语义/开发者通用定义Profile-类型计算业务与系统构造.md#business-kind-consumer-coverage)规定需要保存的所有独立业务差异；此文件仍只负责可选文本源码表示的原有边界，不再与业务作者Profile争夺唯一解释。



开发者面对的是同一项目中有明确写权的**多种源码表示**，不是必须手写所有生成阶段的中间对象。实际源码从以下职责组合：

- **工程容器**：项目身份、SourceScope、模块、导入/公开导出、产品根、Target请求、锁绑定与作者可编辑区域；`gift.project/2`只说明合法输入范围，不证明所有根可实现。
- **基础值与程序**：名义/结构/泛型类型、常量、函数、递归、控制、局部状态、Result、显式效果/资源和原生实现；使用合格文本计算Profile或真实TS/Rust源，不把普通程序AST全部复制进意图JSON。
- **开放领域**：开发者/有权供应定义Type、Relation、State、Event、Protocol、Query、UI、Norm、Effect等专业含义；这是一组可能的领域定义职责，**不是现有四种`kind`之外已发布的字段或关键字**。领域定义只有在类型、语义、版本、观察和目标义务均可解析时才从候选晋升。
- **产品要求**：`intent:goal`六模态、`req:composite`八Term、`semantic:pattern`/`semantic:pattern-use`按各自正式Body声明和复用已知含义；整体产品应选择全部相关公开根，未被选择或不可达的Goal不能被算作已要求。
- **供应与控制**：有权作者可明确固定本地函数和实现偏好，专业Provider/Method/Target单独签发其真实资格；`gift.lock.json`只能由Resolver根据真实内容与occurrence绑定派生，不能让作者造一份锁替代授权。
- **运行、观察与保证**：Runtime Input/Grant/Operation/Evidence分别归其实际Owner；长期产品意义、运行参数、开发工具外观不能靠同名字段任意覆盖。

**统一机器消费责任**（语义合同，不新设已发布JSON协议）：`read(project,sourceProfiles,sourceBytes,locks)`首先保留来源并解析合法的SourceUnit，再根据每个单位实际`kind`或原生语言Profile分派至具备资格的Decoder/Elaborator。分派结果为`CheckedUnit`、`NeedsCapability`、`InvalidInput`或`Incomplete`之一；合法但当前尚无语义消费者的作者草稿可以保存，却不能被误报为已检查业务要求。未知Definition绝不能因为Schema附带任意`extensions`对象就进入编译器成功路径。

**开放Definition的实际接入设计**：后续新增种类必须拥有命名空间与固定版本、来源锁、Body结构约束、类型/效果签名、语义解释与来源、与现有Requirement及Pattern的组合接口、Lowering所需Method义务、可检查诊断及兼容策略；读取器必须先验证包及方言身份，再解码Body、绑定意义、精化实现，绝不能仅根据`kind`字符串选择同名模板。旧`gift.author-module/1`的四个混合`kind`继续由隔离的历史`/1` Reader解释；新写源的全部27种候选Kind由唯一`/2`Schema准入；允许新种类需先发布兼容性明确的Profile/协议版本及真实消费者，**本章设计不会暗中修改旧Schema或宣称已实现新方言**。

**作者信息充分性检验**：若两个具有不同合法行为的系统都满足当前目标，就应保留实现选择自由；若其差别影响作者硬要求而未被描述，产生可见的`NeedsAuthorDecision`或领域解释请求。若作者要求矛盾，则保持联合不满足，不因有计算通用性而伪造实现。实现体可以由作者、已有库或限定合成提供；省去作者代码的部分必须有已锁定的实际供应承担。

> **责任范围**：本篇定义可选`.gift`静态作者文本Profile，不要求所有开发者采用该格式，也不取代其他文件的AuthorSource协议。结构化JSON、原生Rust/TS、SDK、迁移和多表示写权由[统一工程源码与多表示作者协议](统一源码工程与多表示作者协议.md)裁决。本篇仅规定可选文本的语法与静态求值，不对其他格式取得默认解释权。

> **交付性质**：可直接用于实施研究的**可选源码表面与语言方案**，不是 Gift 编译器实现，也不是宣称范例已经由 Gift 解析通过。此版的新增规范暂命名 `gift.author-text/1` / `gift.author-static/1`，作为 Gift 88 既有结构化作者源的**可选文本 Profile**；它是本版的设计决定，不是以前已发布的协议。
>
> **范围**：人用 Gift 写任意软件时打开的文件、表达式、模块、工程与包、语义层次、扩展及跨目标行为。核心不提供任何业务；本文 IDE 示例的领域模型属于应用作者或其导入库。
>
> **源基线**：Gift 88 `工程清单模块与绑定锁协议.md`、`结构化源码.md`、`文法类型与求值.md`、`紧凑表示与程序范式.md`、`对象构造与动态分派.md`、`控制流与存储寿命.md`、`模块封装-包边界与源码布局.md`。它们拥有原有严格语义；本规范增加的是横跨它们的**人可编写的源码映射**和防冲突合同。

## 0. 最终决定：真实开发者看到的不是 IR 和工具参数

Gift项目包含有明确所有权的作者源码（可选`.gift`、结构编码或原生源码）、`gift.project.json`定位信息、在实际绑定发生后产生的`gift.lock.json`、资产及必要的原生工程。每个Definition在同一修订只有一个可写权威源；CST、IR、蓝图、目标工程计划、生成的TS/Rust/Java和操作记录只保存派生或各自独立事实，不得与作者源共同改写同一含义。

`.gift` 是**文本作者源**，不是 JSON、编译脚本或代码生成模板。其计算部分继续遵守现行静态类型、词法作用域、确定性求值与显式效果语言；需求和工程组合不直接塞入新的 `workflow/app/requirement/component` 全局关键字，而由固定、类型化的 `gift/author` 定义库在**静态作者求值阶段**构造合法 `Definition` 和 `RequirementTerm`。静态作者表达与可运行程序共享基础文法，不共享运行权限。

这不是“用函数假装已实现需求”：一个静态 `author.requirement(...)` 只是要求声明；若实际函数、库、Provider、目标工具或证明不存在，工程保持 `Needs`。同样的文本入口也能写唯一的独特算法 `fn`，不必为两个语义层面生成两份作者源。

> **历史研究边界（此前阶段88）**：`gift.semantic/1`、`gift.object/1` 文本语法的具体文法保留为研究输入，并不与当前唯一 JSON `/2` Writer 并行有效；`gift.project/2` 的当前 sourceScopes 清单仍生效，`gift.author-module/1` 只用于历史 Reader。未来若采纳文本 Profile，必须有单独来源权威/迁移决议，不能仅靠 `.gift` 后缀或关键词激活，旧阅读器遇到扩展保留原文并返回 unsupported。

## 1. 三个真正不同的源码层次

| 层 | 编写内容 | 权威源示例 | 实际意义 |
|---|---|---|---|
| 计算与行为 | `type`、`fn`、`let`、`port`、class、算法/数据结构 | `src/editor/document.gift` | 允许发生哪些状态变化、怎样计算；不暗含宿主 I/O |
| 工程/要求静态作者数据 | 在已选 Profile 下使用 `gift/author` 构造的有类型 Definition、Requirement、组合与出口 | `src/spec/studio.gift` | 定义整个工程要满足的独立要求、组合、边界、未决实现 |
| 项目/发行/环境 | 来源范围、模块身份、目标根、包公开入口、解析绑定、原生文件和资产 | `gift.project.json`、目标原生 config、必要 `gift.lock.json` | 具体有哪些文件与目标；不重复写每个函数主体 |

上述是**职责**，不是三层固定目录，允许同一文件同时出现程序与静态作者定义；前提是两个声明的生命周期和精确解释都能辨认。大量纯原生工程也无需 `.gift` 镜像。用户创建只含独立 Requirement 的产品时，可以不写任何程序体；用户只写小函数时可以不建项目。

## 2. 三类合法工程包：最小、纯 Gift、多语言混合

**单文件**：`twice.gift`，可只有 `export fn twice(n: Int) -> Int = n * 2;`。不存在发布、锁或 Target 的必要前提。其解释仍来自本次固定 context；接收者无相同 context 不可声称可重现。

**完整结构作者工程**：

```text
studio/
  gift.project.json              # 作者实际编辑或工具协助维护的工程定位与目标请求
  gift.lock.json                 # 只有解析被正式接受以后由解析器生成；不是手写第二份源
  src/
    editor/document.gift         # 业务定义的真实类型与行为
    editor/history.gift          # 复用函数；不要求组件对象
    extensions/host.gift         # 扩展状态/协议
    remote/session.gift          # 远程连接的状态与失败
    platform/files.gift          # 宿主接口声明，没供给仍为缺项
    spec/studio.gift             # 稀疏工程定义与独立要求的静态文本入口
  assets/                        # 图片、字体、主题、翻译等原始字节
  contracts/                     # 独立需求或法规的原始文件（仅真的存在时）
  generated/                     # 明确要求物理写出目标后才出现；不是作者真源
```

**混合工程**：原生 `package.json/tsconfig.json/src/**/*.ts`、`Cargo.toml`、`*.rs`、CSS、SQL、HTML、JSON、SVG 与图片等继续由各自真实作者 Owner 维护。Gift 在获权范围内读写这些源区域；只有独立于具体实现的要求才使用 `.gift` 或 `*.module.json` 等已选作者 Profile。文件位置和导入不自动改变语义归属，也不要求把所有 TypeScript AST 映射成 Gift AST。

**仓库 vs 包 vs 模块 vs 运行实体**：一个仓库可有多个项目；一个项目可有多个模块；模块不必单独分发；包只有真正有公开消费时才建立；运行实例/线程/进程/容器与作者模块不一一对应。源码目录按共同变化、公共接口、资源寿命和版本边界组织，而非每个类型一个文件。

## 3. 文件格式、字符编码、词法与声明

`*.gift` 继续采用 UTF-8。基础 `Ident` 为 `[A-Za-z_][A-Za-z0-9_]*`，单独 `_` 只作模式通配。注释为 `//` 行注释，字符串双引号，转义包含 `\\`、`\"`、`\n`、`\r`、`\t`、`\u{...}`（合法 Unicode 标量）。整数为精确十进制 `Int`，负号为一元运算；基础域没有浮点字面量、`null/undefined`、隐式 truthiness、隐式数值转换或 string interpolation。无条件保留 CST 原始字节与注释位置，格式化不能悄悄改作者判断。

基础全局保留词 **18 个**：`import as export type fn let if then else match case require ensure result port bind true false`。选定扩展还提供 `opaque/with`、对象 `class/interface/init/new/this/super/var/set/override/static/final`、控制 `while/break/continue/return`；这些不是 18 词基础语法下无条件全局可用。逻辑表达式、记录、列表、和类型、泛型函数与高阶值等按现行语言文法识别。导入仅建立模块绑定，不运行依赖或安装包。

```gift
import "./history.gift" as history;
export type Edit = Replace(Text) | Delete(Int, Int);
export type Document = { content: Text, revision: Int };

export fn change(doc: Document, expected: Int, next: Text) -> Document !{}
  require expected >= 0
  require doc.revision == expected
  ensure result.revision == doc.revision + 1
= doc with { content: next, revision: expected + 1 };
```

声明间的符号查找由模块/导入/作用域规则决定，不能靠“同名且字段相似”视作同一类型。`require` 在调用边界检查接受的输入，`ensure` 限定正常返回；函数体就是确定行为，`ensure` 失败不意味着此前外部效果自动撤销。无体声明可保存与查询，目标需要它但没有实际供给时不生成假函数。

### 3.1 基础文法的完整拥有者

Gift 88 的 `文法类型与求值.md` 已有 46 项基础具名产生式及后续扩充，包含 `Module/Import/TypeDecl/Function/PortDecl/BindDecl/ConstDecl/Type/Expr/Lambda/LetExpr/IfExpr/MatchExpr/Pattern/...`，这份草案是现行基础规范，不在此另建一个竞争 EBNF。交付附录 `grammar/` **逐字提取**上述原文的 EBNF 代码块用于工具作者对照；不能只看语法可解析就认为语义检查合格。

本版作者静态组合 **不增加这份计算语言的全局保留词或优先级**，只增加可绑定的普通库 API 和一种 Profile 的静态源到 Definition 映射。

## 4. 值、类型和身份——作者究竟可以定义什么

| 类型或概念 | 作者实际写法/能力 | 边界 |
|---|---|---|
| `Int`、`Bool`、`Text`、`Bytes`、`Unit` | 精确整数、布尔、标量文本、字节、`()` | 整数不自动变有限 JS number；文本位置非 UTF-16 code unit 默认 |
| `List<T>`、记录 `{x: Int}` | `[1,2]`，`{content:"a",revision:0}` | 不可变、按值，递归/共享不允许外部观察原生内存别名 |
| `Option<T>`、`Result<T,E>` | 已绑定标准类型与 `Some/None`、`Ok/Err` 构造器 | 必须存在固定公共类型定义；原文件不暗造泛型类型 |
| 和类型/名义记录 | `type Mode = Idle() \| Active(Int);` | 构造器属名义类型；同形记录不自动强转 |
| `opaque type` | 隐藏实现，公开受限操作 | 不能靠字段名绕过不透明边界 |
| 泛型 | `fn id<T>(x:T)->T = x;` | 显式量化，有限实例化；不含任意反射/依赖类型 |
| 函数与闭包 | `(Int)->Bool !{}`、`(x:Int)=>x>0` | 捕获、效果、递归与逃逸独立判断 |
| 对象 | 选择对象语言的 `class/interface/new` | 仅需身份、可变封装、动态分派时采用，不是所有业务都要 OOP |
| 资源/数量/时间/概率 | 由对应类型、语言 Profile、库/Provider 提供 | 类型存在与当前文本语法支持不同；精度/单位/生命周期不许靠显示字符串猜 |

`let` 是不可变绑定；在明确对象/局部控制画像下有 `var/set/while`；函数主体求值次序、短路、模式覆盖、作用效果和类型推导受原规范约束。相等仅在声明支持的值域内合法；函数和资源没有默认结构相等。一个 `Document` 的 revision 是业务数据，Gift 作者模块的 Revision 是源码事实身份，两者完全不同。

## 5. 表达式、语句和错误的细节

- 算术 `+ - * / %` 对基础 `Int` 定义，除零是计算错误，不是 `Result.Err` 自动返回。`/` 向零截断；`a = (a/b)*b + a%b`，余数符号依被除数。错误和资源耗尽分别记录。
- `if cond then a else b` 中 cond 必须为 Bool，两分支共同类型明确；`a && b`、`a || b` 短路。不可串接比较 `a<b<c`。
- `match value { case Pattern => Expr; ... }` 首个匹配分支生效；必须分析嵌套模式穷尽。`A(true)` 和 `B()` 不能覆盖 `A(false)`。
- `{ let x = e; x+1 }` 是带最后结果的执行块；`{x:1}` 是记录，`{}` 是空记录而非 Unit。`()` 才是 Unit。
- `x with {field: value}` 只更新非 opaque、可合法观察的同类型记录；求值一次的 receiver 与顺序保持。不能凭此改数据库或更改指针身份。
- `fn f(...) -> T !{effect.name} require ... ensure ... = expression;` 显式效果是**上界**，函数没有声明行时可由主体推导。声明 `port` 必须指定效果，即使是空集合；名字没有真实宿主方法时保留缺项。
- `port` 是应用与宿主交界，不是免授权 I/O。`bind` 只能引用合法现有目标方法，不能从相似名字猜到 npm/Cargo 包。
- `return/break/continue`、`class/new/this/super` 仅在已明确选定计算组合且位于允许的函数/循环/构造器位置可用；`await` 没有本章默认语法，异步任务要由已启用的专业画像定义，不得把原生 JS await 静默接受。

**错误分层**：词法/解析错误、名称歧义、类型不符、效果扩大、契约违例、缺依赖、缺实现、缺 target lowering、预算耗尽、授权拒绝、外部效果未知都是不同结果。保存不完整草稿合法；生成只阻塞相交的必要根。静态证明、目标检查、样例实际通过和真实部署分别记证据。

## 6. import/export、模块、包和版本

`import "./text.gift";` 推导默认别名 `text`；`import "gift/seq" as seq;` 使用显式别名。路径末段无合法 Ident、默认重名等情况必须显式别名，不自动修正。导入只获得公开 API，不读入私有字段、隐式重导出或执行初始化。类型/值/端口名称分别检查，跨模块引用先读取固定公开签名，再闭合主体。

本地私有模块无需发布包。真正对外发布的库必须有供应者持有的包身份、发行版本、可见出口、依赖及变体的专属发布合同，真实出口由模块 `exports` 提供，并由解析锁记录所选内容。**当前 `gift.project/2` 不接受顶层 `extensions`。确需发包时，当前候选使用现有SourceScopes发现的`gift.package-manifest/1`独立包发行声明；它不复制模块exports、不能签发Provider安装或发布资格。正式主干`gift.project/1.library:gift.library/1`是该主干当前合法的唯一内联发行Writer；它和更早的`extensions["gift.library/1"]`必须按准确旧版分别解释。在本候选`/2`中它们都只能作为迁移来源，完整字段、外部发行义务和Lock在有权Writer切换前不得丢失。**`gift.binding-lock/1` 锁定 language、target、method 与依赖的准确版本、来源和字节；它不自动取代 npm、Cargo 或系统原生运行库的独立锁文件/解析机制。

`projectId/moduleId/definitionId` 是身份；物理文件路径是定位；版本标签不是可信内容摘要。工程移动文件时通过有资格的源映射更新定位，不能靠路径重新创建旧 Definition，也不能无依据延续删除后重建对象的身份。

## 7. 效果、资源、异步、并发、存储与外部世界

`!{}` 表示函数不具外部可观察效果上界（不等于总终止、无陷阱或零耗费）。有 I/O 的函数使用 `port` 或经明确宿主绑定的能力。启动进程、写文件、读网络、时间、随机数、数据库、GPU、设备等都是可声明的外部能力，**业务内容不由 Gift Core 实现**，但调用合同必须说明身份/版本、权限、失败、取消、重复调用、超时、资源释放、持久化与环境条件。

有状态程序分三种不可合并的事实：

1. 程序值 `State` 和纯 `transition(State, Event)`；
2. 持有身份和别名的运行对象/资源，其生命周期与持久化另有真实合同；
3. 多写者共享状态及外部副作用的提交与恢复协议。

一个纯函数通过不能证明实际磁盘事务、网络重连或多节点 exactly-once。使用异步、流、事务、时间/数值/设备高级表达时要求固定相应能力 Profile/库+Goal/Target 消费者；当这种能力未具备完整文本映射、解释器、目标策略时明确标注 `UNSUPPORTED_PROFILE` 或相应 Needs，而不是向 `fn` 上塞个形容词。

**资源规则**：资源句柄不是可任意复制/序列化的记录；宿主句柄失效、撤权、取消、迟到结果与补偿不是作者源 `Result.Ok()` 能代签。数据模式升级、线上部署和证据都保留原有责任边界。

## 8. 本版最关键新增：整套软件也能以源码形式直接表达

### 8.1 决定的形式

研究性提出**未采纳的候选作者源 Profile `gift.author-text/1`**，读取 UTF-8 `.gift` 文本中的合格、顶层**静态作者值**。不新增全局语法关键词；文件的词法/文法仍为固定 `gift.object/1` 或所选计算语言入口。所需可读性通过经过锁绑定的 `gift/author` **强类型作者构造库**取得。

该 Profile 只处理**静态且带确切作者类型**的定义（例如 `author.CompositeDefinition`、`author.Requirement`、`author.Subject`、`author.ExportRef`）。其他普通 `fn/type/let` 仍保持自身程序意义。这条静态文本到结构定义的投影是历史 SDK/Profile 研究，不授予现行文本 Writer 资格；当前业务作者的持久源只有一个 JSON `/2` Definition，任何文本/IDE/SDK 表示只能在明确编辑权下生成该结构的候选修改，不能自立第二份语义真源。

```
.gift source / native source / *.module.json (选定其一或不同非重叠区域)
          │ 原字节 + 已固定语言/SourceProfile
          ▼
       AuthorModule / Definition / RequirementTerm
          │ 唯一语义拥有者，位置信息/来源/接受关系
          ▼
    Checked semantic / target blueprint / target program
          │ 只读派生；不与原文互争写权
```

### 8.2 可选静态作者 API（研究签名，非现行 Writer）

以下是**能力签名**，并非已安装的标准库。这里的 `FiniteDomain<T>`、`Predicate<T>`、`Requirement`、`DefinitionRef` 等类型必须由 `gift/author` 的合格名义定义提供，不是 Gift 语言新核心类型。签名中 `Static` 表示只允许纯静态作者期解释的资格，**不是新增关键字**。

| API | 输入与返回角色 | 明确含义及失效条件 |
|---|---|---|
| `author.exportOf(callable)` | 已解析 callable → `ExportRef` | 必须能定位公开、实际符号及当前模块身份；任意无出处闭包不能自动取得持久ExportRef |
| `author.subject<T>(localName)` | 名称 → `Subject<T>` | 在当前 Definition 范围内创建一个逻辑主体；不是运行对象 |
| `author.definition({...})` | 名称/参数/主体/terms/exposes → `DefinitionRef` | 生成本 Profile 中对应的一份已知 Definition；未知字段或不可解引用拒绝 |
| `author.use(ref,args)` | 合格公开 DefinitionRef 与类型化实参 → `Term` | 参数按精确默认与类型补全；无供给不能假定实现 |
| `author.hard(rule,args)` | RuleRef/fields → `Term` | 约束所有合格候选；非证明、非授权 |
| `author.prefer(rule,args,priority)` | RuleRef/fields/正整数 → `Term` | 只在全部硬条件满足者之间排序，不能违反硬约束 |
| `author.normalReturnWithInputs()` | `scope` 的精确 `(inputs,result)` 观察 → `CallObservation` | `predicate` 必须是纯 `(P1,…,Pn,R)->Bool`、绑定准确的输入和正常结果；不包含异常/超时/外部失败 |
| `author.all/any(terms)` | 合法 `List<Term>` → `Term` | 分别是合取/析取；源顺序不决定运行调度 |
| `author.when(condition,terms)` | 静态纯 Bool Condition → `Term` | false 只是不施加 then 条件，不是禁止功能 |
| `author.forEach(domain,lambda)` | 有限已知域与静态纯 lambda → `Term` | 捕获域和嵌套绑定，保留顺序/重数/主体出现身份 |
| `author.exists(domain,lambda)` | 有限域 → `Term` | 有可满足的见证才成立；空域为 false，不能替代业务活性 |
| `author.compose({...})` | 定义/需求/公共边界 → `CompositeDefinition` | 不自动求解、下载、创建后台或生成目标源码 |
| `author.requirement({...})` | 实际主体/作用范围/谓词/强度 → `Requirement` | 独立硬要求保留其来源；谓词未可解释时返回准确 Needs |
| `author.ref(...)` | 明确模块公开名或 Definition 身份 → `DefinitionRef` | 只做受控解析，不能构造越权私有引用 |

其中 `normalReturnWithInputs` 与 `allValidInputs` 是 Requirement 观察及量化资格，不新增第九种 Term。示例的 `replaceAll(before, expectedRevision, nextContent)` 使用可检查的四参数谓词 `(before,expectedRevision,nextContent,outcome)`；只写 `(before,after)` 而未指定绑定规则不能成为完整契约。若存在异常、非正常终止、未授权效果或无法观察的返回，它们不由“正常结果”自动验证，需另有要求与证据。

API 的静态契约将映射到**既有**八种 Term `use/require/prefer/all/any/when/forEach/exists`，不为新业务发明Term种类。`author.requirement`若仅建立已有函数当前行为的摘要，不能同时宣称它构成独立验收依据；独立性质应来自另一个被接受的约束来源。`author.compose`不允许捕获一个随时变化的工具结果然后假装作者事实已固定。

### 8.3 静态作者求值的强制限制

- 先解析/确定类型/绑定模块和锁；再执行仅静态作者值的固定解析。允许普通纯函数组合构造**已有** Definition/Term 值，不允许运行外部函数、port、宿主脚本、网络、时间、随机数、环境或当前权限读取。
- 递归或高成本静态求值必须有预算；超预算返回 `AUTHOR_EVAL_INCOMPLETE`，不能当 `any(false)`、空 `terms` 或零值。静态求值产生的 RequirementTerm 必须保留来自源的位置、引用和适用范围，而非只保留最终结构字符串。
- 同一模块的 `fn`/类型声明与静态工程定义分别有唯一身份，`author.exportOf(fn)`由解析后的符号身份定位，不通过字符串全局搜索。跨文件解析仍按模块 ID 和公开访问控制进行。
- 作者静态值本身不自动成为产品入口；必须显式选择其公开根。仅 import 了 `gift/author` 不能改变语言词法或开启未经授权的 Provider。
- 静态 `author.definition` 与已存在 `*.module.json` 的编译结果要按**同一逻辑 Schema**理解：实例角色、默认的继承/固定、硬要求的合取、有限量化、公开主体、接受来源的区别必须保持。若不能忠实表达一个原结构方言，不降级丢义；保留结构源作为真正作者 owner 并报告该文本 Profile 的不支持位置。
- 文本值与逻辑 Definition 的同步必须为**解析投影**而非双写；formatter、roundtrip、rename、move、结构编辑均由一次有 CAS 前像的作者修改完成。

### 8.4 这里的语言“统一”不是把异构工程强扭成一种文本

源码可统一**语义接合**，但不强制所有资产统一文件编码。PNG、二进制模型、SQL 迁移、可视资源、原生构建配置、平台专有打包描述仍用成熟原生格式。Gift 持有它们的存在、身份、版本/许可/消费关系及条件，而不把二进制转成十万行 `.gift` 字面量。

## 9. 一份 IDE 级产品实际写什么

完整的源码片段位于本交付 `examples/ide-source/`。其中：

1. `src/editor/document.gift`：文档的名义数据、提交修订合同和完整可理解的纯状态转移（不声称完整文本编辑器）。
2. `src/editor/history.gift`：不可变历史、归纳列表处理、Option 返回与公开复用关系。
3. `src/extensions/host.gift`：扩展宿主状态与事件的合法转换、错误类型，不用业务关键字。
4. `src/remote/session.gift`：断线/重连的状态模型；没有实际网络 Provider 就仍是纯函数。
5. `src/platform/files.gift`：宿主文件能力的类型化 `port`；这是独立真实供给要求，未绑定不能生成读写实现。
6. `src/spec/studio.gift`：仅在所选 `gift.author-text/1` Profile + `gift/author` 合格库下，定义整体工程的组合/硬性质/出口；完全不预装 Editor 或 ExtHost 业务类型。
7. `gift.project.json`：模块身份、源码范围和仍为空的目标请求。无目标是清楚的**设计工程状态**，不是已完成可运行软件。
8. `assets/`、`contracts/`：保留独立原始材料，不重复写进某个巨型 JSON AST。

**这不是把 VS Code 重新实现一遍。** 它是用同时包含文本编辑、可变历史、插件宿主、远程状态、外部文件效果和应用组合的专业样本检查这门通用语言的源码组织。完整 VS Code 级实现仍包含 GUI渲染、终端、插件协议、语言服务、调试、构建、发行、升级等其它真实定义/库/资产，其合同按需要另行编写/导入；这里只写出了示例包**已有文件的确定内容**。未写的功能不能靠目录名冒充。

### 9.1 一次模块编辑的正确扩散

修改 `src/editor/document.gift` 中的 `replaceAll`：类型变化会影响导入它的 `history`、静态工程 `author.exportOf`、独立需求、下游 Target ABI，必要时重新绑定；仅改变私有常量不要求重写不相交的模块或锁。改变 `remote` 中断线恢复若影响允许观察的时序，会触发进程/接口/远端消费义务；仅改 Workbench 面板布局不能自动改 `gift.project.json` 的语义身份。生成代码回写只有准确源码映射才获准，无映射时保持独立草稿而非原处覆盖。

## 10. 结构 JSON 作者是当前统一持久写源，不是第二可选业务 Profile

`gift.author-module/2` 是当前离线设计候选的唯一结构业务与可选计算定义载体；普通作者可以通过受管工具的短投影修改其独特决定，而不必须手写完整 JSON。直接编写结构 JSON 仍是合法作者操作。已有 `.gift` 紧凑计算语法和原生 TS/Rust 源各有各自非重叠 SourceRegion 的真实写权，不得把同一业务意义保存为同时有效的 JSON/.gift 影子。

以下仅展示一个满足当前严格 `/2` 外壳、Types/Expr 的**静态有限正例**，用于确定字段而非声明已经实现生成器或计算运行时：

```json
{
  "schema": "gift.author-module/2",
  "moduleId": "module:sample",
  "definitions": {
    "threshold": {
      "kind": "core:constant",
      "body": {
        "type": {"tag": "scalar", "name": "int"},
        "value": {"op": "literal", "type": {"tag": "scalar", "name": "int"}, "value": 3}
      }
    }
  },
  "exports": {"threshold": {"definitionId": "threshold"}}
}
```

该文件没有 Project/Target/Method 绑定，因此只具结构形状资格；`definitions` 至少包含一项真实声明，不能用空定义模块伪装已存在功能。`kind` 由当前 `/2` 严格 Schema 选择 Body，**不用也不允许**在 Body 增添 `representation`。当前 `/2` 仍允许可选 `namespace` 与 `dialects`：前者提供名称空间信息，后者只在真实非内建语义解释需要时表达有型语言要求，且必须由实际 Lock/供应绑定；这两个字段**不是**旧 `/1` 专属。历史 `/1` 的每个 Definition 内 `name`、原局部/导入引用对象与旧字段默认规则仅由旧 Reader 解释，不能照搬为新 `/2` 的 Definition/Ref 结构。

## 11. 可选文本语法如何接入唯一结构化作者工程

当前Project的合法字段只有`schema`、`projectId`、`sourceScopes`、按需`targets/defaultTarget/annotations`；Module的唯一候选Writer是 `/2`。早期提议把`moduleLanguages`与`staticDefinitions`写入`gift.project.json.extensions["gift.author-text/1"]`，但现行Project schema**没有该扩展槽位**，也没有可维护的第二份`modules`表。不能为了保存旧设想新增`project/2`或在Project根默许任意扩展JSON。

**现行采用的责任划分**：`sourceScopes`只声明哪些物理作者内容受本项目读取/编辑控制，模块文件单独签发稳定`moduleId`；公开定义由模块 `exports` 声明，目标产物选择由 `targets[name].outputRoots`指向实际公开出口。静态作者计算（如果将来为可选文本前端采用）只能在拥有有型解释规则的可读源范围内发生，并产生对既有Definition的**候选投影**，不能把`author.compose(...)`的返回值未经作者采纳升级为新Requirement，也不能自动签发Meaning、Method、Target或Grant。

**文本Profile的条件性未来边界**：若需要`.gift`紧凑语法，先单独规定源文本的词法、语法、作用域、求值和源码映射如何严格映射到同一`Definition`语义；源码所有权只能在一个所选Profile上具有写权，另一个表示须只读或以受控权转移完成转换。不能引入每个函数/模块的`moduleLanguages`重复手写表，语言解释版本由真正固定的使用位置和Lock绑定；没有合格转换时，原文保留在其有权原生/历史输入，不以伪中间源取代。

**为什么保留研究而不采用旧字段**：项目使用几种不同语法、哪种产物最终被采用是独立工程事实；如何在源表示之间等价映射需要精确的时间/授权/身份/错误保证。保留关于静态作者求值和人类可读语法的独立计算语义，但该机制没有完整当前Reader/Writer/Target消费者时不应增加Author必填字段。正式结构模块仅按照当前Schema的标准Kind和必要显式扩展组成。

## 12. `gift.binding-lock/1` 不是另一门语言

成功解析之后，`gift.lock.json` 的 `schema` 为 `gift.binding-lock/1`，`projectId` 与项目一致；`resolutionInputs`、`bindings`、`nodes` 保存实际发生位置对应的精确依赖节点（`kind/subjectId/revision/content/dependencies`），并记录能复现的实际字节/来源。它**通常不由人维护**，也不包含源码镜像、密钥和不受控的 current/latest。普通文本改动不必重写无关锁；语言 revision、组合静态库、目标供应、解释策略改变才使真实相交绑定失效。缺少解析器时示例**不附伪造的锁文件**。

## 13. 目标、生成物和程序等价：设计、代码与实际运行不同

Gift 作者文件不等于自动生成目标代码。用户明确选择目标后，`TargetProfile` 提供工具链、运行库、布局、ABI、产物列表、源映射和缺项。真正执行 Target lowering 时才有 `ArtifactSet`；仅作者工程结构、 Blueprint 和 Needs 不必写出 `generated/`。若需要能脱离 Gift 运行的 TS 工程，则必须交付 `package.json`、源码、运行库/依赖、必要 tsconfig、资产、测试/诊断说明、外部配置和可复现工具链边界；不能只吐几行 `index.ts`。

“等价”须在指定观察范围比较：函数行为、错误、时间/资源合同、并发/持久化/网络、权限、构建发行和后续修改。对于无限域、外部环境和任意图灵完备程序，不存在对所有实例均可判定的万能完全等价检验；即便静态语义合法，也必须对真实 Target 和外部系统取得条件化证据。SourceProfile 的语义保持是**语法/定义层映射资格**，并非整套专业软件的实现等价证明。

## 14. 代码完整度：定义齐全 != 软件已实现

本源码包可分成明确资格：

- `SAVED`: 原文受控保存，允许未完成语法或未决的结构定义；
- `PARSED`: 全部相交源按固定语言解析；
- `TYPED`: 类型/名称/效果/契约结构检查完成；
- `DESIGN_RESOLVED`: 当前请求的 Requirement/静态定义来源和义务具有已知解释；
- `REALIZATION_BOUND`: 必需实现、库、Target 和运行支持获得合格绑定；
- `ARTIFACT_PRODUCED`: 真正产出源码/配置/成员；
- `TARGET_CHECKED`: 真实目标工具按声明范围检查；
- `DELIVERED/RUNNING/OBSERVED`: 真正作用与外部观察独立成立。

这些并非一个单调的项目级布尔值，也不凭一项成功签全局完成；任何阶段不具资格均给出准确受影响根/Needs/错误。结构模块的 `req:composite` 和静态 `author.compose` 即便完全解析也不能直接证明产品业务行为存在。

## 15. IDE 源码编辑器必须怎样理解语言

这是**源码工具能力**而非 GUI 操作流程：

- Tokenization/语法高亮依据当前语言入口准确选择 18 基础词和已启用扩展词；未获准的语法不能当普通源码格式化并掩盖错误。
- 基于固定模块图提供 go to definition、find references、rename、signature help、member completion、sourceMap，并区分业务符号/工程定义/效果/target 资源。
- 静态 `author.use` 等构造器补全来自已锁定 `gift/author` 类型及真实已解析库，不从字符串相似度或 AI 猜包名。
- 编辑文本发生未完成状态时保持原注释、字节和正确 token span；保存/格式化不会重写成另一份 JSON AST。
- 从图或结构属性回写，必须有唯一 owner 和准确的 source span；共享投影同一值不意味着改动所有作者来源。
- 协同修改、文件被外部用户修改和移动时遵守共同 CAS 与修订身份，不能使用文档行号作为永久 Definition ID。
- 语言服务异步计算可返回不完整/延迟，不能抢占用户本地文本编辑或在旧候选回来了以后污染新版本诊断。

## 16. 设计门禁：哪些细节必须在编码前固定

1. 当前 `.gift` 基础 EBNF/对象与局部控制扩展准确版本绑定，词法消歧、CST source spans、诊断范围明确。
2. `gift.author-text/1` strict project extension Schema 及 SourceProfile 读取器、模块/文件 identity 获取规则；未知扩展拒绝/保全。
3. `gift/author` 名义类型与构造 API 的精确签名、参数/默认、静态求值规则和有限语义 codec；库内容可复现且不执行外部作用。
4. Text AST → `AuthorModule/Definition/RequirementTerm` 全构造对应：8 Term、量化作用域、静态条件、表达式、需求来源、公开边界、局部身份、默认、偏好限制；结构返回/错误/未决均明确。
5. 相同作者定义的 Text/JSON 双 Profile 不互争真源；对声明可表达的共同子域验证往返语义等价；未知/高层语义必须拒绝而非静默删除。
6. 重新命名、跨文件移动、注释变化、旧版本锁、不同目标导致的重新绑定及代码回源政策，不引入无依据的身份连续。
7. 首发 Source/Stdlib/Target Profile 组合能实际读取示例中的普通类型/函数；缺 `gift/author` 或缺真实 Provider 时明确拒绝目标而仍可保存设计。
8. 组合要求独立验收，不由被要求的目标代码自行给自己证明；有真实相交多模块用例和反例。
9. 工具输出分别标识“纯作者设计”“已解析/检查”“已有合格实现”“真实目标已生成”“外部实际运行”，没有统一成功布尔混淆。
10. 对未支持的高级能力记录适用范围和现有候选方案，按真实消费者补映射，不新增一个泛化成假的无类型任意操作。

## 17. 规范性反例与拒绝

| 输入/变化 | 正确结果 |
|---|---|
| 把 `null` 当默认值或让 Boolean 自动转换 Int | 类型/语法拒绝 |
| 在基础 `.gift` 域写 `await` 却没有异步 Profile | Unsupported，不当普通函数名解释 |
| 匿名同布局记录强转另一名义类型 | 必须明确转换，不作静默相容 |
| `author.compose` 引用 private import symbol | 私有边界拒绝，不能凭保存的名字越权 |
| 两个模块给同一逻辑 definition 同时指定可写源 | 作者归属冲突，不按文件排序挑一个 |
| 静态构造调用时间、随机、文件 Provider | 作者期效果拒绝；不能假定运行过 |
| 静态递归/量化超预算 | Incomplete，不当已无解或空集合 |
| `prefer` 与硬要求冲突 | 硬要求不削弱，偏好不能使非法候选合格 |
| `any/exists` 中借 prefer 让评价域随分支变化 | 本有限要求 Profile 拒绝或要求另有共同评价合同 |
| 锁引用旧的 `gift/author` 构造规则，文本使用新能力 | 需选择可读规则修订或返回 Needs，不猜升级 |
| 导出定义名字没变但绑定实际实现变了 | 重新检验所有相交义务；名字不保证实现等价 |
| 更改生成 TypeScript 却无准确作者 SourceMap | 拒绝自动回写，保留目标草稿 |
| 仅有 IDE 工程树没有 editor 的任何定义/供给 | 只可称 Blueprint/Needs，不可称完整 IDE 产品 |
| 多目标一个通过一个失败 | 分目标独立结算；不能把整个工程标绿 |
| 源码文件换路径但模糊映射到两个符号 | 停止自动重构，要求明确归属/对应 |
| 提交期间别的写者修改 project/lock/read-set | CAS 或联合不变量冲突，候选重审 |

## 18. 哪些已经完整，哪些仍缺实现与反证

**Gift 88 已存在的严密设计**：基础 EBNF；整数/Bool/Text/函数/记录/列表/和类型；有限泛型/模式/效果/契约；局部控制与对象 Profile；模块导入/导出；`gift.project/1`、`gift.author-module/1`、`gift.binding-lock/1`；结构 Requirement 的 8 Term；纯核与宿主作用分离；目标与工程计划；知识工具源码。

**本可选方案设计补齐**：在显式采用文本 Profile 时，`.gift` 的计算与静态产品组合复用一套词法；这不是唯一或必需的工程作者路径。候选内容包括只用 `gift/author` 类型化库而不扩张核心业务关键字、text↔AuthorModule 映射责任、`gift.author-text/1` 清单扩展、完整的人可读多模块工程范本、语言细节索引和反例。

**依然需要真实实现/客观证据**：机器 Codec/语言编译器、`gift/author` 发行库、静态作者值到结构编码的翻译器、Lock resolver、真实 Blueprint 生产者、TS/Rust Target 与 Provider、真实产品编译及设计→源码→运行→维护的合格证据。本文未执行这些产品行为，也没有声称 Gift 可以自动生成全部 VS Code 软件源码。存在无界计算与外部环境时，不可能通过预先文档证明所有未来专业工程完全等价。

## 19. 实施上应该修改哪些原文 owner

本章节的源码结果被设计为四处实际拥有：工程文件和文本 Profile → `docs/10-作者与输入/作者源/工程源/工程清单模块与绑定锁协议.md`；计算语法及作者期静态评价 → `docs/20-语义与组合/基础语义/计算基础/文法类型与求值.md` 和 `紧凑表示与程序范式.md`；结构需求与 Term 源级映射 → `docs/10-作者与输入/作者源/结构化源码.md`；包与导入/导出 → `docs/20-语义与组合/组合/模块封装-包边界与源码布局.md`。本版额外的完整索引位于 `docs/10-作者与输入/作者源/工程源/Gift源码工程作者语言总合同.md`；不在不同地点另复制不同的协议含义。

实现者应以 `fixtures/author-workspace/Gift89/` 的真实文件作为源码编写体验的输入，按照本章 16/17 节形成解析、映射、编辑、身份与反例测试。**不要先实现图形工作台再临时决定源码字面语义，也不要让 AI 生成的文本绕过正式语义解释。**

## 20. 对照依据（只用于比较设计，不是源码正确性的替代证明）

- WebAssembly Component Model 的 WIT 将 `interface/world` 作为明确可读契约，但它本身不定义行为；Gift 不应只照搬接口语言便宣称可以描述全部程序。
- CUE 对约束合取/默认/析取有形式化区分；Gift 现有硬要求、偏好、默认和实现选择应坚持各自强度，不能用宿主字典覆盖模拟逻辑合取。
- 现有成熟的原生语言、标准库和构建系统可作为真实供给。原生源的可信性、许可、检查和平台限制必须实际绑定，不因为“Gift 通用”就全部复制实现。

**最终可操作判断**：用户使用 Gift 的根本开发对象是**有权威归属、明确解释与类型/约束的源码工程**，而不是工作台按钮、对话记录、IR、JSON 树视图或生成目录。用户可以只写一个 `.gift` 函数，也可以用多模块 `.gift` 同时表达整个产品需求、独特行为和可复用组合；只有真实需要时才连接具体目标、原生实现和外部工具。这才是本轮应交付的根设计。

<a id="本责任的相交定案"></a>

**关联规范：**[静态作者前端的明确采纳边界](Gift静态作者库接口候选.md#design-a01)。

~~~~
