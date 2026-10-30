# 保序序列派生：作者源码、普通定义与修改

本目录是[第一层值表达](../../../docs/作者/第一层语言.md#intent-value-expressions)的设计交付。[gift.project.json](gift.project.json)只建立当前目录的语义源码范围，未配置或假造已实现的生成目标；[sequence.module.json](sequence.module.json)完整定义普通有限序列库，[queries.module.json](queries.module.json)通过真实workspace import消费它。它们选择design-converged候选文法；生产Reader、绑定检查、编译和运行没有在此目录实现。

应用作者使用的数学表面是`[E | x 来自 D, where P, let y=V, …]`；准确结构形与递归Expr槽归[短形owner](../../../docs/作者/紧凑结构与同源编辑.md#sequence-expression-surface)。queries中的Select、SelectedCount、PairSums、IndexedSelection与SelectionExists展示纯值定义、调用参数中的嵌套、外层依赖域/共享局部值、真实位置和值配对，以及直接在关系实参中的推导。它们是独立接口见证，不要求一个产品同时保存同一要求的多份等价源码。

普通序列模块不占用std前缀。项目捕获两个不同moduleId，由同次固定ModuleIndex唯一解析`sequence`导入和真实exports。Collect公开，EnumerateFrom私有；路径不替代模块身份。表面方法的依赖是此实际Collect定义及其展平定律，不是任何同名/同型回调。纯展开规格收到`sequence:Collect`仅是设计检查输入；未来绑定者还须证明它在同次ModuleUse引用这个合格出口。此例没有安装或签发该生产资格。

## 普通定义与条件证明

| 实际出口 | 固定含义 | 终止与资格 |
| --- | --- | --- |
| Concat<T> | 左序列的每个出现，然后是右序列的每个出现 | 左序列长度递减；有限普通值域上总 |
| Collect<T,U> | 对输入每个出现按次序求project，依次连接其返回的Sequence<U> | 声明partial；当实际回调在所用域上纯总且返回有限序列，长度递减给本次总性 |
| FoldLeft<T,A> | 从seed开始，按输入次序一次一次以step更新累积值 | 声明partial；实际step总时按输入长度证明本次总性；不改成右折叠或并行树 |
| Enumerate<T> | 每个出现形成`{index,value}`，index从精确数学整数0递增 | 私有helper按剩余长度递减；空序列为空；位置不成为永久业务身份 |
| Length<T> | 每个出现使精确Int加1，空序列为0 | FoldLeft在本地纯总加法回调上的实例证明 |
| SumInt | 按出现将数学Int相加，空序列为0 | 同上；不通过浮点或机器整数近似 |

所有泛型实例仍须满足原普通值读取、字段可读、捕获、拥有和寿命资格。这里不声明任意Own/Grant/唯一资源都可复制，不添加没有真实定义的Copy/Clone约束。SeqUncons的None/Some、head/tail由当前准确Option/Profile解释，不以同名用户变体替代。回调的空captures上界只排除Region/Scope依赖，允许捕获普通不可变值；它不是无捕获保证。Collect/FoldLeft的noescape约束库对回调形参的保留，返回值与捕获的传递仍由原寿命检查，不能洗掉调用内借用。

**Collect见证。**对空输入返回空序列。对`h::t`，源码先以let取得`prefix=project(h)`，再以let取得`suffix=Collect(t,project)`，最后Concat(prefix,suffix)。若回调在h处失败或发散，不处理t也不伪造截断成功；正常时每个输入出现恰调用一次。按输入长度归纳，回调次序、子序列内部次序和出现重数保持。Concat按左序列归纳保持拼接含义。总性证明还依赖各回调正常终止；effects为空或声明total不是证明本身。

**推导消去证明。**对限定项列表结构归纳。空列表单项包装E；where只在普通Bool为真时继续，let使V在当前前缀求一次；from由Collect逐出现扩展绑定并应用归纳假设。故域在其准确前缀环境中求一次，后继域能依赖前面变量，yield对每个幸存完整绑定求一次。没有新临时名字，原词法binder映射到同位置lambda/let；新binder不进入自身来源，外层同拼写绑定不被误捕获。回调捕获与阶段仍由原类型/观察owner检查。

因此对于有限完整域及纯总合法项，短形和展开值相同；对所选严格求值见证，条件、局部值和结果项的先后也保持。这里不推出物理执行次数、目标优化、取消点、峰值内存或任意资源界等价；它们须满足实际调用和目标合同。数学序列递归也不要求目标一定创建链表或使用递归栈。

## 开发者实际改哪里

| 任务 | 唯一作者变化 | 必须保留的区别 |
| --- | --- | --- |
| 筛选评分至少5 | Select的threshold参数与where关系 | 重复输入仍重复输出；空输入为空 |
| 只改变某个视图阈值 | 该采用处状态/参数 | 不修改另一个视图或共享关系定义 |
| 所有采用处从≥改成> | AtLeast的Equal分支变false并沿真实引用传播 | 不只改某一输出文件；共享定义的全部消费者都受影响 |
| 条件中重复使用派生值 | 在准确位置加入let，再复用binder | where前后的位置不可随意交换；不能让失败的V提前求值 |
| 需要位置 | 来源采用Enumerate，使用同一occurrence的index/value | 不能把任意b[k]替换为此配对，也不能把位置作为稳定实体id |
| 评分变为optional | 在原字段存在性/Option合同下显式处理缺席政策 | 排除、默认、报错是不同决定；不能让模式generator偷偷选一种 |

可选字段的`probe`仍须通过原[记录合同](../../../docs/领域/计算基础/通用计算与任务语义.md)取得真实导出与用途资格；本例没有伪造安装。合法缺席None、Present(None)、未知观察、非法字段和缺解释分别保持。普通if/match短构造可以容纳嵌套推导；完整op分支仍不递归猜短形。

有限审查向量：Select输入评分`[5,3,5]`、阈值5返回两次5，SelectedCount为2；严格大于修改后为空。PairSums输入`[[1,2],[],[10]]`返回`[3,4,11]`：每组size只求一次，空组被条件排除，内域不提升到外层。`[10/x | x来自[0,2], where x≠0]`只在2处求投影；将除法let搬到where之前改变定义域。位置例中相同值的两个出现仍有不同index。这些是可审查的数学结果；结构和展开测试不代签实际执行。

## 文本容量的普通定义与有限方法

完整工程的条目数已由Length表达，数值聚合由SumInt/FoldLeft表达。文本叶采用一个普通定义`ScalarLength : Text→Int !{}`：若`t=<s₀,…,sₙ₋₁>`为有限合法Unicode标量序列，结果准确为n。每个出现单独计入，空文本为0；不规范化，不统计字节、UTF-16码元或字素，不读取外部状态。它沿原Text值域及普通模块/MethodSpec接合，不扩std或新增业务语法。

`module:unicode-scalar-text / ScalarLength`在这里是**完整给定含义与有限方法的拟采用普通出口**，不是已安装模块。当前core:function必须有真实作者body，因此本目录没有塞入空body或伪造import以使结构检查通过。正式供给应由原ImportedModuleView→Binding/MethodSpec→UseBinding承接真实外部导出，或交付同义作者实现；相交源码/方法身份、签名、内容与目标资格须同时取得。下面给出方法的输入域、全部分支及保持关系；实际供给载体、生产调用与运行证据仍未交付。

**UTF-16方法。**在公共值边界确认primitive string，再用位置i及精确Int计数n从0开始。i等于码元数时返回n；当前码元为高代理项时，必须存在紧随其后的低代理项，成功则i增加2、n增加1，否则InvalidInput；当前码元为低代理项则InvalidInput；其他码元则i增加1、n增加1。失败不替换为U+FFFD，不返回部分数量，不正规化文本。TS方法的n用bigint或其他已证明精确的Int表示，不用浮点累计；i的宿主表示也须覆盖真实字符串范围。这个算法沿[ECMAScript CodePointAt](https://tc39.es/ecma262/2024/multipage/ecmascript-language-source-code.html#sec-codepointat)的一/两个码元及unpaired surrogate区分，不以宿主字符串可迭代代签输入有效。

循环不变量：已越过前缀恰由n个合法Unicode标量编码，i在标量边界，未越过部分尚未计入。每个正常分支消耗一个标量且使剩余码元数严格减少；终止时整个合法文本被计数，非法代理项分支恰在不可解码输入上拒绝。目标资源不足/取消不是一个数学数值，也不改成InvalidInput。

**UTF-8/Rust方法。**已合法解码的`&str`使用[chars](https://doc.rust-lang.org/std/primitive.str.html#method.chars)逐Unicode标量精确累加；`str.len()`的字节数不能替代。若用宿主count，须证明实际有限长度结果及到Gift Int的转换无损；累计到无界Int是另一个保义方法。原始非法UTF-8先由输入合同拒绝，不能以替换解码后结果代签原Text。其前缀不变量与上述方法相同，只改变编码表示。

| 文本或边界 | 准确结果 |
| --- | --- |
| 空文本；`A😀` | 0；2（后者为3个UTF-16单元、5个UTF-8字节） |
| `e`加U+0301；U+00E9 | 2；1，不自动正规化 |
| woman + ZWJ + laptop | 3，即使显示为一个图形 |
| CR LF；NUL；显式U+FFFD | 2；1；1 |
| U+D7FF、U+E000、U+10FFFF、U+FFFF | 每项1；标量排除代理项而不排除noncharacter |
| 孤立高代理项、孤立低代理项、反序代理项 | 原公共边界InvalidInput，不返回计数 |

标量域见[Unicode定义](https://www.unicode.org/glossary/#unicode_scalar_value)。这些有限反例区分码元、字节、标量与字素；不声称覆盖所有目标错误。完整工程先验证全部输入，再比较容量：同一条目出现两次就计两次；即使前缀已超过容量，也不能掩盖末尾非法文本并把InvalidInput偷换成CapacityExceeded。先验证/再计量可以融合实现，但必须保持这项对外结果优先与失败状态帧。

本轮取得的是通用序列源、可达短形、书面保义证明和文本计量的有限方法设计。没有宣称Text供给已安装、整工程已生成、通用线性容器已覆盖或作者使用成本已实测。短形删去重复lambda/单项包装/条件空序列和机械绑定，通用库保留可审查定义；这与把整份业务程序藏入一个函数是不同的可核查范围。
