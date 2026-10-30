# 在准确历史点检查同一个要求

[工程入口](../history-point.project.json)捕获[完整作者模块](history.module.json)、[专业观察与Time解释](supply/history-profile.md)、真实原生声明及其选择。它是可复用的作者定义/采用设计，尚无可执行Target；真实history、运行实例和调用须在实际采用时提供，未绑定不算已激活工程。

作者选择的是“在哪个已知点检查哪个要求”，例如：

```text
在 所选操作的前态点：工作区.closed 成立
修改为：在 同一操作的后态点：同一要求成立
```

本例模型让前态closed=false、正常完成后的后态closed=true，但两点的时钟读数都为1000000000。前版要求在该模型不成立，后版成立；示例不是声称修改文字会改变已发生状态。

## 现有构造的实际写法

准确点不能丢成一个timestamp，却也不需要新at运算。`OnePoint(point)`是实际普通纯函数，返回本模块的名义ExactCutRange记录；所选Time解释在核历史/Clock/范围资格后，使它的观察域准确为该一个cut。源码复用已有temporal：

```json
{"temporal":{
  "operator":"always",
  "clockRef":"time:SessionReading",
  "range":{"op":"call","callee":{"op":"symbol","ref":"local:OnePoint"},"arguments":[{"op":"var","name":"point"}]},
  "item":{"quantify":{"quantifier":"exists","binder":"snapshot","observedDomain":{"binding":"states"},"predicate":{"apply":{"meaningRef":"local:SnapshotIsClosed","arguments":{"snapshot":{"binding":"snapshot"}}}}}}
}}
```

围栏是完整模块中内层片段；外层point由anchors观察量词绑定，states由真实ObservationUse采用绑定，不能脱离它们单独解释。Point是无权能的普通值，ObservationUse则是Subject，二者不混。状态从所选cut的单项观察域进入snapshot，再传给SnapshotIsClosed；其纯解释只读取本模块State.closed，不读取当前对象或另一实例。

普通OnePoint只构造范围值，不证明点已发生、不制造访问权，也不重新生成历史。内部State、ExactCutRange、关系及其纯解释仍保留必要名义/类型身份，未为了示例新增无消费者的公共出口；OnePoint及CheckRecordedState可供实际作者复用，三种Context类别供外部合格来源进行准确绑定。源发生类型不能冒充运行History、WorkspaceInstance或OperationOccurrence。

CheckRecordedState只包含两个实际ObservationUse：稳定的anchors与states。它的Requirement把这两份准确发生绑定到通用Goal；采用为独立组件根时componentPath为空。嵌入其他根时由原真实采用/Context转交准确地址，不能把空路径偷偷当“当前任意组件”。源码使用已有provides/requires组件分支，不选择必须给constructor的具名构造分支；这个观察采用外壳不会创建工作区或调用，也不需要添加空total构造器。

## 修改同一选择

[after-point.json](changes/after-point.json)先test anchors原引用为BeforePointObservation，再仅把它改为AfterPointObservation。anchors身份、states、Goal、P、History/Clock/实例/调用保持；不永久保留另一份未消费的after Use，不复制关系，也不让作者再填一张cut元数据表。两份观察合同均给真实observer及Context，旧/新采用各自仍须合格。

## 组合与证据范围

固定合格单点域后，always的四态合取只有一项，所以支持/反证分别保持P：T/F/NEITHER/BOTH均不变；点资格缺失则是解释前Need，不是用空域或NEITHER冒充定位成功。当前cut只在item内替换，普通外层参数冻结，内层定位返回后恢复兄弟项；原默认horizon、读取Scope/权限和选定history/branch不变。外层只迭代后态时，仍可显式读取有资格的较早前态；不能将迭代域误当历史可读域。内层未指定range的时态不因外层OnePoint被缩成单点。

上述责任的唯一规范在[准确点消去](../../../docs/作者/需求含义与实现责任.md#exact-point-by-range)。有限模型还需检查同timestamp双cut、嵌套恢复、普通值不刷新、默认horizon、跨历史/Clock/实例/生命周期及权限不相容、缺快照/冲突、晚证据与晚发生。已有CallEndpoint.before与正常Ok/业务Err的after是限定特例；Fault/Cancel不能冒正常after。

纯函数、声明与完整专业模型使写法可检查，不代表历史producer、保留/证明器、native适配、生产Reader或目标运行已实现。当前检查不要求永久全量日志；有资格的保留投影或静态模型可提供实际所需证据，缺少则保持Need。数学见证不签发真实发生或未来知识，新增核心构造的必要性也不能仅由某一旧时间戳编码失败推得。
