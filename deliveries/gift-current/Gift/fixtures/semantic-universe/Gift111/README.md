# Gift111：通用计算语言核心的有限计算参考说明（历史研究说明）

原实验记录过**严格 JSON 作者模块 → 名称/类型与契约检查 → 直接生成 TypeScript → 原生 `tsc --strict` → Node 执行**的局部闭环。没有通过行业名或函数名选择业务模板。它与整个 Gift 生产 Kernel 并不等同：实现语言是 Python（独立参考编译器与求值器），输出为 TypeScript，尚未连接产品 Rust Kernel。

## 原实验环境与调用边界

前提：Python 3.11+（只用标准库）；目标编译和执行另需本机 Node.js、TypeScript `tsc`。原程序在对应完整实验包中引用 `fixtures/prebootstrap/Gift107` 与 `Gift110` 的原始 JSON；原单独实验 ZIP 曾另附 `examples` 副本；当前设计包未附该运行闭包。

原 CLI 区分 check、build-ts 和 invoke；其输入不依赖 shell 展开 `*.json`。`--out` 拒绝覆盖已有目录，避免用户源码被生成器覆盖；CLI 不读取网络、凭据或执行现实 Provider。

## 原实验的有限能力与前提

- `gift.author-module/1` + `gift.semantic-body/1`：严格 JSON 读取、重复键拒绝、未配语义字段拒绝、模块身份、工作区导入/公开导出、名义记录/和类型。
- 显式类型、精确 `Int`（Python 任意整数，TS `bigint`）、`Bool`、`Text`、`Unit`、List、匿名记录及函数类型；TypeParameter 的刚性类型检查、每次调用的新鲜实例、简单本地统一与 occurs check。
- 变量引用与词法作用域、递归/互递归、函数值、lambda、let、条件、短路、List Nil/Cons、名义和模式匹配、不可变记录更新、前后条件（checked 运行时入口）。
- 缺实现的声明可通过 `check` 保存；发射可执行目标时必须有显式同签名 Method 供应，否则 `NEEDS_IMPLEMENTATION`，不会生成假函数。候选方法的额外输入前提无独立证明时拒绝。
- 类型化 TS 目标源码含原生函数/类型声明与实际构造器、跨模块导入、完整静态构建项目；**不会在生成 TS 时塞一份 AST 解释器假装已经 Lowering**。通过类型检查且在约定的纯输入域内可以执行。
- 独立 Python 解释器验证求值顺序/短路/ADT/合同；负例覆盖坏源码、坏字面量、未绑定变量、缺模式分支、假效果、非法方法和缺实现；固定输入得到稳定输出摘要。

## 明确尚未实现（不能称为“所有通用功能已经实现”）

- Rust 生产内核、真实 SourceSpan/CST 增量编辑、类型高级画像（高级类型构造、资源借用/生命周期、trait/约束多态）、部分 ADT 构造/泛型构造、nested pattern 完备矩阵算法、匿名函数效果多态。
- `Option/Result` **具有类型表示但尚无完整构造/消解表达式机制**；非空效果行与真实外部状态/持久化/并发/IO 均明确拒绝；未实现时序/概率/数值求解等领域解释器。
- 自动算法合成、证明任意前后条件、性能最优选型、完整需求逻辑求解、独立方法资格和 Rust Target。
- JavaScript 本机边界尚缺对全部外部输入的深度解码/冻结；JSON SourceMap 的精确字节范围、专门 IR/跨目标合法化器、尾递归优化尚未实现。List tail 用 `.slice`，深递归可能栈溢出，某些列表算法为二次复制；**不可将原参考 Target 宣称为具有高质量资源保证的生产后端**。
- Method 的同型候选仍需外部证明或运行检查；原实验包只对当前普通 `requires/ensures` 进行 checked 入口处理，运行抽样不证明全域正确、终止或可靠性。

## 原实验覆盖的样例

原样复用 Gift107 `Division / quotRemExact / quotRem / occurs / occursIn / partitionBy / identity / compose / consumer`，Gift110 `spanWhile / splitInitialRun`；另增完全未知于核心的 `Signal` 和 `Vector.shiftX` 两个领域模块。共八个模块、17 个定义、12 个实际函数主体、1 个合同委派绑定。可将任意同构语义模块加入 `demo.py` 的输入集合，无需新增行业分支。

独立脚本和测试不写远程仓库，也不宣称原有所有 Gift 合同已由原参考实现消费。原记录指向 `Gift111-qualification.json` 作为实验资格材料；该文件不随本设计包提供，本文不重签其结果。
