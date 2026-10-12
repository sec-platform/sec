# Gift117：从业务意图直接降低成 TypeScript 业务源码的有限参考（历史研究说明）

本文记录原 Gift117 实验消费者，不改变 Gift112 的 JSON 作者格式，不建立第二套工作集，也不修改 Gift116 的历史参考代码。它解决了 Gift116 只复制 `runtime.ts`、在运行时解释全部业务 JSON 的一个具体缺口：**编译时解释 Meaning/Method 的结构，静态生成面向该次实验业务的观察、前提和状态变换源码**。

原实验入口条件：

目标工程中 `src/logic.ts` **是随具体业务 JSON 改变的生成源码**。例如已批准文档的目标生成 `.fields["published"]=true`；容量方法生成对 `reserved` 的 BigInt 变更，两个领域用同一 lowering 逻辑编译。`src/main.ts` 仍然是通用的本地 SQLite/有限搜索基础设施；`contract.json` 是锁定的派生产物。这里只编译了原有 `finite-model-expression` 的一部分运算和 `set/addInt` 效果，没有声称生成真实行业系统。

`--capabilities` 不是 AI 根据字段名字猜执行权：由明确提供的 **有限本地模型写入能力**声明指定对象类型、可写字段和守卫。只允许 `Bool` 的 `setBool`，仅从 `achieve` 中明确 `field == literalBool` 的目标导出方法；不满足这些前提或没有写入资格，返回 `NeedsImplementation`。没有守卫时编译器不会自动知道“必须已审核”；原实验目录的文档写入能力显式要求 `meaning:doc-approved`，未批准的输入不得发布。此处的 `capabilities` **完全不是现实世界 Grant**。

三个不能混淆的边界：

- 表达一个新业务概念 ≠ 获得它的事实、可用方法或执行权限。
- 将已提供的业务方法编译成专用源码 ≠ 在没有方法的情况下发明任意算法。
- 严格 `tsc`、本地 SQLite 和有限对照通过 ≠ 外部业务行为、长期性质、独立安全认证已成立。

完整根问题的剩余实现与反例见 [第27施工章节](../../../docs/70-工程系统与演进/工程构造手册/27-业务语义直接降低与有限合成.md)。
