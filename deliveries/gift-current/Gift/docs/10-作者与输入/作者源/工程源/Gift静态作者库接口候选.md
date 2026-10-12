# `gift/author` 静态作者库：Gift 89 完整候选机器语义

**地位**：**可选前端设计保留，明确不进入默认/首发/自举装配**；不能作为结构JSON或原生项目使用的前置条件。再启用的实际消费者和发行准入见本篇静态作者前端边界，不把“未默认采纳”误认为纯性/迁移语义尚未决定。统一作者源码与SDK边界见[统一工程作者协议](统一源码工程与多表示作者协议.md)。下列 API 的设计细节已明确，但其独立产品价值、真实发行和符合性尚未确立；不是已发布的标准库、静态求值器或机器 schema。属于 `gift.author-text/1` 的显式 Profile，不能由 `gift.semantic/1` 基础解释或普通 `import` 自动启用。此包的文件用于实施者核对 API、来源与失败，不构成 Gift 运行能力证明。

## A. 输入/输出角色与类型约束

以下使用类似 `.gift` 的签名展示**语义接口**；`Static<T>`、`ExportRef<T>` 等在此表示静态作者评价系统类型/资格，不宣称是现行 Gift 文法支持的泛型构造器。实现应以一份真实可检查的版本化库类型公开表表达这些签名。

| API | 输入 → 输出 | 关键约束 |
|---|---|---|
| `exportOf` | 单一已解析公开 callable/value → `ExportRef` | 必须是直接、可追溯并有权公开的身份；无来源闭包拒绝 |
| `subject` | 局部ID + 确定 `Type` → `SubjectRef` | 当前Definition词法域内唯一；不创建运行对象 |
| `definition` | `DefinitionSpec` → `DefinitionRef` | 生成公共作者Module中唯一 Definition；可以缺实现但不缺确切含义 |
| `requirement` | `RuleSpec` → `RuleRef` | 表达独立的语义规则；不是已经证明，不自动授权 |
| `compose` | `CompositeSpec` → `DefinitionRef` | 构造既有 `req:composite` 的逻辑内容而非执行应用 |
| `use` | `DefinitionRef` + `List<Argument>` → `Term` | 缺参、同名/重复参数、非法默认都拒绝 |
| `hard` | `RuleRef` + `List<Argument>` → `Term` | 映射 `require`；与任何其它硬规则合取 |
| `prefer` | `RuleRef` + 参数 + priority:Int → `Term` | priority 正整数；有限 `any/exists` 域不允许偷藏评价变化 |
| `all/any` | `List<Term>` → `Term` | 硬语义合取/析取，有限域 / 负向搜索资格明确 |
| `when` | `StaticCondition` + `List<Term>` → `Term` | 静态条件只消费冻结的作者值而非实时 Provider |
| `forEach/exists` | `FiniteDomain<T>` + `(T)->List<Term> !{}` → `Term` | 精确词法量化与次序；不展开为未来运行循环 |
| `ref` | 受控导出/Definition 定位 → `DefinitionRef` | 不允许以拥有私有ID为由绕过公开边界 |
| `allValidInputs` | 当前 `scope` callable 的实际 `require` 合法域 → `RuleQuantifier` | 仅定义独立保证的作用范围，不代表已证明其在无限域成立；不得在普通已拒绝输入上默默要求后置成立 |
| `normalReturnWithInputs` | 已解析 callable → `CallObservation` | 用准确签名绑定 `(arg1,…,argN, returnedValue)`，仅观察主体正常返回；`Result.Err` 是正常返回的和类型分支而非函数异常；端口异常与超时不属于正常返回 |

### `DefinitionSpec`

严格的 typed record：`{name: Text, parameters: List<ParameterDecl>, subjects: List<SubjectDecl>, exposes: List<ExposeDecl>, terms: List<Term>}`。`CompositeSpec`使用相同字段；没有 `implementation` 字段。实际实现由既有 RealizationBinding/Control 管理，不让 `author.definition(...)` 选中某个 npm 函数后悄悄改写业务含义。

