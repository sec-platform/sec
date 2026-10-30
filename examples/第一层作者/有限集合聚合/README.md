# 有限集合聚合：普通供给设计

## profile:finite-set-fold-map:2 的完整有限合同

该设计profile与实际 `.d.ts` / selection 一起定义普通供给，沿原native SourceScope、真实Compiler Header、ModuleUse/Profile/Lock固定准确字节。修订2在保持原FoldMap合同的基础上新增FromSequenceWith及UnionWith，三个公开符号均为callable；声明显式export {}，private FiniteSet及finiteSetView不作为选择出口。修订1的旧内容仍由原准确捕获取得，不被新selection原地解释为修订2。当前消费者捕获同一更新后的selection及本文；不能只换版本名而继续使用另一份声明。

准确Gift签名为：

```text
FoldMap<T,M>(items:Set<T>, empty:M,
             combine:(M,M)->M !{}, project:(T)->M !{}) -> M
```

1. **输入来源与类型。** private native FiniteSet<T>不是新可构造Gift名义类型；它是已合格Gift `Set<T>` 的固定native只读视图。签名适配先取得实际Gift T/M及其名义/表示/寿命资格，再将同一Set值投影为该精确声明的view。品牌字段不是真实宿主属性，也不产生来源；作者不能伪造这个view、以任意host object/array或JS Set结构充当Set，不能用TS断言签资格。
2. **成员相等与完整性。** 输入必须是有限、完整、按其已合格Gift值相等判成员的Set，不是bag/sequence、不完整查询前缀或底层对象地址集合。core Set的成员资格、重复编码拒绝及静态解码由原Set/typed-static-literal owner承担；native adapter不重新用JS Set引用相等、JSON显示串或hash碰巧相等去重。T的可见普通记录仍保留真实名义类型。
3. **代数前提。** 在本次实际M及投影像/组合闭包上，empty是左右单位，combine结合且交换。先取得这一条件的准确语义/证明资格，再把遍历顺序从结果合同消去；不相信函数名、字段标签或自报law:true。无法取得则Need/拒绝，不任选一个顺序冒充有确定结果的Set FoldMap。
4. **回调资格。** combine/project在实际有限域及中间闭包上纯且有定义；获得正常总结果还须两者正常终止。仅Function.effects=[]不足以证明总性，也不隐式忽略Fault、发散、取消或资源失败。两回调均noescape、不保留；lambda可捕获合格普通不可变值，不能通过闭包/record洗掉Subject、Grant、Own、Place或Region寿命限制。
5. **值与借用。** view只在本次调用内共享只读，不消费独占元素，不延长源借用、不让native对象成为新的Set owner。遍历、回调参数与M结果继续原普通值/捕获/拥有检查；这里没有给任意T/M加虚构Copy资格。若实际类型不能提供所需只读/普通值行为，保留具体Need；本例只有普通精确Int、Bool、Option和不可变有型记录/Set。
6. **有限解释。** 对S={x₁,…,xₙ}的任一完整无重枚举，vᵢ=project(xᵢ)，a₀=empty，aᵢ=combine(aᵢ₋₁,vᵢ)，结果为aₙ。每个Set成员投影恰一次，组合恰n次；空Set返回empty且不调用回调。相等的同一成员只计一次，不把不同成员投影到同一个数值后的重数丢掉。
7. **顺序与可观察性。** profile不承诺成员间次序；只在上述纯总/交换条件及所请求观察范围内取得相同结果。callback effects、clock读取、随机或相对执行次序不能偷入。一般部分回调不能靠此合同保证同一Fault顺序；没有完整资格不执行后签成功。实际临时分配、Int中间大小、栈/资源、取消结算与目标故障另由Method/Target保持；结果等价不意味着资源零成本。
8. **阶段。** FoldMap不求现实观察，不执行目标效果。对已固定普通值，Method可以真实实现有限遍历；在符号/编译用途只形成这个数学值关系及依赖，不提前执行未来input。没有生产native body/adapter，合成/执行请求返回准确Method/Native Need；这份声明不算已安装能力。

输入是已形成Set，不存在“先任意枚举再丢重复”的第二数据入口。一般FoldMap的签名不自带任意回调终止定理；具体本例通过下述有限证明取得所需总性。若以后发布通用core wrapper，不能对任意回调标无条件total；本稿没有这种wrapper。


