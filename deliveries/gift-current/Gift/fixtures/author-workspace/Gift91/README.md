# Gift 91 — 完整逐文件作者源码工程范本（历史研究说明）

目录：
- `01-structured-design` — 只使用结构化 JSON 的完整多模块**源码形态**（工程设计/复用定义）；没有自动提供 IDE 实现。
- `02-native-mixed` — 真正原生 TypeScript 文件与独立 Gift 结构源**无重复写权**的混合工程。
- `03-native-rust` — 原生 Rust/Cargo 源码与独立结构设计组合，展示字节/UTF-16 文本语义不能无证据互换。
- `reference` — 八种 RequirementTerm 真实 JSON 形状与尚缺真实绑定的规则；锁、目标、控制的正确缺席条件。

原完整案例曾以独立 JSON 文件保存作者内容；`gift.project.json` 是目录定位，`design/*.module.json` 是作者 Definition，TypeScript 保留算法实现，`package.json` 属于 npm，资源属原生应用。使用者不用手写一份 AST 镜像。

**边界提示**：Gift 90 的项目/Requirement `/1` 尚未有正式产品级 Codec/Rule/Target 实现。原实验包对明确的有限结构形态提供静态检查，不声称 Gift Compiler 已经接受、运行或发布这些源码。纯结构模块内空 `req:composite.terms` 并不会满足 IDE 运行要求；实际业务 Rule 必须具有观察、正常/失败/帧/进展、实现、证据合同。