- `ParameterDecl` 恰含稳定参数局部名、role(subject/value)、当前已解析 Type、可选 closed default，subject 不允许默认。
- `SubjectDecl` 恰含定义内唯一主体局部名/类型；出现位置决定实例而非全局同名去重。
- `ExposeDecl` 恰含公开边界名和本定义合法 subject/subject param 引用；不给客户端 private 内部路径写权限。
- `Term` 只有精确八种 `use/require/prefer/all/any/when/forEach/exists` 形态，新增仅允许升级确切解释合同。
- `Argument`必须含当前被调 Definition 的唯一 parameter identity 和类型化 Value，不允许按字段名自动插到另一个同形定义。
- `RuleSpec`恰含 `name`、可定位 `scope`、有确定签名的纯 predicate/定量关系、`observation`、`quantifier`/obligation scope、独立来源；声明不自动成为被证明的 true。
- 对 `normalReturnWithInputs`，`scope` 必须引用一项签名固定的公开函数 `(P1,…,Pn)->R`；`predicate` 必须引用一项公开的、无外部效果的 `(P1,…,Pn,R)->Bool` 函数，按位置逐一映射调用时的实际实参及其正常返回值。若源使用具名实参，先依已绑定形参语义放到准确参数槽，绝不依字段名字猜测。无匹配、闭包不具可定位身份、函数存在多个开放返回形态或实际调用语义不支持观察时返回 `AUTHOR_OBSERVATION_UNSUPPORTED`，不把验证义务自动默认为 true。
- `allValidInputs` 的域由被观察函数的全部 `require` 联合限定，在合法输入域中量化调用；空域不等价于产品可用。函数执行未终止、陷阱、资源耗尽或宿主行为未知时需要独立进展/失败保证，不能通过“正常返回时”的蕴含偷换为全局可用性。
- `Result.Err` 若是 `R` 里的值，属于正常返回且谓词明确匹配；仅凭一个 `Result.Err(_) => true` 不能证明错误码本身正确，还需独立需求、函数主体分析或证据。
- 默认、hard、prefer 必须保留原独立强度；同当前默认显式固定仍可在未来升级中产生不同结果。

## B. 静态执行与错误

静态作者阶段只允许有资格的封闭纯函数、固定常量和受控 `gift/author` 构造。不存在 `eval`、任意 JS、网络、文件、进程、环境、系统时钟、随机数、凭证获取、数据库读取。所有捕获必须来自固定源快照/锁内字节；不允许通过编码 `port` 替换为当前可用 Provider。任一未读取来源均返回准确 Needs，不能当空 Terms。

先完成通常的符号、类型、效果检查，再做有限静态求值和 RequirementTerm/Definition materialization。静态成功是**确定含义**，不是运行保证。过程若递归/量化过大、缺抽象方法或内存预算耗尽，输出 `AUTHOR_EVAL_INCOMPLETE` + 来源和受影响导出；不能随机挑某条实现分支。

## C. 文本 → 结构映射表

| 文本中的有型对象 | 逻辑结构 owner | 约束 |
|---|---|---|
| `author.definition({...})`/`compose` | `gift.author-module/1.definitions[id]` 的现有 `req:composite` Definition | 作者源是原 `.gift` span；JSON 只读派生 |
| `author.use` | `Term.use` + 实参映射 | 真实 occurrence/ref 与默认来源保留 |
| `author.hard` | `Term.require` + 已解析 RuleRef/fields | 不把规则外语义重译成布尔标签 |
| `author.prefer` | `Term.prefer` + scope/priority | 严禁变相删除硬要求 |
| `author.all/any` | `Term.all/any` | 独立作用域保留；不可随意转普通数组运算 |
| `author.when` | `Term.when` + 已冻结 Condition | 只读静态输入，不要求在运行时按观察重新选产品 |
| `author.forEach/exists` | 同名量化 Term | 每个绑定/词法捕获与域/重数都保留 |
| `author.requirement` | 已有 Rule 语义模块（RuleDef） | 独立的行为 predicate 是明确规范，不等于当前程序体检查通过 |
| 直接 `fn/type/port` | `gift.semantic-body/1` 或合格对象 body 编码 | 不复制一份行为到 `req:rule`，只引用真实公开符号 |

