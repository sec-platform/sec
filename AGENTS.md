# SEC 仓库开发入口

本文件只负责启动和行为路由，不拥有产品架构、测试矩阵、当前状态或完整执行状态机。

1. 以最新 `main`、开放 PR/Issue、CI、Review 和真实 diff 建立事实；branch、PR body、Issue、聊天和报告不能证明完成。
2. 由 `sec-repository-orientation` 绑定受信 latest default/base resolver，并把 intended workspace 保持为候选解析目标；结果为 `unresolved` 或 `invalid` 时停止写入。
3. 只在所选 frozen Work Package 的 owned/forbidden paths、acceptance、tests 和资源边界内工作。
4. 从 `.agents/skills/**` 选择一个主 Skill；trigger、权限、工具、执行、停止与恢复只由该 Skill 拥有。
5. 产品与架构读取 `docs/authority.json` 指向的唯一领域 owner；动态选择只读取 `docs/work/**`。
6. 影响分析先使用 capability ledger 与当前 Capsule 已批准且可调用的能力；不可用时按 `sec-impact-and-validation` 降级到 exact imports、consumer 与 test-impact census，禁止临时安装工具或重建索引。
7. Worker 不自授权扩大 scope、触发 hosted Gate 或 merge；A0 负责 DAG、integration、Gate custody、merge、readback 与清理。
8. Squash merge 后按新 `main` tree、实际实现和 Evidence 判断结果，不按旧 commit ancestry、分支名或 ahead/behind 判断。
9. 失败先定位 root cause、owner、invariant 与失效 Evidence；输入和 failure tail 未变时复用失败，只重跑被 delta 影响的最小验证。
10. 机器可观察的规则必须由类型、Schema、parser、validator、test、Hook 或 CI 拒绝；只写在 prose 中的比例、次数和口号不是硬门禁。
