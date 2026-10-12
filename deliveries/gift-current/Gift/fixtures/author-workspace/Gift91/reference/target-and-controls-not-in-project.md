# Targets, controls, runtime and generated products are absent by design（历史研究说明）

`targets: {}` says neither example requests a Gift Target. To request one, each `targets[targetName]` requires `profileRef` (a **real bound TargetProfile**) and `outputRoots` (actual exported Definition selectors; `{"moduleId":"studio.product","export":"Studio"}` is a structurally recognizable selector). Optional `parameters` must be typed by that target's exact profile. No TargetProfile bytes or TS lowering implementation are present in this fixture, so supplying a made-up profile here would create a false promise of generated executable files.

`gift.controls/2` belongs under `gift.project/1.extensions["gift.controls/2"]` **only for real user-pinned implementational controls**. It has versioned `scopeRef` and descriptor rules. No pin means no control record. Native `tsconfig.json`, workspace user preferences and runtime Grant do not belong there.

`generated/`, `.gift/cache/`, `ArtifactSet`, `RealizationPlan`, `TargetProjectPlan`, `Operation`, `Evidence`, coverage indexes and runtime log are not writable source mirrors. They exist only when actually produced by the responsible services. A saved design is not evidence of type-check, generated source, installation, or runtime success.

The control placement above records the original proposal. Current writer and migration rules belong to [the control owner](../../../../docs/20-语义与组合/组合/稀疏控制与目标限定.md); the historical `scopeRef` shape does not authorize a current write.
