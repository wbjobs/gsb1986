// 力导向布局 Worker：与主线程解耦，避免大图布局阻塞 UI/动画。
// 协议：
//   收: { type:'init', nodes, edges, width, height, seed }
//   收: { type:'pin', id, x, y } / { type:'unpin', id } / { type:'reheat' }
//   发: { type:'tick', positions: Float32Array, alpha }  （每批迭代后回传）
//   发: { type:'done' } | { type:'error', message }
'use strict';

let sim = null;

function createRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initSim(msg) {
  const { nodes, edges, width, height, seed } = msg;
  const n = nodes.length;
  const rng = createRng(seed || 1);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const pinned = new Uint8Array(n);
  // 确定性初始位置：阿基米德螺线，避免初始重叠导致的布局抖动
  for (let i = 0; i < n; i++) {
    const r = 8 * Math.sqrt(i + 0.5);
    const a = i * 2.399963 + rng() * 0.01;
    px[i] = width / 2 + r * Math.cos(a);
    py[i] = height / 2 + r * Math.sin(a);
  }
  const indexOf = new Map(nodes.map((nd, i) => [nd.id, i]));
  const links = [];
  for (const e of edges) {
    const s = indexOf.get(e.source);
    const t = indexOf.get(e.target);
    if (s === undefined || t === undefined) continue;
    links.push([s, t]);
  }
  sim = {
    n, px, py, vx, vy, pinned, links,
    alpha: 1, alphaMin: 0.02, alphaDecay: 0.012,
    repulsion: -260, linkDist: 60, linkStrength: 0.06,
    cx: width / 2, cy: height / 2, centerStrength: 0.04,
    batch: 3, // 每帧迭代次数
  };
}

function step() {
  const s = sim;
  const { n, px, py, vx, vy, pinned, links } = s;
  const k = s.alpha;
  // 斥力 O(n^2)，Worker 中可接受；n 大时降采样批次由主线程控制
  for (let i = 0; i < n; i++) {
    const xi = px[i], yi = py[i];
    for (let j = i + 1; j < n; j++) {
      let dx = px[j] - xi, dy = py[j] - yi;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; d2 = 0.02; }
      if (d2 > 360000) continue; // 截断远距离斥力，提速且更稳定
      const f = (s.repulsion * k) / d2;
      const fx = f * dx, fy = f * dy;
      vx[i] += fx; vy[i] += fy;
      vx[j] -= fx; vy[j] -= fy;
    }
  }
  // 链接引力
  for (const [a, b] of links) {
    const dx = px[b] - px[a], dy = py[b] - py[a];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - s.linkDist) * s.linkStrength * k;
    const fx = (f * dx) / d, fy = (f * dy) / d;
    vx[a] += fx; vy[a] += fy;
    vx[b] -= fx; vy[b] -= fy;
  }
  // 向心力 + 位置积分（钉住节点不动）
  for (let i = 0; i < n; i++) {
    if (pinned[i]) { vx[i] = 0; vy[i] = 0; continue; }
    vx[i] = (vx[i] + (s.cx - px[i]) * s.centerStrength * k) * 0.85;
    vy[i] = (vy[i] + (s.cy - py[i]) * s.centerStrength * k) * 0.85;
    px[i] += vx[i];
    py[i] += vy[i];
  }
  s.alpha = Math.max(s.alphaMin, s.alpha - s.alphaDecay);
}

function loop() {
  try {
    for (let i = 0; i < sim.batch; i++) step();
    const out = new Float32Array(sim.n * 2);
    for (let i = 0; i < sim.n; i++) {
      out[i * 2] = sim.px[i];
      out[i * 2 + 1] = sim.py[i];
    }
    postMessage({ type: 'tick', positions: out, alpha: sim.alpha }, [out.buffer]);
    if (sim.alpha > sim.alphaMin) {
      setTimeout(loop, 16);
    } else {
      postMessage({ type: 'done' });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
}

onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      initSim(msg);
      loop();
    } else if (!sim) {
      return;
    } else if (msg.type === 'pin') {
      const i = msg.index;
      sim.pinned[i] = 1;
      sim.px[i] = msg.x; sim.py[i] = msg.y;
    } else if (msg.type === 'unpin') {
      sim.pinned[msg.index] = 0;
    } else if (msg.type === 'reheat') {
      sim.alpha = Math.max(sim.alpha, 0.3);
      loop();
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
