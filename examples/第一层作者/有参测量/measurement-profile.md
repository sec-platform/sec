# 峰值分钟测量：定义、单位与有限证明

## 实际峰值源码与三次FoldMap

`peak-workload.module.json`准确导入已提交 `module:scheduling-policy/Dataset`、原`module:confirmation-session/Content`及上述新普通供给。9个Definition如下：

| 定义 | 实际计算/角色 |
| --- | --- |
| JoinAny | Bool或，empty=false；私有组合解释，不创建新通用API |
| JoinMaximum | Option<Int>：None为单位，Some按std:IntCompare选大值；支持负数，不把0当所有整数max的单位 |
| Assigned | 对原Content Set FoldMap；project直接检查person/shift两字段的精确Int相等 |
| PersonWorkload | 对Dataset.shifts FoldMap；实际分配给该person的班次投影为end-start，否则0，combine使用已有std:IntAdd |
| PeakOptional | 对Dataset.people FoldMap；每人投影Some(PersonWorkload)，以None/JoinMaximum聚合 |
| PeakOrZero | None明确返回0、Some返回其值的**显式total extension**；不是声明数学空集max=0 |
| Minutes | 真实直接名义record `{count:Int}`，没有伪Quantity构造 |
| PeakMinutesValue | 实际将PeakOrZero结果包装为Minutes record，body非空且可逐构造核对 |
| PeakMinutes | category:measurement，准确参数Dataset/Content、result为同一Minutes名义类型、interpretationRef为真实PeakMinutesValue |

函数均有实际完整body。只使用当前已固定的std:IntEq/IntCompare/IntAdd/IntSub、已有match/Option/if/lambda/call/record/field语义，没有隐藏业务measurement、未定义标准库或排班阶段程序。Pair/Shift未导出名字不被伪引用；投影沿公开Dataset/Content的实际可见元素型与原表示权限检查。

嵌套lambda的自由值只有当前person/content/dataset及真实shift。新binder不进入自身来源；回调不逃逸，因此普通不可变捕获与借用寿命由原checker分析，不加captures:[]假装无捕获。新native header的effects=[]、回调noescape及条件终止需由profile适配保持，`.d.ts`自身不能表达或证明这些Gift资格。

## profile:integer-minutes-measurement:1：真实单位与比较解释

这份有限measurement profile与源码一起被原专业解释/Method/Lock闭包固定，其名义结果类型是本次ModuleUse实际解析的 `module:schedule-workload-measurement/Minutes` Declaration，不能只按名字Minutes识别。相同形状的另一个record没有此单位资格。

- `Minutes{count:n}`表示准确的数学整数分钟，1分钟=60 SI秒；它是带该明确单位解释的名义数值包装，不是核心`Type.quantity`，更不把Int直接强转成Quantity。未来若要与Quantity互通，另给真实无损转换/单位保持；本稿不造std转换或空桥函数。
- Source Dataset的shift.start/end本来由排班profile固定为同一时间轴上的精确分钟。相减得到该班持续分钟；不与确认响应的Session纳秒读数比较，不把日历月份、UTC时刻或同名数字混入。若输入time-axis/单位不同，先有明确转换及同域依据，否则Need/错误。
- 数值序由count的精确Int序定义，投影count完全、无舍入、严格保序；比较两个合格同单位结果没有误差或样本不确定性。不是JSON字段排序、字符串排序或隐式取record第一字段。single-objective minimize可用这个既定序；若未来加权，仍须原无量纲loss/权重合同，不能直接相加分钟和其他单位。
- `PeakOptional`对空People得None；`PeakOrZero`对空People显式取0。**峰值测量在硬DatasetWellFormed下使用**，其中People非空，故None/0分支不可达，结果恰为原数学max。这个total extension避免部分投影，但不为无效Dataset创造合法峰值/可行候选；偏好比较前仍先核全部硬要求。
- 纯数学结果不声称实际测得员工出勤或真实时长；Dataset是同一候选/会话接受的固定资料，计划值与现实事实资格分开。当前测量闭包无实时Observation依赖，不需要虚构measurementAuthorityRef；若混入现实测量/校准，再沿原资格取得。
- 该profile的捕获与类型/单位/比较qualification是必要依赖，不因record/measurement Schema通过自动成立。缺失为NeedsUnitInterpretation/QualityOrder；尚未实现的专业consumer/adapter不得冒称已执行。

## 有限证明与必要反例

FoldMap对任一枚举的左折叠等于该多项组合；交换相邻两个投影用结合/交换律不改变结果，有限置换由相邻交换组成，因此所有完整无重枚举结果相同。空枚举由单位给出。该证明不提供遍历器本身已完整、回调已合格或运行资源足够的事实。

三组代数具体成立：Bool或/false，精确Int加法/0，Option<Int>最大值/None。最后一组对应“无元素或当前全部Some值的最大值”，对负数同样成立。它们的源码没有回调外部作用；每个实际回调只调用更小层有限FoldMap与已固定精确运算，所以按有限层/有限集合大小可给正常域总性。值资格/实际native实现仍单独取得。

Assigned为true恰当原Pair集合存在(p,s)。PersonWorkload遍历每个真实Shift一次，已分配者恰贡献该正时长；DatasetWellFormed的唯一shift.id保证不重复计同班。不同班的相等时长仍分别贡献，不能对投影数值去重。PeakOptional再逐人取最大；People非空使其为Some，外包装保持准确分钟。

判别向量：空Set sum=0/maximum=None；单元素；全负数maximum正确；两个不同班各240分钟给480而非240；两个相邻班一人各上得到480、分给两人峰值240；无班次但People非空峰值0；People空只得extension值，硬候选拒绝；重复carrier在typed Set解码层拒绝；丢成员/不完整前缀不能作为Set；非交换combine或effectful/未证明total回调不能取得该FoldMap资格；非常大Int保持精确，不落binary64。


该准确profile与[源码](peak-workload.module.json)共同由[工程](../measurement.project.json)捕获；profile身份不自签已安装消费者或执行能力。[有限Set供给](../有限集合聚合/README.md)承担FoldMap的完整解释及Native资格，当前仅交付设计声明。
