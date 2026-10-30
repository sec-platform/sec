# 有限集合聚合：普通供给设计

## profile:finite-set-fold-map:1 的完整有限合同

该设计profile与实际 `.d.ts` / selection 一起定义新普通供给，沿原native SourceScope、真实Compiler Header、ModuleUse/Profile/Lock固定准确字节。FoldMap是唯一公开符号；声明显式export {}，private FiniteSet及finiteSetView不作为选择出口。真实TS Compiler API仍需核这一事实，文件文本不代签parser结果。

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


[真实原生声明](supply/finite-set.d.ts)及[选择](supply/finite-set.selection.json)固定唯一出口。声明不是执行实现；完整输入、代数及值资格在上文给出。当前消费者见[有参峰值测量](../有参测量/README.md)。

有限集合折叠沿交换、结合运算取得顺序无关结果，是已有数学结构，不是新排班能力目录。mathlib明确给出Finset.fold的这两项前提与空集/插入定律；本画像另明确单位元和实际回调/值资格。[mathlib Finset.fold](https://leanprover-community.github.io/mathlib4_docs/Mathlib/Data/Finset/Fold.html)。本仓库未运行Lean证明或安装该库。
