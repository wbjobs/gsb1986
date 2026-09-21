// Web Worker：力导向布局计算，避免阻塞主线程
// 消息协议:
//   in : { type:'layout', nodes, edges, width, height, iterations, seed }
//        { type:'pin', id, x, y, fixed }
//        { type:'stop' }
//   out: { type:'tick', positions:Float32Array, alpha, done }
//        { type:'error', message }

let sim = null;

function createSimulation(payload) {
  const { nodes, edges, width, height, seed } = payload;
  const n = nodes.length;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const fixed = new Uint8Array(n);
  const layer = new Int8Array(n);

  // 确定性初始位置：按层分列 + 种子抖动，保证布局稳定可复现
  let s = seed >>> 0;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const layerCount = new Map();
  const layerIndex = new Map();
  nodes.forEach((nd) => layerCount.set(nd.layer, (layerCount.get(nd.layer) || 0) + 1));
  const maxLayer = Math.max(...nodes.map((d) => d.layer), 0);
  nodes.forEach((nd, i) => {
    const idx = layerIndex.get(nd.layer) || 0;
    layerIndex.set(nd.layer, idx + 1);
    const total = layerCount.get(nd.layer);
    px[i] = (width * (nd.layer + 0.5)) / (maxLayer + 1) + (rand() - 0.5) * 40;
    py[i] = (height * (idx + 0.5)) / total + (rand() - 0.5) * 40;
    fixed[i] = nd.fixed ? 1 : 0;
    layer[i] = nd.layer;
  });

  const src = new Int32Array(edges.length);
  const tgt = new Int32Array(edges.length);
  edges.forEach((e, i) => { src[i] = e.source; tgt[i] = e.target; });

  return {
    n, px, py, vx, vy, fixed, layer, src, tgt,
    width, height,
    alpha: 1.0,
    alphaDecay: 1 - Math.pow(0.001, 1 / Math.max(1, payload.iterations || 300)),
    done: false,
  };
}

function tick(sim) {
  const { n, px, py, vx, vy, fixed, layer, src, tgt, width, height } = sim;
  const alpha = sim.alpha;
  const maxLayer = Math.max(...layer, 0);

  // 节点间斥力（近似：抽样对，保证大图性能 O(n*k)）
  const stride = Math.max(1, Math.floor(n / 120));
  for (let i = 0; i < n; i++) {
    for (let j = (i + stride) % n; j !== i; j = (j + stride) % n) {
      let dx = px[i] - px[j]; let dy = py[i] - py[j];
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (i - j) * 0.01; dy = 0.01; d2 = dx * dx + dy * dy; }
      if (d2 > 160 * 160) continue;
      const f = (90 * alpha) / d2;
      vx[i] += dx * f; vy[i] += dy * f;
      vx[j] -= dx * f; vy[j] -= dy * f;
    }
  }
  // 边弹簧力
  for (let e = 0; e < src.length; e++) {
    const a = src[e], b = tgt[e];
    const dx = px[b] - px[a], dy = py[b] - py[a];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - 70) * 0.02 * alpha;
    const fx = dx * f, fy = dy * f;
    vx[a] += fx; vy[a] += fy;
    vx[b] -= fx; vy[b] -= fy;
  }
  // 分层引力 + 居中
  for (let i = 0; i < n; i++) {
    const targetX = (width * (layer[i] + 0.5)) / (maxLayer + 1);
    vx[i] += (targetX - px[i]) * 0.02 * alpha;
    vy[i] += (height / 2 - py[i]) * 0.005 * alpha;
  }
  // 积分 + 边界
  const margin = 24;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) { vx[i] = 0; vy[i] = 0; continue; }
    vx[i] *= 0.6; vy[i] *= 0.6;
    px[i] = Math.min(width - margin, Math.max(margin, px[i] + vx[i]));
    py[i] = Math.min(height - margin, Math.max(margin, py[i] + vy[i]));
  }
  sim.alpha = Math.max(0, sim.alpha - sim.alphaDecay);
  if (sim.alpha <= 0) sim.done = true;
}

function postPositions(sim) {
  const out = new Float32Array(sim.n * 2);
  for (let i = 0; i < sim.n; i++) { out[i * 2] = sim.px[i]; out[i * 2 + 1] = sim.py[i]; }
  self.postMessage({ type: 'tick', positions: out, alpha: sim.alpha, done: sim.done }, [out.buffer]);
}

self.onmessage = (ev) => {
  try {
    const msg = ev.data;
    if (msg.type === 'layout') {
      sim = createSimulation(msg);
      const batch = 5; // 每帧计算 5 次迭代后回传，兼顾流畅与及时
      const step = () => {
        if (!sim) return;
        for (let k = 0; k < batch && !sim.done; k++) tick(sim);
        postPositions(sim);
        if (!sim.done) setTimeout(step, 16);
      };
      step();
    } else if (msg.type === 'pin' && sim) {
      const { id, x, y, fixed: fx } = msg;
      if (id >= 0 && id < sim.n) {
        sim.px[id] = x; sim.py[id] = y;
        sim.fixed[id] = fx ? 1 : 0;
        if (fx) sim.alpha = Math.max(sim.alpha, 0.1); // 拖拽时轻微唤醒
        if (sim.done && sim.alpha > 0) {
          sim.done = false;
          const step = () => {
            if (!sim) return;
            for (let k = 0; k < 5 && !sim.done; k++) tick(sim);
            postPositions(sim);
            if (!sim.done) setTimeout(step, 16);
          };
          step();
        }
      }
    } else if (msg.type === 'stop') {
      sim = null;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
