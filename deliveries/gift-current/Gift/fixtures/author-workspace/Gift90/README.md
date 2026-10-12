# Gift 90 多表示作者工程范本（设计验证载荷）（历史研究说明）

- `structure-first/`: 两份结构化 `*.module.json` 作者源码，一个工程清单，没有 `.gift` 或原生业务文件；演示模块导出、工作区导入、参数默认、有限静态条件 `when` 与复合 `use`，条件真/假分别显式指定五次尝试或继承基础模块的三次默认；这是*设计期选择*，不代表运行时重试已实现，不声称具备实际 IDE 行为。
- `native-existing/`: `src/editor.ts` 是唯一函数实现源；结构模块只承载独立的设计要求壳，**不复制 TypeScript 函数 AST**。`package.json`、`tsconfig.json` 保持生态自身所有权；固定示例编译器版本仅用于说明可复核的原生工程，不代表 Gift 已绑定或重锁 npm 依赖。空 `targets` 只表示本设计包没有要求生成目标。
- `draft-contracts/`: 两份 JSON Schema 草案，仅校验共同外壳、工程清单和有限 `req:composite` 的**结构形态**。`req:rule` 等其他 dialect body 需各自真实规范；`ModuleUse`、导入公开性、身份、类型、default、sourceScopes 路径、安全、绑定锁、运行与实际编译必须由语义层检查，不能用 Schema 通过冒称产品合格。
- **没有 `gift.lock.json`**：此处没有真实解释器、内容获取、目标绑定或供应资格。伪造一个锁以凑齐示例反而违反工程原则。
- 原范本不宣称已被不存在的 Gift 产品读取器编译、生成或部署；静态 JSON 与文件路径检验只覆盖其明确声明的部分。

对应规范：`docs/10-作者与输入/作者源/工程源/统一源码工程与多表示作者协议.md`。
