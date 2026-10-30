# 有参测量：从指定偏好到修改比较依据

本工程交付同一Goal下的硬要求、质量偏好与真实测量输入的接合设计。作者选的是“对哪些资料、哪份候选比较什么”，不编排搜索、遍历、预览或发布阶段。[实际作者模块](choice.module.json)与[工程入口](../measurement.project.json)可逐项核对；当前没有配置可执行Target，也没有声称已生成建议界面或安装优化器。

## 新建与使用

`SuggestSchedule`保留两个公开角色：`dataset:Dataset`和`candidate:Content`。前者在本次比较中固定，后者是该任务允许选择的候选安排。硬条款复用`ScheduleFeasible`；软条款如下，作为该Goal的一个命名clause：

```json
{"lowerPeak":{"prefer":{
  "qualityRef":"local:BalancedWorkload",
  "direction":"minimize",
  "metricArguments":{"peak":{
    "dataset":{"binding":"dataset"},
    "content":{"binding":"candidate"}
  }}
}}}
```

`peak`是Quality内稳定项标识，该项的`metricRef`指向有真实参数和解释的`PeakMinutes`；里面的`dataset/content`是测量形参，右侧binding是本次Goal角色。角色同型或同名不替作者决定数据来源。精确采用仍沿原Goal/Requirement的角色绑定与专业任务取得；这份模块定义本身不启动搜索。

已有的`BalancedWorkload`可复用，应用作者不必重写峰值算法。首次定义这种尚无现成含义的指标时，仍需固定其含义；[测量模块](peak-workload.module.json)给出完整实现见证，[单位与证明](measurement-profile.md)说明精确分钟和聚合解释。这里九个辅助定义属于可复用的测量定义，不是每个应用作者必须重复书写的第一层模板。它们说明实现责任没有被隐藏掉，不证明总作者工作量已经降低；没有现成知识时需要提供的那部分信息仍需实测。

## 组合与修改

`CompareBasis`同时接收同型`primary`、`backup`和一个`candidate`，硬域要求候选在两份资料下都可行；初始偏好选择primary。[修改补丁](changes/use-backup.json)先检验原Quality及原绑定，再仅将`peak.dataset`改为backup。两份资料都保留，硬域不变；这是修改观察/比较依据，不是换一种业务语言或把结果直接写入metric。

两人和三个依次相接的班次，所有人可到场。primary的三段时长为5、4、1分钟，backup为5、1、4分钟；每份资料的开始/结束点按自身时长累积。安排A将前两班交给甲、第三班交给乙，安排B将第一和第三班交给甲、第二班交给乙。两安排在两资料下都硬合格：primary的峰值为A=9、B=6，backup为A=6、B=9。因此改变这个绑定会反转偏好，不能按类型、名字或默认数据源删去它。仅对角色作一致alpha改名则不改变结果。

一次比较固定其资料、单位、解释与合法域，候选位置才随被比较安排改变。测量参数缺失、未知term/形参、越域绑定或类型/Subject不符均不能静默修复。短写中的`value`沿原纯Expr展开；普通literal内容不会因长得像表达式就变成代码。多处采用分别解释各自实际参数，不共享隐含上下文。

## 有限实现见证与边界

若People有p个、Shift有s个且资料合格，每班选一人的候选至多p^s个。存在可行安排时可枚举这些候选，用现有硬关系筛选，再以真实PeakMinutes择最小值；有限域保证最小值存在，多个最小值保持开放。无可行候选时报告冲突，不能删班取得成功。此构造只证明这个有限任务有实现见证，不保证可接受的时间/空间，不构成通用自动综合或已经交付优化器。

用户已经给定的合格安排仍沿[排班发布](../排班发布/README.md)的确认合同处理，不因还有更优安排而被拒绝或偷换。采用本建议Goal是另一项明确选择；本次未改发布组件和确认观察源，也未自动把建议Root接入它们。

有限Set聚合复用[普通FoldMap供给设计](../有限集合聚合/README.md)，新增的是一个代数供给及必要的参数接合，没有新增排班关键字或三种聚合专用操作。遍历顺序可被消去的理由是具体交换、结合与单位定律；非交换、作用性或不完整输入不能借该供给取得相同资格。

设计已给出准确语法、实际模块、修改及有限证明。生产Reader/类型与来源资格检查、单位/profile消费者、FoldMap执行适配、优化Method、目标代码生成及真实运行尚未实现；数学模型、Schema或TS声明检查不证明这些层已完成。真实作者成本及陌生领域复用仍需独立任务验证。规范语义由[有型测量实参](../../../docs/作者/需求含义与实现责任.md#parameterized-quality-measurement)拥有。
