# 拓扑故障传播仿真

纯前端实现，零构建依赖：**SVG**（拓扑渲染）+ **Web Worker**（布局计算）+ **Canvas**（传播动画）。

## 运行

```bash
# 任意静态服务器，例如：
python3 -m http.server 8080
# 打开 http://localhost:8080
```

> 需要通过 HTTP 访问（Web Worker 与 ES Module 不支持 file:// 协议）。

## 功能与验收对照

| 验收标准 | 实现 |
|---|---|
| 故障传播正确 | `js/propagation.js`：从故障源 BFS，按边延迟/概率生成事件计划；`test/propagation.test.mjs` 8 项单测覆盖状态机、边界概率、连通性 |
| 动画流畅 | `js/animation.js`：Canvas rAF 粒子流 + 故障脉冲，对象池、粒子上限、离屏裁剪、DPR 适配、页面隐藏自动暂停 |
| 布局稳定 | `js/layout-worker.js`：固定种子确定性初始位置 + 分层力导向布局，结果可复现；拖拽可固定节点 |
| 性能可接受 | 布局在 Worker 中分片计算不阻塞主线程；TypedArray 传位置（transferable）；工具栏实时 FPS；支持 40~300 节点 |
| 异常有提示 | `js/toast.js` 右上角 Toast；全局 error/unhandledrejection 兜底；Worker 失败自动降级主线程布局并提示 |

## 操作

- **点击节点**：注入故障，观察沿边传播（橙=传播中，红=已故障）
- **拖拽节点**：固定位置并局部唤醒布局
- **重置故障**：清除全部故障状态
- **重新布局**：解除固定并重算布局
- **节点数**：切换 40/80/150/300 规模验证性能

## 测试

```bash
node --test test/propagation.test.mjs
```

## 结构

```
index.html            页面骨架（SVG + Canvas 双层）
css/style.css         样式与故障状态配色
js/data.js            确定性拓扑生成（分层 + 连通性保障）
js/layout-worker.js   Worker 内力导向布局
js/layout.js          布局控制器（Worker 失败降级主线程）
js/propagation.js     故障传播引擎（BFS + 事件计划）
js/animation.js       Canvas 粒子/脉冲动画层
js/toast.js           异常提示
js/main.js            渲染、交互与装配
test/                 传播正确性单测
```
