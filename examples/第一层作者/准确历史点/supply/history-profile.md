# 准确 Workspace 历史点的有限观察与 Time 画像

`profile:exact-workspace-history:1` 解释本目录 [history.d.ts](history.d.ts)、[history.selection.json](history.selection.json) 与作者模块 [history.module.json](../history.module.json)。它承接唯一规范 [准确点消为已有单点范围](../../../../docs/作者/需求含义与实现责任.md#exact-point-by-range) 和原观察/Time 合同，不新增 Formula operator、At 执行器、时间系统、通用历史服务或作者必填 cut 表。

这是完整的有限专业设计解释及可实现见证，不是已运行的历史 producer、native adapter、生产 Reader、证明器或可执行 Target。真实采用未提供合格 History、运行实例和调用时，要求尚未激活，必须保留准确 Need。闭合模型提供的是该模型的事实，不签发现实发生。

## 精确的声明身份与出口

原生选择固定 `module:historical-state-observation` 的六个真实出口：

| 原生出口 | 类型/纯解释 | 精确职责 |
| --- | --- | --- |
| HistoricalPoint | 不可变、不透明普通值类型 | 保留已发行准确 cut 的来源与身份；不含读取权能 |
| BoundaryCut | 不透明、合格的观察输入类型 | 同一真实或模型操作的完整边界见证 |
| StateCut | 不透明、合格的观察输入类型 | 指定实例在指定 cut 的有型状态投影见证 |
| BeforePoints | `BoundaryCut → Sequence<HistoricalPoint>` | 唯一入口点的单项投影 |
| AfterPoints | `BoundaryCut → Sequence<HistoricalPoint>` | 正常完成点的单项投影 |
| OneState | `StateCut → Sequence<State>` | 唯一有型状态的单项投影 |

三个函数 effects 为空，在各自**已合格输入值域**上纯、总、确定；有限 Sequence 有顺序、单项出现身份及准确重数。资格不足不会生成一个无效输入再交给总函数。header 中 `ReadonlyArray<T>` 按本固定映射解释为 Sequence<T>，不按 host 数组身份代替 Gift 值语义。品牌只防普通结构构造，不能单独认证 issuer、来源、权限或运行身份。

header 私有 `State{readonly closed:boolean}` 精确映射 `module:exact-state-point-example` 内部 Definition `State`：封闭名义 record，唯一字段 `closed:Bool`。它不是另一包的同布局类型，也不因 TypeScript 结构兼容就与任意 `{closed:boolean}` 互换。`OneState` 的返回元素必须取得这个准确名义身份及值资格。该内部映射可由同版模块/声明/profile 的已解析身份核验，不要求增加公共 State 出口。

`ExactCutRange` **不是原生出口**。它是同一作者模块内部的真实封闭名义 record，唯一字段 `point:native:HistoricalPoint`；`OnePoint` 是该模块已声明的普通函数：

```text
OnePoint(point: native:HistoricalPoint) → local:ExactCutRange
effects = ∅ ; termination = total
body = record { point = point }
```

其实际 body、参数与返回类型以作者源码为准。它只保存原值，不读取当前时间、history、对象或状态，不解析字符串，不发行新的 Point，也不授予访问权。record 引入使用其唯一预期名义类型与表示权限；同布局别名、任意对象或另一个名义范围不能自动成为 ExactCutRange。Point/范围在逻辑上是普通不可变值，其传递仍受原类型、寿命及拥有规则约束。

作者模块公开恰为三个 Context 类别 `History`、`WorkspaceInstance`、`OperationOccurrence`，以及 `CheckRecordedState` 与 `OnePoint`。内部 State、ExactCutRange、关系、纯解释和观察合同保持可链接的真实 Definition 身份，未因此获得公共别名或额外包出口。三个 `req:subject` 定义只声明类别；空角色签名不创建实际对象、不证明来源，也不授予权限。`sourceModel:Component`、`ObservationUse`、输出根等源码发生不能替代这三种运行/模型类别。

## Point 的身份及原有上下文

每一合格 HistoricalPoint 唯一指定所选产品或模型历史中的准确观察 cut。其 retained provenance 至少足以核：History 实际身份、选定分支/修订的兼容性、Clock 实例及映射、准确 cut 身份或因果 frontier、相关 Subject 覆盖，以及实例的生命周期代。metadata 由原 History/观察 producer 随合格值保留，不要求作者再双写映射表，也不允许解析 objectRef 或时间字符串补身份。

同一读数可对应多个 cut；两个 cut 的显示 timestamp 相同，不等于同一状态边界。准确 cut 可由偏序 frontier 表示，本画像不要求发明全局全序或让 timestamp 充当顺序。SourceMap、header 品牌和 profile 标签都不单独发行 Point 的事实资格。

既有评价上下文在此区分为：

```text
ε = (selectedHistory, branch, currentCut,
     Clock实例/映射, readableScope/权限,
     defaultHorizon, evidence/coverage依据)
```

`OnePoint` 范围消费中**只允许 item 的 currentCut 局部变化**。Point 的 history、branch、Clock 和覆盖信息用于核相容性，不能拿来替换其余分量。源修订/证据版本晚到，不等于另选产品历史或分支；读取时取得新的证明材料，也不把它冒充新的产品发生。

`clockRef:time:SessionReading` 引用已捕获 `module:event-time-ranges` 的真实声明。本画像将这一名义读数 family 与所选 History 的实际 Clock C 显式关联；`clock` 字段、相同类型、相同文字或相同纳秒读数自身均不证明是同一 C。不能默认 UTC、wall-clock，不能把 Clock family 换成 Clock 实例。

## ExactCutRange 的完整 Time 解释

所选 Time consumer 接受**准确 Definition 身份** `module:exact-state-point-example/ExactCutRange` 作为该画像的单点范围类型。形成 `OnePoint(p)` 时先沿普通 Expr 在外层词法环境 ρ 一次取得该范围值；consumer 核 p 的类型、来源、所选 History/branch、Clock、实例/代、相关覆盖、读取 Scope/权限及已接受的时间范围限制。全部相交资格满足后，其域严格为：

```text
Domain(OnePoint(p), ε) = {κp}
```

这是非空、完整的**准确点域**，不按 p 的 timestamp 对已有点集做筛选，也不取“最近”“同秒”“最后一次”状态。Point 不存在、来源未取得、History/Clock 不相容、历史投影未保留或读取未授权时，返回原有诊断/准确 Need，不能返回空范围制造 always 空真；不能顺便选择另一历史、分支、Clock 或拥有更宽权限的视图。

此扩展只增加一个有真实普通定义与固定解释的专业范围类型。既有 `IntervalValue`、InstantInterval、原 rangeRef/range 和默认 horizon 的解释保持原版本。不是所有 record 都是时间范围，也不重解释旧 `[t,t]` 为准确 cut。其他 temporal operator 继续遵守自己的方向、boundary、范围和覆盖规则；本例只以已有 always 的单点行为证明准确点评价。

always 在该单项域中解释 item，暂令 `currentCut=κp`；完成后恢复进入前的 currentCut。ρ、普通外层角色、外层 binder、已取得快照和已固定范围不重读。只有进入新 cut 的原 `observedDomain` 按其既定 ObservationUse 取得该点的域。Point 不重绑 ObservationUse 的 subject 或来源；同类型却属于另一实例/会话/profile 的观察仍不合格。

内层再次使用明确范围只影响其子树；返回兄弟项时恢复上层 cut。内层省略 range 的 temporal 继续消费原 defaultHorizon 及自身 operator 规则，不能被外层 OnePoint 缩成单项，也不自动扩大 horizon。外层 iteration range 只决定外层遍历点，**不是历史可读 Scope**：即使外层当前只遍历后态，内部显式 OnePoint(before) 也可读取同一 History 内有资格的过去点，不再与外层 iteration range 自动求交。真正的读取 Scope、权限和已接受范围限制仍必须满足，定位不越权。

固定合格 p、ρ、其余 ε 以及原 Meaning/观察解释，always 的单项四态合取恰为 item 本身：支持位与反证位分别保持，T/F/NEITHER/BOTH 都不变。Point/范围未取得资格是此解释前的 Need，不冒充 P 的 NEITHER；P 自身的冲突也不能在定位层被无差别抛弃。这是一般 `P@κp` 的局部消去，不声称所有时间方法可判定或所有历史可读取。

## 三个观察合同的输入、来源和结果

`BeforePointObservation`、`AfterPointObservation` 的实际 contextBindings 必须共同指定同一 H、同一运行或模型实例 W 及生命周期代、同一操作发生 c。OperationOccurrence 需要原调用/合法模型 owner 的稳定发生身份；方法模板、方法名或两张状态表不能创建 c。BoundaryCut 是原观察 consumer 已取得的准确同次边界输入，不是任意 Int/record。

`BeforePoints` 返回且只返回 `[κc−]`。`AfterPoints` 返回且只返回 `[κc+]`，其中 after 对应原 CallEndpoint 的**正常 Ok 或业务 Err 完成**；业务 Err 并不保证状态保持，仍以实际操作合同为准。Fault、Cancel、尚未完成或未知结算不能冒充该 after。若专业模型确需独立的故障/取消边界，须另有明确合同，不能复用此 after 的名称偷带不同含义。本例不新增这类观察。

缺实际入口、正常完成点或同次来源时，consumer 保留相交 Need/原诊断；不返回空数组使 exists 变假，不捏造正常完成。两个 observer 都只投影合格输入中已经规定的点，不在调用时执行操作、重新结算或查墙钟。

`StateObservation` 的 contextBindings 固定 H 与 W/代；在当前 cut κ 下，原 consumer 核 κ 对 W 的覆盖、同 History/branch/Clock 及读取资格，取得该点不可变 StateCut。`OneState` 只纯投影 `[σ(W,κ)]`；它不读取当前对象、触发 getter 或运行查询程序。`SnapshotIsClosedBody` 再只取该准确 State 的 closed 字段；关系不隐含 live read，也不把另一实例的 closed 当成它。

必须有一个合格状态才向 OneState 提供输入；快照不存在、未保留或未取得时保持 Need，不以 [] 代替。一个应为单值的 cut 给出两张相异“完整”状态，是来源/观察资格冲突，不能把两项都放进 exists 后挑有利项；沿原观察与四态 owner 保留冲突。该单值输入规则不修改任意其他 P 的四态解释。

同一共同 cut 可以覆盖多个 Subject，只要原 consumer 对每个观察取得相应资格；本例只需要 W.closed。不同 Subject 各自的 latest、不同 frontier 或不同实例不能拼接成“同次”。无需读取所有子成员或公开全部私有状态；拥有者的合格投影足够时可以只提供该投影，但摘要自身不签事实。

## 本例的完整有限见证与唯一选择修改

固定一个完整有限模型：History H 的已选分支 β，实例 W 的生命周期代 g7，Clock C，以及一次正常 Ok 完成的操作 c。模型保留两个不同准确 cut：

| cut | c 的边界 | SessionReading 显示读数 | 本例准确 State |
| --- | --- | --- | --- |
| κbefore | 入口 / before | 同 C 的 1000000000 纳秒 | `{closed:false}` |
| κafter | 正常 Ok 完成 / after | 同 C 的 1000000000 纳秒 | `{closed:true}` |

这两项是模型全部所需状态。它们的 cut 身份/因果位置不同，不因同 timestamp 合并。本例不凭 Normal Ok 推导任意操作都令 closed=true；该值由此固定模型明确给出。正常业务 Err 的真实 after 仍可按前述一般合同取得，其状态必须由该操作自己的实际合同/模型给出。

初版 Component 仅有稳定 `anchors` 与 `states` 两个 ObservationUse。anchors.use.ref 为 BeforePointObservation，故其域为 `[κbefore]`；OnePoint 产生 `{κbefore}`；StateObservation 给 `[State(false)]`；关系为 F。后继 [after-point.json](../changes/after-point.json) 先 test 原 ref，再将 **同一 anchors.use.ref** 改为 AfterPointObservation；结果依次是 `[κafter]`、`{κafter}`、`[State(true)]`、T。anchors 的 useId、states、Goal、关系及 H/W/c 绑定保持，不增加备用未消费的 after Use，不复制 P，不重填 cut metadata，也不改变已发生状态。

采用 `CheckRecordedState` 为独立产品根时，源码选择 `componentPath:[]` 指该选定根。若嵌入另一根，必须由原根的准确采用/Context 转交实际发生；不能把空路径改成“当前任意组件”。Goal 的两个角色只绑定准确 ObservationUse，不含模板路径或运行对象冒名。

对同一真实 c，既有 CallEndpoint before/正常 Ok 或业务 Err after 已有状态投影时，本例准确单点范围下的投影与其对应。无需迁移现有调用源码；只有两张普通状态表、方法 Ref 或源码发生时，不能反推真实 c、边界或发生事实。

## 证据、未来与实际可实现边界

Point 来源可以是合格观察的普通元素或已有来源的普通值；源码中是 anchors 的 observedDomain binder。ObservationUse 是 Subject，不能直接塞进 Expr 当 Point。作者自行构造同形 record、强转 opaque 品牌、复用别的生命周期代或丢失 provenance 都不发行点资格。

producer 可以保留只覆盖所需状态的不可变投影、稳定边界证据或可核静态模型，不要求永久全量历史日志。取得路径必须能从原 owner 找到准确 cut 的有型输入，并核保留期、来源、Scope/权限和共同切面；旧数据已退役或未采集时返回 Need，不能从现在的状态重造过去。

证据后来送达可以证明固定过去 cut；后来真实发生不能倒填旧 cut。证据覆盖更新不更换选定 History/branch，也不把所有未知状态全局改为已知。资格已成立的精确点域完整，不等于该点所有状态命题都有完整证据。

完整闭合模型可以有未来位置，OnePoint 也可以纯构造包含该合格模型 Point 的范围；这不使它成为现实已发生点、不授予预知未来的观察能力，也不证明任何进展/期限。现实开放未来尚未发生或缺覆盖时，原事实/进展责任仍未取得。策略可实现、静态定理、当前证据和真实执行分别判断；不能将未来 Need 转成空范围、False 或自动失败。

本画像的有限核验应至少区分：同 timestamp 双 cut；同类型不同 History/branch/Clock/实例/代；Point 缺失而非空域；外层 ordinary ρ 冻结；嵌套定位局部恢复；外层 after 迭代内读取有资格的 before；内层省略 range 的 horizon 不变；P 为 T/F/NEITHER/BOTH 的单项恒等；正常 Err after 与 Fault/Cancel 的区别；晚证据与晚发生；共同 cut 与分别 latest 的区别。通过这些只能证明固定模型/profile 的对应性质，不能代签 producer、native 链接、目标执行或现实历史事实。
