# Graph-It-Live Runtime Evidence 实施计划（历史）

> 状态：historical。本文不再维护旧文件清单、测试命令或完成状态。

## 历史目标

把 Graph-It-Live 查询结果归一为只读 Evidence，并投影进 Context Packet；证明 related files 不会扩大 Task Envelope 写权限。

## 保留的不变量

```text
writeBounds = TaskEnvelope authority
runtimeEvidence = read-only context
```

任何 provider 的 `relatedFiles`、call hints、impact hints 都不能进入 `allowedPaths`。

## 当前权威

实现与未来演进以 `docs/09-AI Runtime、任务信封与治理规范.md`、`docs/11-Workbench与可视化规范.md` 和 `docs/14-Engineering IR与语义事实规范.md` 为准。
