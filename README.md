# 拓扑故障传播可视化

基于 **SVG + Web Worker + Canvas** 的网络拓扑布局与故障传播动画演示。

## 运行

浏览器直接打开需 HTTP 服务（ES Module 与 Worker 限制）：

```bash
npx serve .          # 或 python3 -m http.server
```

打开 `http://localhost:3000`（或对应端口）。

## 测试

```bash
node test/propagation.test.mjs
```

## 架构

| 模块 | 职责 |
| --- | --- |
| `js/graph.js` | 拓扑生成（随机树保证连通 + 冗余边）、数据校验、邻接表 |
| `js/propagation.js` | 故障传播引擎：离散事件模拟（最小堆），输出确定性时间线 |
| `js/layout-worker.js` | Web Worker 中的力导向布局，批量迭代后回传坐标 |
| `js/renderer.js` | SVG 渲染节点/边（事件友好），Canvas 覆盖层绘制传播脉冲 |
| `js/main.js` | 装配、播放控制、缩放平移、FPS 监控、异常提示 |

## 设计要点

- **布局**：力导向算法在 Worker 中运行，不阻塞 UI；螺线确定性初始位置 + 冷却降温，布局稳定可复现；Worker 异常时自动降级为主线程静态布局并提示。
- **传播**：从故障源沿边按「延迟 + 概率」传播，最小堆保证全局时间顺序；相同 seed 结果完全可复现（测试保障）。
- **动画**：SVG 负责结构，Canvas 负责高频脉冲粒子，rAF 驱动；切后台自动防 dt 跳变。
- **性能**：布局与渲染分离、TypedArray  transferable 回传、活跃边 O(P) 计算、斥力距离截断；HUD 实时显示 FPS，低帧率自动告警。
- **异常**：图数据校验、Worker 错误降级、全局 error/unhandledrejection 捕获，统一 Toast 提示。

## 交互

- 点击节点：注入故障并播放传播动画
- 拖拽空白 / 滚轮：平移缩放
- 工具栏：调整节点规模、播放/暂停/重置、变速、拖动进度条
