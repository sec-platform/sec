# 共享资料工程：实际作者源、交付设计与连续修改

[工程清单](../shared-views.project.json)捕获下表实际源，目标ts选择公开Workspace组件作为package根；[控制源](../shared-views.control.json)初始为空。工程交付设计是一个同步TypeScript内存库：一份资料、两个独立阈值、六个公开操作，具体公开面由[目标设计合同](supply/target-design-profile.md)确定。这里提供完整的有界工程设计与准确结构，生产Reader、生成器、运行实现和工具链资格尚未取得。

| 源 | 开发者在此决定什么 |
| --- | --- |
| [policy.module.json](policy.module.json) | 条目含义、合法输入、容量、筛选及可共享关系；唯一范围、容量和筛选政策 |
| [workspace.module.json](workspace.module.json) | Store、ThresholdView、Workspace，状态所属、接口、成员、连接、正常/错误结果及同次调用约束 |
| [call-values.module.json](call-values.module.json) | 本工程引用的端口和错误构造的普通有型值，供准确观察选择使用 |
| [observations.module.json](observations.module.json) | 原observation合同的本工程采用；纯identity观察器及四个可复用关系 |
| [普通序列模块](../序列派生/sequence.module.json) | 已有Collect、Length、SumInt等通用值定义，不复制进应用 |
| [被动值声明](supply/boundary.d.ts)、[选择](supply/boundary.selection.json)、[解释](supply/declaration-profile.md) | 准确宿主输入边界与六个通用观察叶，不藏入业务验证器 |
| [同次调用声明](supply/calls.d.ts)、[选择](supply/calls.selection.json)、[解释](supply/call-profile.md) | 由原调用/Effect/持有producer取得事实；不以自报记录或observer函数造事实 |
| [目标设计合同](supply/target-design-profile.md) | Workspace到create及六方法的映射、完整包、私有实现自由及布局控制责任 |

开发者可按[完整作者工程](../完整作者工程.md)先提出短意图，接受系统形成的准确含义，再编辑原决定。这里的JSON是同源结构展开；现阶段没有可运行的文本/图形同源编辑工具，也没有作者成本下降的实测。完整字段仍有维护成本，不能因为它们由系统形成便从比较中删去；未来紧凑显示只隐藏可推导内容，不隐藏产品决定。

实际源已采用现有短形及两个普通关系复用，原独立Goal和同次调用身份保留；[作者信息与修改保持](作者信息与修改保持.md)给出可直接写出的片段、消去证明、连续修改和自举绑定交叉核。这里减少重复维护，不把缩进行数下降称为语言完备或实际用户收益。

依赖方向如下；箭头表示真实引用或供给责任，不表示运行阶段：

```text
project → Workspace → Store / 两个ThresholdView
                  → policy → 普通序列定义 + 被动值声明
                  → observation → 同次调用声明 ← 原调用/Effect/持有producer
project + Workspace + control → 目标设计合同 → 待实现的生成、构建、运行
```

