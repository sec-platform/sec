# SEC 约束思想执行计划（阶段 0–5）

> 来源：`C:/Users/QzCrane/Downloads/AI开发中的约束思想_2026_08_03__2256.md`（2026-08-03 导出）。
> 本文件是当前执行路线在仓库内的唯一状态源；后续重算只由真实 `reload_if` 或用户修正触发。

## 0. 已核验事实（2026-08-03）

- live `main` = 本地 `main` = `6cc3bf8a3b655bebf85dfca3f065c9842207c086`，主 worktree 干净。
- 当前唯一 formal Work Package：`verification-artifact-claim-summary-v1`（Issue #217 / PR #227），在 `D:/Project/sec-worktrees/pr227`。
- 本地 #227 候选已超越 GitHub head `93bd688`：存在本地 commit `5eb95a58` 与未提交 proof-reset delta（`dev-runner-authority-proof` 有限内核、authority-free 纯调度 seam、file-local executor）。本地 frozen manifest 是当前 authority，旧 PR body 的 9 文件清单已过时。
- 计划原述的“缺陷一/缺陷二/业务特化/force-push publisher/候选 Draft 清单”在 main 上仍成立；#215 aggregate 语义仍属于 Issue #215，不由 #217 提前实现。

## 1. 阶段 0：冻结候选栈（当前状态：进行中，随 #227 控制面交接生效）

- `#234/#240/#242/#250/#253/#254/#236/#243/#241/#260` 保持 Draft，不再推送新 commit，作为设计来源冻结。
- 不再创建新的 Verification/Agent-governance/docs 治理分支；新研究只进 Issue 与 Evidence。
- 只有 #227（`verification-artifact-claim-summary-v1`）允许继续推进。

## 2. 阶段 1A：完成并合并 #227

按本地 frozen manifest 的退出顺序执行，不沿用旧 PR body 的门禁：

1. 两文件 finite-kernel proof-reset focused（`tests/unit/dev-runner-authority-proof.test.ts`、`tests/contract/dev-runner-contract.test.ts`）。
2. `bun run imports:freeze`，然后 Product/Runner 双 exact-tree 独立 Review 零 finding。
3. 全十二文件 manifest focused batch。
4. 冻结 single-parent head 后：一次 affected plan/run、Risk、`bun run typecheck`、`bun run docs:doctor`、`bun run audit:repository`。
5. 独立 exact-head Review + trusted-base bootstrap（本包修改 verifier/test-fixture/dev-runner trust root，不允许候选自证）。
6. hosted Quick（`sec-verify-frozen-v1` quick）→ expected-head squash merge → new-main readback → 关闭 Issue #217。

## 3. 阶段 1B：从新 main 重建 Issue #215（四个独立 WP）

每个 change 独立冻结 WP、验证、Review、merge、readback；不沿用旧 stacked head `4d28c84`：

1. `fix/verification-aggregate-lattice-v1`：owning-environment-aware、顺序无关 lattice、duplicate rejection、proof identity、空 claims/无测试真值 fail-closed。
2. `feat/verification-acceptance-coverage-v1`：物理测试路径 → 语义 acceptance ID 的唯一 machine contract；缺失/重复/未知路径与环 fail-closed；artifact 读回重算。
3. `fix/verification-writer-profile-v1`：writer/profile/artifact 同步；no-policy not-applicable 不入 aggregate；full-runtime 非空执行清单与 command identity；blocked snapshot 与物理失败分离。
4. `fix/semantic-mutation-classification-v1`：isolated runner 拆 core + wrapper；nonzero exit + `invalidated/unsupported/not-run` → blocked，仅 canonical `failed` + nonzero → failed。

完成后关闭旧 PR #234 与 Issue #215；#240/#242 继续冻结到 1B-4 readback 之后。

## 4. 阶段 2：收口安全与工程事实（顺序执行）

1. 从 live resolver 重算 `docs/work/**`；归档失效 manifest；移除已关闭 #232/#233 引用。
2. 最小 owner 修正（仅 Target/Runtime Profile 与 Mutation rollback/Change migration 两项，从 #243 提炼）。
3. 最小 #245 Phase A/B（外部输入停止、`sec-external-github-control-facts-v1`、指令来源记录、AGENTS/Skills external-untrusted 分类）+ 对抗测试 + trusted-base bootstrap。
4. 删除 `scripts/publish-public.ts` 与 `package.json` 的 `publish`；不触碰 `QzCrane/compliter`。
5. Issue #248 首 slice：Actions commit-SHA pin、禁裸 `git fetch`、commit subject 机器门禁、staged-path 白名单。
6. #260 拆三个 WP：formatter core / hooks / CI+test-impact；旧 head 两个 P1 必须重建后重新对抗 Review。

## 5. 阶段 3–5：产品主线（逐项 gated）

- 3A：删除 `buildTaskEnvelope()` Customer 硬编码，由 acceptance/impact/test-ownership 派生；至少 3 个无关 registry 模型反特化 Gate。
- 3B：只读 TypeScript Source Program Model（files/modules/symbols、types、imports/exports、最小 flow、state/effect/error/permission、span/revision、unknown/opaque），3 个无关 fixture。
- 3C：对 SEC 自身 3 个不相关子系统输出候选 Responsibility（`authoritative: false`）。
- 3D：`READS/WRITES/MUTATES/PERFORMS_EFFECT/REQUIRES_PERMISSION` + scenario/acceptance，predicted vs actual。
- 3E：一项高价值 Controlled Mutation（候选：aggregate lattice 常量 / policy severity 映射 / WP manifest permission requirement；WP 启动时冻结其一），CAS → Impact → staged → focused Verification → rollback → readback。
- 3F：至少 2 个与 Customer/Ticket 无关的真实 TS 仓库重复 3B–3E。
- 阶段 4：仅当真实 Backend/Generator migration 暴露现有 IR 缺口，才以渐进合法化新增 Application/Behavior/Target Program IR。
- 阶段 5：仅当 3B–3E 可用，才逐一落地 Task Capsule / Change Closure / Run Kernel / Evidence DAG / Integration Queue / Work Selector。

## 6. 假设与边界

- 本执行文档放 `docs/evidence/` 而非 `docs/work/`，因为当前 #227 manifest 禁止改 `docs/authority.json`，docs/work 新增文件需要 registry 登记；Evidence 根目录是 docs-doctor 豁免区。
- 所有合并必须走 frozen WP + pointer + 独立 Review + hosted Gate + new-main readback；无 force merge、无候选自授权。
- 阶段 2–5 每个 WP 都需要新任务授权；本文件不构成跨阶段写入授权。
