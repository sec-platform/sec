# 集合值：形成、嵌套与修改

[工程入口](../set-values.project.json)捕获[实际模块](sets.module.json)、原序列模块及[有限集合供给](../有限集合聚合/README.md)。这是可复用表达形成的完整源设计，没有可执行Target；生产Reader、native实现与目标资格仍未取得。

开发者的三个决定可以写为以下中文设计记法；其准确有型形成规则由[原作者owner](../../../docs/作者/紧凑结构与同源编辑.md#set-value-formation)拥有：

```text
UniqueNonzeroCount(items) = 数量({x | x 属于序列 items，x ≠ 0})
NonzeroFromSet(items)     = {x | x 属于集合 items，x ≠ 0}
MixedDistinct(groups)    = {group.bias + x |
                            group 属于序列 groups，
                            x 属于集合 group.values，x ≠ 0}
```

这三行决定来源、过滤、投影和结果用途。普通开发者不再决定去重循环、底层容器、Set遍历次序或每次提供Int比较器。当前它们是设计记法，全文中文前端未实现；持久源已经给出精确普通Expr，能够由现有结构codec读取/展开，不冒称三个中文围栏可直接编译运行。

## 三种实际组合

UniqueNonzeroCount的完整表达在FoldMap的Set实参处直接嵌套FromSequenceWith。它先由真实`sequence:Collect`保序保重地取得所有非零出现，再用`std:IntEq`去重，最后以IntAdd和投影1计成员数；没有给中间集合另设阶段函数。对`[0,1,1,2]`结果为2，序列的两次1没有被提前丢掉；Set才只含一个1。

NonzeroFromSet直接把已有Set交给`sets:FoldMap`，其结果类型M也是Set<Int>。每个非零输入贡献单项Set，零贡献空Set，UnionWith组合贡献；不通过Collect接Set或凭一个底层顺序把Set当序列。这个返回Set的表达同样可嵌入别的Set实参或纯Formula值槽。

MixedDistinct外层调用真实`sequence:FoldLeft(items,seed,step)`，内层FoldMap的来源是当前group.values，其投影读取同一个group.bias。域依赖和词法作用域保留，不能把内层域提到外层之前或交换binder。对于`[{bias:10,values:{0,1,2}},{bias:11,values:{0,1}}]`，结果为`{11,12}`：两条不同路径投影到12后只保留一个成员。源码的匿名闭record参数有明确字段型，名义/opaque的一般规则没有因本例而被放宽。

实际source只引用同一模块捕获中的普通声明与原精确Int原语；FromSequenceWith/UnionWith来自修订2，FoldMap原义保持，IntEq实现精确Int相等。输出Set的同类代表在普通Int观察中可替代。泛型或opaque的新使用必须另外取得其原相等/普通值资格，不能拿本例的Int PASS签任意T。

## 一次真实修改

应用[include-zero.json](changes/include-zero.json)先检验UniqueNonzeroCount里完整过滤if的前像，再仅把该函数的贡献改为单项`[x]`。新含义是`数量({x | x属于items})`，`[0,1,1,2]`从2变3。来源、Int相等、Set构造和计数方式保持；另外两个定义不变。此补丁没有改变共同库或把过滤政策藏进比较器。

## 有限证明与验证边界

序列参照先完成全部元素投影，再开始去重；每个前缀的代表恰覆盖该前缀所有相等类且无重复，所以得到准确Set。Set来源及混合来源按原限定项次序把贡献取并；并的空单位、结合、交换和幂等保持全部合法产生值，消去结果重数，故上述三个表达等于相应数学集合。空输入得到空Set/计数0，零过滤为假才排除，未知不补false。

结果证明以有限完整值、纯且有定义/所需终止的计算及准确相等为前提；不能由结果相等重排错误/取消或宣称内存相同。相等的重复项若其上游计算失败，不能因为预计会去重便跳过它。当前声明没有实现body，模型检查只检查本例Expr及有限假设，不发行native适配、真实类型/私有访问、相等定理或资源资格。

新增的两个供给各补一个实际缺边：FromSequenceWith形成空/单项及序列投影结果，UnionWith让一般Set结果成为FoldMap的交换组合对象。当前普通公开接口中没有仅凭任意合法equal就能消去后一项的已有函数；不能用FoldMap与尚未定义的Union循环证明它存在。这里不宣称全语言的全局最小性；作者决定点、库首次定义成本、系统生成/维护成本与真人使用收益仍分别核算。
