# 可从同一源码恢复的对象选择

本例落实[源发生绑定](../../../docs/作者/结构化源码.md#source-occurrence-role-binding)：作者选“本工程的预览组件”，持久源必须保留这个选择。只保存一个没有发行映射的不透明objectRef，无法在干净克隆中区分两个同型组件；把路径藏进字符串或另维护映射表也没有消去这项信息。

## 实际写法和现有消费者

```json
{"source":"occurrence","selector":{"kind":"component","componentPath":["preview"]}}
```

它可直接放进已有根/组件contextBindings、成员bindings和RequirementLink.roleBindings。向下转传仍写`{"source":"context","role":"preview"}`。Pattern的一对象绑定为`{"kind":"one","object":上述Actual}`，不是把Pattern当成BusinessRoleActual读取；候选参数图在其真正objectBinding节点接入同一选择。仅Pattern外壳保留原可选typeRefinementRef/identityEvidenceRef定位，实际见证仍须独立核验，其他actual入口严格拒绝这两个专属字段。旧definition/object/collection和旧Pattern.objectRef不改义。

[bindings.json](bindings.json)是指定上下文的绑定校准输入；其project指向已有[完整共享资料工程](../shared-views.project.json)，不是第二份作者身份表。八项actual都是新分支的准确源码形状，分别选择工程、输出声明、具体产品根、根组件、main/preview组件，以及两者各自的callFacts观察成员。所选组件、成员和Definition均在原工程真实存在。本例不向原工程添加一批没有产品必要性的Goal；形式角色的类型核对由下述真实声明与校准上下文提供。

组件角色使用`typeRef:"sourceModel:Component",cardinality:"one",bindingLevel:"object"`，其中sourceModel导入[subjects.module.json](subjects.module.json)。Requirement主体类型使用原`{decl:{import:"sourceModel",export:"Component"}}`；Pattern角色使用同一Declaration身份。这里的object层指具体源模型主体，不能当运行receiver。actual没有typeRef、issuer或hash供作者自报。

## 固定的有限源模型解释

设计解释身份为`profile:source-model-occurrences`修订1。本段连同真实Subject声明和原源发生规范是其完整有限合同；没有同名生产consumer、安装包或运行资格的声明。它沿原SourceReader/Profile/EngineImage、ModuleUse及Lock闭包一次固定，不在每条binding复制供给信息。类型必须是该次ModuleUse实际解析的Declaration，moduleId或显示名相同不够；解释缺失、冲突或声明被换成同形类型时保持Need/错误。

Subject声明是名义逻辑类别及其公开角色，不是record构造器。Project.roles为空表示没有公开子角色；不表示任意空对象都能变成工程。以下每个公开子角色只由真实源图投影产生，调用者不能另填值覆盖：

| 选择 | 准确SubjectSchema | 公开角色及原结构 |
|---|---|---|
| 当前捕获工程 | Project | 无子角色；身份属于本次项目发生 |
| target/rootId输出声明 | OutputRoot | project指同一Project；该声明可选择多个出口 |
| 选定的具体公开出口 | ProductRoot | output指其OutputRoot；身份另含实际export和根绑定 |
| ComponentUse或确为组件的根 | Component | root指准确ProductRoot；保留componentRef及已绑定参数/上下文 |
| eventParticipations成员 | EventUse | component指真实包含组件；保留event:stream及publish/subscribe |
| resourceParticipations成员 | ResourceUse | component指真实包含组件；保留resource:model、单位及owner/provide/consume |
| observationParticipations成员 | ObservationUse | component指真实包含组件；保留observation:contract及原方向 |
| 其余合法DefinitionUse成员 | Member | root指准确ProductRoot；准确slot、容器和专业Kind仍属于资格 |
| deploymentRef中的节点 | DeploymentNode | root及其instance所指Component；保留placement与replicas方案 |

Member不是丢失专业类型的万能对象。stateParticipations、dataAccesses、protocolParticipations、uiParticipations、concurrencyUses、workflowUses、policyUses、qualityUses分别核state:machine、data:model、api:protocol、ui:view、concurrency:contract、workflow:plan、security:policy、quality:contract；不能把同型Member的workflow当policy用。具体专业consumer继续核精确Kind、角色、实参和范围。更细的专业名义视图需要真实精化依据，不在核心按业务能力无限加类型。

解析严格按以下顺序，只有实际依赖不足的部分保持未决：

1. 固定捕获工程、源范围、模块/导入/公开出口及准确选根上下文。project选择当前工程；跨根显式选择必须属于这个捕获工程，不读取任意路径或另一个工作区。
2. root缺省取本次单一产品根；显式root的target/rootId/export逐项匹配实际输出选择。OutputRoot和ProductRoot不能混同，输出一组公开出口不意味着它们是同一个产品实例。
3. 收集真实成员声明，按componentPath逐段匹配instance，沿所属模块解析componentRef及实际绑定。要求唯一且Kind合法；没有字段、重复名、循环无限展开、私有出口、未选出口或悬空路径不回退。空路径不是系统→组件强转。
4. member先取得真实容器，再按专业slot取DefinitionUse及useId。完整参数与方向仍依原owner核验；未具备某个业务值不伪造默认值。选中的声明及可判定的结构事实可用于分析，尚未取得的Method/运行资格不会变成已满足。
5. 从真正节点类别取得上表唯一名义类型和派生角色，核形式角色。缺少发生资格的手工同型抽象Subject、普通值或模板引用不通过；不允许Expr.value封装Subject来绕过。
6. 返回原绑定/SubjectBinding消费者需要的不可写模型主体、精确源对应、basis和read-set。相同准确发生得到相同身份；各消费者复用同一结果，不重新猜对象。SourceMap保留选择，不拥有另一可写发行表。

只读头收集可先于角色绑定，因此成员需求可以引用本根已经声明的另一个成员，而无需运行构造器。纯context转传若形成没有来源的循环仍是缺绑定；它不能靠头收集凭空产生对象。源专业成员的自身合同/数据、编译实现和运行观察各自承担原义务，源主体资格不替它们作成功保证。

## 共享、修改与反例

两个ThresholdView即使模板、参数和useId相同，main/callFacts与preview/callFacts也不同。另一输出根中相同组件路径仍是另一个源发生。跨根共享必须明确绑定到同一已选源主体，并继续由共享/资源consumer证明实现对应；引用同一模板、同一个预算数值或相同配置都不会自动共享。

检索工程可用同一构造选择queryKernel等四组件、三个output-root、服务deployment-node和拥有者的resourceParticipations预算。其余组件通过原context及专业bindings传递同一个ResourceUse主体；三个consume发生仍各有身份，不能因预算共享而合并各自责任。512 MiB是独立容量要求，source选择不证明物理内存够用、当前余额或分配成功。禁止实现的完整依赖集合仍须从同一候选的真实供给/依赖闭包派生，不由selector任意列子集。

将preview改名为draft：有权编辑同时改其instance及相交componentPath，其他main和别根保持；旧悬空路径明确失败。将preview抽进views：路径改为["views","preview"]，通过准确编辑对应证明身份延续，不能只看新旧字符串猜同一。只修改阈值等非寻址参数无需改selector，但读到该参数的资格与证据重新核验。源修订放在内部basis，不散落到每个binding的摘要字段。

删去selector信息后，对同型main/preview做交换，源码其余部分无法决定原角色；因此该选择对本反例是必要信息。给定有限、已解析且唯一命名的源图，路径每步按真实instance递进，最后按准确slot/useId或nodeId唯一选择，可对路径长度归纳证明结果唯一；更深合法组合不需要新关键字。此证明不宣称所有未来源类别、运行对象或真实世界意图均已覆盖。

本例承担可重建源选择与名义资格合同，绑定校准直接读取原工程源码。后继[检索工程](../检索工程/README.md)将它用于完整工程角色及要求；[持续确认](../持续确认/README.md)给出事件成员到实际发生/前缀/时间锚点的观察设计；[受控状态帧](../受控状态帧/README.md)给出位置域和同次两态的专业解释。它们各自承担自己的保持条件，不能由本例源引用代签。生产consumer、真实业务输入资格及执行仍须另取事实。
