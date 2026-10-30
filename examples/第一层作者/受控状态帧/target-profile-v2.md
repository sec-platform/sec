# profile:shared-views-typescript-library，设计修订2

本修订准确继承[修订1](../共享资料工程/supply/target-design-profile.md)的Workspace根、公开构造与六操作、输入/错误/Effect/进展、输出布局和构建责任。它只对应本目录两个adopt补丁共同形成的后继；不是新的Target Provider或已取得执行资格。原修订1及未采用补丁的工程保持原义。

修订2增加ThresholdView.read正常成功后OwnStateObservation的真实对应。对该次receiver和该次read，保留入口/成功完成的准确threshold状态、其Int解释、完整own-state边界和同一次调用身份；交付的FrameCut必须符合[supply/frame-profile.md](supply/frame-profile.md)。其域恰是该receiver的own state，不穿透共享Store或另一个视图。源操作增删cell时，观察边界和资格随真实声明变更，不能沿用旧的单字段缓存而漏掉新成员。

原Method可按有型静态证明、准确保留观察或满足相同合同的方式取得帧关系，不强制每次复制全堆或增加外部IO。ObserveCut的恒等body不负责采集，也不把Type品牌当来源。实际适配须保持私有权限、同次相位、生命周期、完整位置域、位置相等和所需逐位置比较；缺方法则保留对应Need。原state-read/alloc效果不因观察要求获得写入权限，新增观察/证明的成本按原预算和正常完成合同计算，不能视为免费。

迁移前后在原threshold边界上的成功行为保持：空allowedNames使ValueFrame恰为原before/after Int等式。进一步采用allow-threshold补丁只放宽该条值保持；接口效果、独立要求、错误/取消及原目标承诺继续存在。目标不得把后态中实际改过的位置反填为allowedNames来制造通过。

真实生成仍需完整源、合格供给/工具链、目标降低、构建和运行证据。本设计未交付这些实现，也未声称真实采集或运行通过。