[真实原生声明](supply/finite-set.d.ts)及[选择](supply/finite-set.selection.json)固定三个出口。声明不是执行实现；FoldMap的原消费者[有参峰值测量](../有参测量/README.md)继续同一语义，新构造的实际消费者见[集合值形成](../集合值形成/README.md)。

## 从序列构造和集合并

准确签名为`FromSequenceWith<T>(items:Sequence<T>,equal:(T,T)->Bool !{})->Set<T>`和`UnionWith<T>(left:Set<T>,right:Set<T>,equal:(T,T)->Bool !{})->Set<T>`。这两个普通函数补充运行值引入，不改静态literal重复拒绝、序列重数或FoldMap的成员投影次数。`ReadonlyArray<T>`只适配准确有限Sequence；参数及返回的private FiniteSet<T>共同适配原Set<T>，不额外发行可命名native类型。

形成先取得[准确T及其已接受相等E](../../../docs/领域/计算基础/文法类型与求值.md#typed-set-equality)，equal必须在本次域实现E，不从任意回调重新定义它。空输入同样需要唯一型/见证。Union两输入及输出必须同一T/E或取得保持该语义的准确对应；不能混合不相容的字典/表示或只因函数名一样放行。比较需纯、确定、有定义且取得所需终止；只用equal，不强迫无关的顺序/编码/哈希。原T名义身份、opaque表示权限、普通值/借用限制及noescape捕获继续适用；Int实例可用不证明任意T可用。

FromSequenceWith先完整取得items及equal，再在有限参照中按输入出现次序维护代表序列：逐项与已有代表比较，有E相等代表则不新增，否则保留本项。结果成员恰为输入的E类；空输入返回空Set且不调用equal。最先出现的代表仅是可行实现见证；只有同类代表在已接受值观察中可替代时，才能消去代表及结果遍历顺序。Text的A/a不能用忽略大小写equal直接合并；业务归并须先形成键及必要代表政策。比较相等不改变仍可观察不同的原值。

UnionWith的结果按成员准确为两输入的并，不消费或修改输入，不因相等成员重复产生重数；两空得空，一空保留另一边成员语义。实现可只读取得两边完整有限代表并按同一E构造结果，不能让宿主容器身份变成可观察值合同。空为单位，并在同一E上结合、交换、幂等，因而可作为原FoldMap的Set结果combine。借用/拥有资格不足时保留Need，不借所谓纯值复制独占资源或延长寿命。

类型/名义/相等/捕获资格错误先沿原诊断；缺依据保持Need，不当作“不相等”。原比较或构造未完成、Fault、取消和资源不足不能发布空/部分集合冒充成功，也不暗加业务None。未来input只形成有型表达式，不在编译期执行；设计时固定值也只在原阶段资格下求值。FromSequenceWith的参照最多比较n(n−1)/2次并保存至多n个代表，另计真实元素/比较/结果成本；Union同样不承诺零分配或免费共享。哈希优化需额外一致哈希及碰撞复核，不能反向要求只需equal的作者提供hash。

**有限构造证明。**处理前i项后的代表无重复E类，每个代表来自前i项，且前i项各有相等代表。空前缀成立，已有类/新类两分支保持，有限结束后得到准确成员集合。Union的成员析取直接给单位/交换/结合/幂等律；在纯总有限资格下，可对集合推导的限定项结构归纳，使其每一步贡献取并，得到准确外延。这里证明结果含义和条件性数学终止，不证明生产实现/资源或错误次序；FoldMap的资格条件仍逐项保持。

集合贡献、空与并的组合有成熟研究基础，但代数结构本身不保证高效join，见[Gibbons原论文](https://www.cs.ox.ac.uk/jeremy.gibbons/publications/ringads.pdf)。有限归纳及并/筛选/像通过交换更新折叠的证明可核[Isabelle Finite_Set](https://www.isabelle.in.tum.de/library/HOL/HOL/Finite_Set.html)的finite_induct、union_fold_insert、Set_filter_fold和image_fold_insert。本文给Gift的具体前提与源接合，没有运行这些证明系统或借它们代签native资格与作者成本。

有限集合折叠沿交换、结合运算取得顺序无关结果，是已有数学结构，不是新排班能力目录。mathlib明确给出Finset.fold的这两项前提与空集/插入定律；本画像另明确单位元和实际回调/值资格。[mathlib Finset.fold](https://leanprover-community.github.io/mathlib4_docs/Mathlib/Data/Finset/Fold.html)。本仓库未运行Lean证明或安装该库。