`req:rule`及其 fields/semantics/implementation 的准确语义仍由 Gift 88 结构化作者源和需求规则合同拥有；文本 Profile 不自行发明新的隐藏槽。若 Rule 类型/元量化不能被现有已选真实规则语言表示，此文本构造必须给出不支持并保持原始源，不能伪造 `req:rule` 元数据。

## D. 开放设计必须考虑的并发与迁移

模块复制建立新身份；正常 rename/move 通过 binder 的有凭据映射保持身份。手动改写导致旧新声明无法唯一关联，停止自动续接并要求用户精确选择。同一 Definition 的原 `.gift` 与 `*.module.json` 在同一个 SourceProfile 区域同时可写必须拒绝；显式转换时采用原字节保全、精确映射、语义等价证据和迁移 CAS，而不是通过运行一次 formatter 实现。

旧编译器遇到 `gift.author-text/1` 的存在、未认识的 staticDefinition、库失配或 schema 高版本时，不得无声忽略并以 `Gift semantic` 基础态编译出“空产品”。新消费者必须按每个相交入口协商能力，而不影响原有只消费普通 `.gift` 函数的根。

## E. 目标环境与采纳边界

本库设计为源级作者工具，不是产品运行时。静态作者要求/定义不会因为被编译进 Artifact 而赋予运行期权利。目标生成仍需固定全部必要函数、port 方法、TargetProfile、ABI/环境/资源与许可证，实际写盘和发布由授权 Operation 实现。完整全专业工程等价属于后继实现/实测证明，不能由 `author.compose` 静态返回值宣布。

<a id="design-a01"></a>
## 静态作者前端的明确采纳边界

默认、完整、首发作者面固定为严格 JSON AuthorModule；`gift.author-text/1` 与 `gift/author` 不纳入本次默认装配，也不成为自举先决条件。保留其可选前端设计，而不是宣称它已发布或永久拒绝文本。可选前端只能由项目明确选择一个精确 SourceProfile 及解释映像；安装而未选中不执行。源区域不得同时将静态作者文本及其派生 JSON 视为可写真源。

允许的静态作者结果仅为已有 Definition、Requirement、Control 的有类型构造，公开构造库继续采用本文件已有 `definition/subject/requirement/compose/use/hard/prefer/all/any/when/forEach/exists` 等接口。它不能写未发布计算构造、调用宿主文件/网络/时钟/随机数/环境变量，也不能用字符串 `eval` 或导入代码绕过相位。静态递归和迭代消耗继承的工作量、深度、分配预算；耗尽返回未完成，不将部分结果认作完整源。

迁移单位是一个有写权的 AuthorRegion。JSON→文本先在非 current 区生成候选，解码双方得到相同模块身份、定义身份、默认来源及有序发生项，再经同一次源提交切换 SourceProfile；文本→JSON同理。非目标Profile能够表达的原生片段不得丢弃，返回 RepresentabilityNeed。失败保留原字节、原锁和可读候选；停止采用时必须把必要定义实质物化为 JSON，移除执行该前端的依赖而非仅删入口文件。

再次启动正式发行的条件固定为：有实际 reader、纯静态求值宿主、正负例及源映射、双向迁移证据，且至少一个明确消费者确实需要文本作者体验。它们是发行准入，不是要求业务作者以后重新决定前端安全语义。

**验证与反例**：核对非法静态 I/O、预算耗尽、不可表示原生片段、双真源、未知Profile、两个方向身份保持六条路径。仅模板文本展开不算合格前端。

**实际能力边界**：可选前端生产实现和用户体验实测未进行；本次已决定其默认不启用地位。
