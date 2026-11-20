# drape-lab — 可复算的 XPBD 布料证书

**一句话承诺**：4 个场景 × 900 帧（共 3600 帧）的布料模拟中，结构边最大拉伸 **0.950%**（`gust` 场景），对比基线 `baseline/naive.mjs`（单子步 PBD）在同一场景上的 **31.516%**，拉伸降低 **38.0 倍**；全帧穿透 **0.00e+0 m**，位置哈希跨次重放**逐位一致**（`hang=bd997ede`）。

Upstream: none

## 这是什么

一个把「布料模拟」和「可复算证据」绑在一起的 3D 工具。核心 `src/core.mjs` 是纯 ES module 的确定性 XPBD 布料求解器：16 子步、三条边集合（结构边刚度为 0、剪切边与弯曲边为软刚度）、平面碰撞与可选球体碰撞、脚本化的顶点拖拽。它不 import three、不碰 DOM，因此同一个场景在 node 与浏览器里跑出的位置哈希完全相同——这就是页面上 HUD 里「live hash 对齐 node hash」那行在做的事。

四个场景：`hang`（整条上边固定、纯重力下坠）、`breeze` / `gust`（沿 +z 的正弦阵风）、`calm`（轻风）。场景参数由 `tools/gen-sample.mjs` 确定性生成，同一条命令跑两次产物字节一致（sha256 `fe3d98227bdd0242…`）。

## 怎么跑

```bash
node tools/gen-sample.mjs   # 重建 data/scenarios.json
node bench/verify.mjs       # 13 条行为断言，全过退出码 0
node bench/bench.mjs        # 计时 + 4 场景指标，写 bench/result.json
python3 -m http.server 4173  # 打开 http://localhost:4173
```

## 证据（`bench/result.json` 摘要）

- 计时（`hang`，41×41，120 帧，16 子步）：冷启动 **527.7 ms**，5 次采样 median **438.8 ms**、min 437.4 / p95 442.7 / stddev 1.9 ms（相对标准差 0.4%，低于 10% 红线，无需额外解释）。900 帧单场景约 2.0–3.6 s。
- 4 场景 × 900 帧，最大结构边拉伸：`hang 0.830%`、`breeze 0.521%`、`gust 0.950%`、`calm 0.519%`；对应基线（单子步 PBD）最大拉伸分别 `31.516%` / `17.072%` / `31.516%` / `17.072%`（拉伸降低 38.0 / 32.8 / 33.2 / 32.9 倍）。
- 穿透：4 场景全 0.00e+0 m；位置哈希 `bd997ede / c39cb7e5 / 7a23ffb4 / 53e99852`，重放逐位一致。
- 计时与标准差见 `bench/result.json` 的 `timing` 与 `scenarios[].msXpbd`。

## 已知限制

- **绝对尺度约束**：碰撞与阻尼按米/秒量纲取值，`gravity = -9.81 m/s²`、`dt = 1/60 s`。断言只在长度 1e-3…1e3 的相对尺度上成立（A10 实测最差相对坐标误差 1.79e-10），尺度再小到 1e-6 级别时浮点误差会主导，已记录但不做外推。
- **不做自碰撞**：布料自身穿过不做检测；四个场景均无自碰撞，布料互相穿过的情形未被验证。
- **不接真实资产**：只处理脚本生成的规则网格，没有 glTF 导入路径。
- **非实时**：41×41 网格 16 子步在 node 里每帧约数毫秒，浏览器里按 60 FPS 节流跑（每帧最多 4 步）。

## 本轮创新

**B 档（新意）**：把 XPBD 布料从「画面好看」做成**同一进程内跨运行、跨渲染层可逐位复算的证书**——位置哈希是求解器状态的指纹，`bench/verify.mjs` 断言它在 900 帧重放下逐位不变（A7），浏览器页面又反过来用这个哈希与 `bench/result.json` 对账。台账中已有测地距离（`geodesic-cert-lab`）、接触流形（`contactforge`）、精确偏移（`offsetcert`）等几何证书，但没有把**布料的拉伸与穿透**做成「浏览器现场哈希 = node 基准哈希」的复算对账；且基线（单子步 PBD）在同一网格上拉伸 31.5%，使「收敛性」这一维有了可现场复算的对照。

## 仓库结构

| 文件 | 作用 |
| --- | --- |
| `src/core.mjs` | 纯计算：布料创建、XPBD 步进、碰撞、应变、穿透、位置哈希 |
| `main.js` / `index.html` | three.js 渲染 + 轨道相机交互，只消费 core 的输出 |
| `tools/gen-sample.mjs` | 确定性生成 `data/scenarios.json` |
| `baseline/naive.mjs` | 单子步 PBD 基线（对照） |
| `bench/verify.mjs` / `bench/bench.mjs` | 13 条断言 / 计时与指标 |
| `bench/result.json` | 真实运行产出的数字 |

MIT License.
