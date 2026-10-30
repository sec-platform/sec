# 只改变指定位置：一般定义、采用与再次修改

作者在某次操作或事件的明确边界上写“只改变S”；边界、同次前后态、位置类型和等价含义从该处已有合同取得。作者只补不可由上下文决定的位置选择，不必填写采集器、状态遍历、锁或比较器。[准确语言含义](../../../docs/作者/需求含义与实现责任.md#controlled-state-frame)拥有这个短写；本例给出它到已有结构的完整映射。

[frame.module.json](frame.module.json)用原Meaning、Formula和Goal定义：

```text
ValueFrame(cut,allowed) =
  每个 position 属于 ProtectedPositions(cut,allowed)：
    UnchangedAt(cut,position)
```

保护域准确为完整两态联合位置域减去allowed。位置的值可以异型；每个位置用其原类型解释比较，不提供Any值或按字段名字猜类型。新增、删除和生命周期代都在位置解释中保留。完整[supply/frame-profile.md](supply/frame-profile.md)、[原生声明](supply/frame.d.ts)和[选择](supply/frame.selection.json)固定三个供给函数的含义。声明不等于采集器或方法已经实现。

[frame.project.json](../frame.project.json)是这套可复用作者定义的实际工程入口，没有可执行Target。OwnCellsFrame只是在该定义之上选择当前receiver真实声明的cell；动态或异类位置仍使用同一ValueFrame和同一位置协议。合格领域观察可以给出其准确边界，缺边界时保留缺项，不能默认所有堆、所有可读字段或空域。

## 在现有工程采用

[共享资料工程](../完整作者工程.md)的ThresholdView.read原已通过同次threshold before/after相等保持本地帧。本例不把它重新报为缺陷。以下是可选的保义迁移：

1. 对原[workspace.module.json](../共享资料工程/workspace.module.json)应用[adopt-workspace.json](changes/adopt-workspace.json)：先检验准确旧imports、旧帧采用及观察成员，再导入frames、增加ownFrame观察，并用OwnCellsFrame代替这一个具名帧采用。其他read关系、接口效果、callFacts及其他组件保持。
2. 同次作者修订对[shared-views.project.json](../shared-views.project.json)应用[adopt-project.json](changes/adopt-project.json)：捕获本模块/声明/完整解释，将原Target的设计画像从修订1改为[修订2](target-profile-v2.md)。两个文件的变化共同接受；单文件中间草稿不算已形成可生成的后继。

具体采用如下；cut来自同次正常完成的实际观察，allowedNames是本次唯一的位置选择：

```json
{
  "ref":"frames:OwnCellsFrame",
  "roleBindings":{"allowedNames":{"source":"literal","typeRef":"frames:CellNames","value":[]}},
  "callBinding":{"at":"success","roles":{
    "cut":{"source":"observation","when":"after","useId":"ownFrame"}
  }}
}
```

本例边界只有当前视图的threshold；空允许集恰要求它保持原Int值，等同原具名等式。观察不读取Store、另一个视图或其他receiver的私有状态。它提供保留的同次基础，不能事后拼两份方便的快照。

## 再修改同一要求

对迁移后的workspace应用[allow-threshold.json](changes/allow-threshold.json)，先检验原采用和空允许集，再把它改成`["threshold"]`。其他状态、对象和独立要求不变。

这只是撤去本条对threshold的值保持要求，不强迫它改变，也不增加state-write效果、写权限或Grant。原read仅允许的state-read/alloc仍保留。若另一个独立合同也保持threshold，本处放开不会撤销它。同一边界的两项帧允许集取交；取并会把一个合同禁止的变化悄悄放过。

有限已知cell可以完全展开成本来的有型等式，无须新供给；本例显式展示了这种消去关系。一般动态位置通过完整联合域保留新增/删除，逐位置解释保留异型值；未知覆盖、错误生命周期、跨调用/实例、私有访问不足及缺比较资格分别报告，不能当false、空域或成功。允许集内的值不需要为这条帧取得无关的比较方法。

已给出的是准确作者源、完整专业含义、保义迁移与后继补丁。生产Reader、Cut采集/证明与native适配、权限/类型检查和目标运行未实现；有限数学检查不代签这些层。观察成本也不默认为零。没有修改原共享工程的当前默认源码，补丁是明确的可采用后继，避免同时维护两份Workspace。
