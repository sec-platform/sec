# 受控状态帧：专业观察与有限解释

规范含义归[只改变指定位置](../../../../docs/作者/需求含义与实现责任.md#controlled-state-frame)；本画像固定以下实际供给的解释。

## 固定专业供给 profile:controlled-value-frame:1

以下是上述native名字的完整有限解释，消费唯一正文 `需求含义与实现责任#controlled-state-frame`；它不反向改写其语义。实际采集/证明器/NativeHeader适配未实施，缺资格保持Need，不把声明当已安装能力。

### Cut、位置与边界的真实来源

FrameCut是原调用、状态拥有者及合格Observation/模型对同一次c的保留基础。身份至少关联实际receiver/事件主体、同一受控边界B及其修订、前后观察点与因果顺序、源/专业解释、生命周期及覆盖。只能在准确CallEndpoint.observation.after的正常成功/业务错误阶段消费本例OwnStateObservation；不把Fault/Cancel/未知完成当after。不执行构造器、私有读取或全堆遍历来“补”一张自己选择的cut。

OwnStateObservation的scope:retained-own-state-frame明确解释为本次附着操作receiver自己的已声明state域。若以后选择动态/异类边界，必须由那个对象/状态owner提供同一FrameCut族的专业边界合同，明确成员、类型与覆盖；没有这样的合同就是NeedsControlledBoundary，不能默认所有可读字段、所有heap或空域。这个scope选择不授权遍历Workspace的Store/main/preview私有状态；现Workspace仍优先使用叶合同和组合推理。

Position是纯身份令牌，不是地址、Place、可读句柄、写能力或Grant。其实际身份来自同次合格基础所固定的拥有者/对象运行激活、声明/投影与必要生命周期代；别名指同一位置，地址复用的不同生命产生不同键。不同Root/Session/对象不能因同名cell而合并。B是选择范围，**不作为复制位置身份的标签**：同一个真实位置属于两个边界时仍须同键，才能正确合取约束。

对该B的两态取完整位置域并集L；保留双方均Absent的已声明位置也不改变关系。每个位置的状态为owner规范的Absent或Present(准确类型,语义值)。Present的语义值包含该类型公开的presence/初始化等必要状态：Present(None)不能变成Absent；若“对象是否存在”属于B观察，B还必须覆盖该存在性状态，不能只列一个没有值的可选字段然后遗漏对象销毁。指针槽值与所指可达状态不同，后者只有被B的原合同涵盖时才参与。

每个类型的可观察等价来自准确位置/类型合同，包含名义域、版本、适用值域及可用的纯比较解释。不同类型不强转；同类型缺比较/表示资格为Need，不比较显示串、hash或host对象地址。浮点NaN、文本正规化、handle身份与可达对象内容各用原合同，不能拿语言某个`==`的偶然结果替代可观察等价。

FrameCut是保留基础，不是一个“全部已知/全部可读”的万能证书。每次ValueFrame(cut,S)的消费，分别核完整位置域、S资格和保护域上真正需要的状态/比较依据；S内不需要执行无关的等价判定。拥有者可用有来源、适用条件和覆盖的逐位置判定/静态证明代替向外物化值，但一个摘要、bool字段或complete:true不能自签事实。对象释放后只消费已保留前态与真实Absent后态，不重新读取退役存储。

### 三个实际函数

| 函数 | 完整数学含义及资格 |
| --- | --- |
| OwnCells(cut,names) | names按当前receiver准确state声明的Name逐项解析，不是JSONPath或对象字段反射。每名必须真实存在、唯一且属于这个B；重复/未知/越界名字拒绝，不静默忽略。结果是这些声明在L中的准确位置集合，必要生命周期代保留。它只选择位置身份，不读值、不执行写入；名字选择固定于该要求实际绑定，不以后态实际改动反推允许集。 |
| ProtectedPositions(cut,allowed) | 先核allowed的所有键来自同一B/c的合格位置域及相同身份/类型解释，S⊆L；错误代、外来键、缺覆盖分别拒绝或Need。结果**恰为L\S**，不漏新增/删除位置、不补有利空集。它只作完整域与集合差，不先要求S内值可比较。 |
| UnchangedAt(cut,where) | where必须对应该cut的真实位置，不能混另一调用/实例的令牌。双方Absent为true；仅一方Absent为false；双方Present但准确类型不同为false；同型时恰返回其原位置合同的值等价。缺所需状态、比较或来源为Need，不能返回false/true伪装资格。 |

最后一行的Bool是合格解释后的确定结果；Need由专业绑定/Method资格在应用前或原证据消费中保留，不塞进Bool，也不伪造一个默认值。ValueFrame只在ProtectedPositions结果上调用UnchangedAt；因此“放开S内位置但其比较方法未知”不会额外要求那些不被保持的位置可比较。所有数学状态都已给定时三个函数有确定含义；真实观察/证明尚未取得时不冒称该输入已合格。

`.d.ts`中private PositionSet的唯一映射为同一Position的Gift finite Set；ReadonlyArray<string>映射为原有序CellNames。没有泛型Any值，也没有把异类型位置的值装进公开Json。Position的相等只沿真实位置身份，不能用native JS Set的引用相等；native view保持只读、不保留、不消费独占对象。FrameCut/Position不由作者构造，类型brand不是真实宿主字段或来源证明；TS断言也不能发行它们。

OwnStateObservation的普通ObserveCut恒等body只保持已经取得的基础；它不是采集器，也没有凭scope字符串造事实。动态/异类分支可以选择同一位置域/比较协议的专业观察，原CallEndpoint、quantify.domain及Meaning解释不变，不再加一个Frame AST。有限域可给下述完整遍历模型；无限或未闭合域继续原Domain/定理资格，不取有限样本冒充全称。

### Same-cut、权限与干扰

两态须同c、同B、同actor/实例与约定观察点。分别最新的两个快照或两份同型cut不能拼接；跨组件/分区共同切面必须有原组合依据。只知道before/after各自一致不证明二者属于这次操作。

此profile不公开私有状态读取API。声明Frame要求可以先于实现资格存在；实际值/判定必须由拥有者在原权限内提供或由合格静态模型证明。Location键、S选择或比较结果都不授Grant。父组件不能因为能写selector就读取其子私有状态。

B外环境变化不受此Frame限制。B内若允许并发干扰，原并发合同必须使同一前后结果要求可满足：取得适当独占/同步、依赖条件或明确收窄受控B；不能删除失败位置，也不能把结果帧改成“我本人没写”。`no-write`、写效果足迹、调用次数、持有/释放及中途泄漏继续独立。

## 参数化形成/消去规则

给定真实边界合同B、同次观察c与已绑定S，先形成上述Cut/位置/类型/覆盖义务；若某项未定，只保留相交Need。然后：

```text
OnlyChange(c,S)
  -> forall l in ProtectedPositions(c,S): UnchangedAt(c,l)
ProtectedPositions(c,S) = L(c) \ S
```

这是原全称与集合差的确切展开，等同唯一owner的`forall l∈L. l∉S implies UnchangedAt`。没有运行短路、操作阶段、写权限或额外时钟。S的实际选择由原调用输入、静态决定或对象合同明确；实现不能偷换为“这次实际上被改过的集合”。显式另写后态依赖的关系是另一要求，不能作为本短写的自动补全。

有限具名域按各位置类型直接展开成合取；位置声明集合空且完整时才有空全称真，未知边界不能用空域取得它。动态异型域按同一量词对每个已固定类型进行比较，存在类型的内部见证仍在owner/位置解释中，不暴露为普通万能value。

固定同次完整有限模型，对L的大小归纳：空域/空保护域保留全称单位；每加入一个不在S中的位置，恰增加该位置原有型Unchanged要求；在S内则不增加。Exists/位置别名只改变同一键的发生表示，不复制或丢掉不同位置。故消去保持原帧判定；其前提不建立真实cut/覆盖、权限、Method或物理采集。

同c/B的两项帧保持`S1∩S2`，不是并集；原有独立要求没有被本条S扩大撤销。异B同cut的保护域为`(L1\S1)∪(L2\S2)`，只在实际位置及相等/两态解释可比较时归一。跨cut或不同相等解释不能选择较弱的一份；保留原合取。这个逐位置消去定理不等于分离逻辑的局部写权限frame rule，不提供别名/并发的分离前提。

## 必要信息的删除反例

这些反例证明该映射中的信息不能悄悄删掉，不证明每个native函数名都是语言最小原语；有限已知cell可以完全消去这些专业接口。

| 删除的信息 | 可区分反例 |
| --- | --- |
| B | threshold未变、外部flag变了：B只含threshold时合格；B也控制flag时不合格；不能冻结全部世界或放过全部未提状态 |
| 稳定位置/别名 | 两个cell的0/1互换，值的多重集没变，S为空仍违规；两条别名不能把同一位置复制成两个自由修改机会 |
| 生命周期代 | 同一地址的旧对象销毁并创建同值新对象，旧键Present→Absent、新键Absent→Present；擦代会错判unchanged |
| 联合域/存在性 | 只取before会漏新位置，只取after会漏删除；取交集二者都漏；Absent不是Present(Unit/None) |
| 类型/等价合同 | host中Int 1与Bool true可能相等，仍不是同型位置状态；同显示串/hash也不能证明原Text/记录值等价 |
| 同次c/B | 从另一调用拼一份方便的before让结果相等，而这次真实调用改了受保护cell |
| S及其绑定来源 | 只允许threshold与不允许任何位置是两种承诺；事后S=实际差异将要求变成空话 |
| 效果/权限独立 | 0→1→0通过值Frame，却可能违反no-write；允许S不授写权；没有私有观察资格不能通过位置令牌自行读取 |