它消费[关系Formula定义](../../../docs/作者/需求含义与实现责任.md#composed-relation-definition)：新关系可由已有关系组合后继续被其他关系和Goal应用。原生type选择仅在候选格式中进入类型空间，旧selection /1不改义。声明与准确解释闭合不等于生产适配已加载，也不等于原生函数有实现。

## 应用实际拥有的内容

政策定义全部在同一模块。Row/Rows是记录/有序序列的**有型载体**；score的0..9业务范围由InScoreRange和RowsAdmitted准确限定。不能仅凭字段为Int就宣布范围已满足；DecodeRows对每项要求ValidRow，KeepByThreshold要求输入RowsAdmitted和合法阈值，其输出据实际筛选继承范围。Text是原标量Text，没有换成码点数组或另发明文本表示。

| 源定义 | 准确内容及实际消费者 |
| --- | --- |
| InScoreRange | 两个有参数AtLeast关系的合取；统一拥有0..9政策，ValidRow、RowsAdmitted、ThresholdRepresents及筛选共同消费 |
| ValidRow / RowRepresents | 应用拥有score/text准确字段名、范围、raw与有型记录对应；宿主叶只给通用结构/标量观察 |
| ValidRows / DecodeRows | 连续目标数组与完整有型Rows对应；按原位置匹配，保序保重，没有把无效项过滤掉 |
| RowsEqual | 长度及同位置字段相等，不把两个相同条目合并成集合 |
| ThresholdPolicy / MeetsThreshold | 唯一的可调用政策值；初始引用AtLeastBody；选择表示与关系解释消费同一值，不是两份可改比较逻辑 |
| Select / KeepByThreshold | 原序列推导给有限产生值见证；关系组合准确限定输入、阈值和同一输出。生产Method尚未据此取得资格 |
| CapacityWithinCounts / ScalarTotal / CapacityValid | 上限唯一归CapacityWithinCounts，typed计量由ScalarTotal和Length取得；10000/100000是逻辑容量，不是物理内存/耗时 |
| RawScalarTotal / CapacityExceeded | 使用已有有限raw观察计数，复用同一CapacityWithinCounts；无效raw不能成为容量错误，无新解码供给 |
| CreateAccepted / CreationRequirement | 同一raw与同一rows同时满足解码和容量；Goal在这组关系上表达achieve，不把关系本身混成模态 |

AtLeastBody/AboveBody只是两个有限整数比较的普通值解释；ThresholdPolicy选择其中一个。它们连同显式Select/ScalarTotal是本模块的少量计算内容，不能因为代码由系统形成就从总体维护成本中扣掉；应用没有把验证、构造、调用和关闭改成一条阶段流水线。

## 为什么原始输入不会被错误投影

所有目标观察叶在承诺域内都是总的：没有有型解释时返回0项候选，有解释时返回1项。例如合法空数组是`[[]]`，无效数组是`[]`；合法空文本是`[""]`，非法字符串是`[]`。FieldValues、NumberIntegers和ScalarTexts依次由量词绑定其中确实存在的值，故没有在非数值对象上直接取IntegerValue的部分投影。

这不是把Formula的implies当运行短路：应用没有靠一个假前提“保护”未定义Expr。结构观察方法未安装、知识未知或观察不完整时仍是Need，不能假造0项。操作层以互斥的正常分支保证Closed优先、InvalidInput先于CapacityExceeded；它规定可观察结果，允许不同但保义的实现顺序。

## 可核的保持命题与反例

这些是相对于源中的有限序列语义、精确std合同及六个边界声明解释的设计推导。结构检查及声明符号检查不代签下列前提的生产实现。

1. **DecodeRows恰对应合法目标资料且结果唯一。** DenseArrays最多给出一个完整位置序列；每个FieldValues及标量解释也最多给一个值。RowRepresents要求键集合准确且评分合格，再按值约束对应Row。DecodeRows要求两序列长度相同，对每个源index存在同index结果；Enumerate的索引唯一且覆盖0..length−1，所以没有遗漏、额外位置或重排。有合法raw时依次取这些唯一Row值构造Rows即得见证；无合法raw时至少一项不存在或不合格，不能满足全称。合法空数组的全称域确实完整且为空，唯一结果为空Rows。
2. **RowsEqual等同有限Rows的逐位置相等。** 相同长度及完整唯一index让每个左位置匹配且仅匹配同一右位置；score/Text相等是原精确值相等。反向按相同位置直接构造见证。两个重复条目仍占两个index。
3. **Select与KeepByThreshold共同保持输入出现。** 原Collect展开按输入顺序对每个出现产一项或零项，ThresholdPolicy对每对整数总且无外部效果；所以保留项不重排、不去重。RowsEqual把同一次实际输出限定到此序列，RowsAdmitted与阈值域保持业务约束。此结论不把Bool关系检查器误当可生成产品的方法。
4. **容量计量准确且有限。** 每个Text的ScalarLength精确非负，有限序列SumInt求数学整数和，Length计出现数；两次AtLeast恰给闭上界。空资料为0/0，重复文本重复计数。方法可有资源不足或宿主异常，不能从数学总性推出任何物理耗时或内存保证。
5. **再次修改仍只有一个政策源。** 将ThresholdPolicy.value.ref由AtLeastBody改AboveBody，Select和MeetsThreshold共同改变；AtLeast关系本身、范围和容量上界不改变。若误改AtLeastBody的Equal分支，范围端点及容量边界也会改变，是有具体消费者的反例。

6. **错误分支计量与成功分支一致。** ValidRows(raw)成立时，DenseArrays给完整唯一位置序列，每个text字段及ScalarTexts解释唯一；DecodeRows在每个相同位置给相同Text。因此RawScalarTotal和ScalarTotal逐出现相等，Length也相等；对序列长度归纳即得两个容量判断等价。CapacityExceeded同时要求ValidRows，故“前缀超容量、后项非法”不满足容量错误条件。无效输入上的各叶仍总，不依赖逻辑短路保护部分函数。

## 组件如何共同兑现产品

Store只拥有rows，ThresholdView只拥有自己的threshold，Workspace只拥有closed及成员拥有关系。没有一份同时复制全部子状态的可写工作区快照。构造成功的rows由CreationRequirement的同一个见证确定；初值5通过静态参数进入各自threshold。构造失败没有receiver/after state，临时成功子构造仍按原组件合同清理。

所有接口操作和构造显式声明`termination:total`，含义沿[操作进展合同](../../../docs/作者/组合/定义与接口.md#component-call-progress)。这是正常域的终止义务，不是证明、时限或资源数值保证。互斥错误族与成功关系一同排除永拒、吞错及以永久Fault冒充总性：无效raw只能InvalidInput，有效超限只能CapacityExceeded，合法合格只能成功。Workspace开放时只负责准确委托，不再复制Store的raw验证；Closed路径不观察raw内容或成员。

View.read在同次调用完整事实中取得唯一来源Rows，并将实际output与KeepByThreshold相连；它不能拿旧快照、重新读取后的资料或自己编造的Rows满足关系。五个Workspace操作用Forwarded保持同次真实子调用的输入、成功结果及逐构造错误注入。read的child errors是Never，空ErrorMap有准确意义；set/replace的不同名义错误族必须显式映射，不因同名tag自动相等。close无child业务调用，完成入口持有的逐项一次结算；重复close的入口持有为空，不能二次释放。

RetainedCall仅在该profile完成来源、receiver、调用、phase及完整性资格后提供；本最小profile只支持正常完成after。未取得视图时先报告Need，不把缺事实变成Bool false或空序列。SourceRows等五个叶是有限观察合同；可由合格静态方法提供模型，不要求安装全量运行日志。调用、Effect及持有的真实producer和适配实现仍未完成。

Store的局部帧、两个独立View的局部帧、唯一连接、恰一次委托与关闭责任共同推出[完整操作表](../完整作者工程.md#engineering-formation-and-call-map)。必要前提包括原组件私有状态边界和Forwarded的访问/持有足迹封闭；父组合拥有成员不授予直接读写子状态，不能在正确委托后偷偷修改另一阈值。证明还依赖已声明的无重叠/重入正常环境与真实叶合同；不能用这些定义存在代替实现资格。

## 实际连续修改

R0是清单当前捕获的实际源。以下均为标准Git unified patch，按顺序作用于前一源；它们是设计编辑样本，不是运行迁移脚本，也不是新增Gift编辑语言。路径以仓库根为基准，语义源捕获不把补丁当第二份活动模块。

| 后继 | 实际源码差额 | 继续保持 |
| --- | --- | --- |
| [A：01-preview-threshold.patch](revisions/01-preview-threshold.patch) | preview初值5→8，包版本0.1.0→0.2.0 | main=5、同一Store、筛选≥ |
| [B：02-strict-policy.patch](revisions/02-strict-policy.patch) | ThresholdPolicy引用AtLeastBody→AboveBody，版本0.2.0→0.3.0 | 初值5/8；范围与容量仍用原AtLeast |
| [C：03-extract-views.patch](revisions/03-extract-views.patch) | 引入TwinViews，成员改为pair，连接与四个实际端口selector共同更新 | 同一两个View发生与Store，严格>，无新增状态、dispatch或包根出口 |
| [D：04-pin-definition-file.patch](revisions/04-pin-definition-file.patch) | 加入KeepByThreshold的definition-file require | 必须落到真实产生筛选输出的实现，不是Bool检查器 |
| [reset：05-reset-layout.patch](revisions/05-reset-layout.patch) | 删除该Control记录，保留同fileId空records | A/B/C全部保留；允许系统仍选原路径 |

C的编辑对应绑定紧邻的R2前像：`Workspace/main → Workspace/pair/main`、`Workspace/preview → Workspace/pair/preview`，其来源、四个端口和拥有边一并对应；Store与closed恒等，pair为新增无状态边界。补丁本身仅表达文本差额，不证明稳定发生身份；上述对应及原[整体编辑合同](../../../docs/作者/组合/结构编辑与身份保持.md#whole-change-materialization)才是设计要求，生产身份保持工具仍待实现。收缩pair给旧新状态映射，对操作分类及有限合法历史归纳可证明本例C保持指定观察，完整论证见主例。A/B是有意行为改变，不能套用C的等义结论。

评分[5,8,9,5]在A后主结果[5,8,9,5]、预览[8,9]；B后分别[8,9]与[9]，C/D/reset保持B。只比较这些结果不足以证明调用、共享、寿命或错误保持；它们是政策判别向量。

必须保留的判别向量包括：空数组与无效数组；重复条目；孔洞；额外string/symbol/非枚举字段；继承字段；NaN/Infinity/小数/bigint/包装对象；评分−1/0/9/10；孤立代理项与代理对；恰好容量上限与超1；前缀超容量但后项非法。最后一种只能由完整操作合同选InvalidInput；本关系模块不得独立返回CapacityExceeded掩盖它。

## 来源和后继

policy的workspace imports只有`module:gift-sequence-values-v1`和`module:passive-typescript-values`；前者为真实普通源，后者为真实声明及明确profile。根模块另准确引用policy、observation及调用值/声明模块。std只使用已固定的IntCompare、IntEq、TextEqual及序列模块原标准依赖；没有凭源码名字生成全局能力。两份原生选择的sourcePath都相对本工程清单根，即`examples/第一层作者/`，不是相对selection所在supply目录再次拼接。

Formula关系依赖为非递归DAG：CreateAccepted依赖DecodeRows/CapacityValid，DecodeRows依赖RowRepresents，后者依赖ValidRow和整数/文本关系；量词binder均为各自声明内的局部绑定。定义的条件重用须保持这一环境，不能用全文替换捕获调用者同名变量。当前设计展开器只完成结构展开；生产绑定、卫生实例化、类型和Method资格没有被伪报为已实现。

本例现在有准确组件源、实际调用绑定、目标设计合同及连续源变化。目标profile采用已有开放声明形式；没有真实lowering时，不伪造严格供给清单的loweringRefs，也不放宽其Schema。工程仍有明确实现缺口：生产Reader、语义绑定/类型/效果与方法资格、观察producer接合、目标生成、工具锁、构建、运行、故障/平台验证、自举与作者成本测量。有限结构检查、声明符号检查、补丁可应用及设计归纳各证明自己的范围，不代签这些缺口或整个通用语言完备性。
