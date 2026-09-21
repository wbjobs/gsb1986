// 渲染器：SVG 负责结构（节点/边/标签，事件友好），
// Canvas 覆盖层负责高频动画（传播脉冲），互不阻塞。
const SVG_NS = 'http://www.w3.org/2000/svg';
const STATE_CLASS = ['state-ok', 'state-warn', 'state-fault'];

export class Renderer {
  constructor(svg, canvas, graph) {
    this.svg = svg;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graph = graph;
    this.positions = new Map(); // id -> {x, y}
    this.nodeEls = new Map();
    this.nodeState = new Map();
    this.edgeEls = new Map();
    this.edgeActive = new Map();
    this.pulses = [];           // 活跃脉冲 {edge, t0, t1}
    this.view = { x: 0, y: 0, k: 1 };
    this._build();
  }

  _build() {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'viewport');
    this.viewport = g;
    const edgeLayer = document.createElementNS(SVG_NS, 'g');
    const nodeLayer = document.createElementNS(SVG_NS, 'g');
    g.append(edgeLayer, nodeLayer);
    this.svg.appendChild(g);

    for (const e of this.graph.edges) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'edge');
      edgeLayer.appendChild(line);
      this.edgeEls.set(e.id, line);
    }
    for (const n of this.graph.nodes) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('class', 'node state-ok');
      c.setAttribute('r', '7');
      c.dataset.id = n.id;
      const t = document.createElementNS(SVG_NS, 'title');
      t.textContent = n.name;
      c.appendChild(t);
      nodeLayer.appendChild(c);
      this.nodeEls.set(n.id, c);
      this.nodeState.set(n.id, 0);
    }
  }

  setPositions(ids, xs, ys) {
    for (let i = 0; i < ids.length; i++) {
      this.positions.set(ids[i], { x: xs[i], y: ys[i] });
    }
    this._applyPositions();
  }

  _applyPositions() {
    for (const e of this.graph.edges) {
      const a = this.positions.get(e.source);
      const b = this.positions.get(e.target);
      if (!a || !b) continue;
      const line = this.edgeEls.get(e.id);
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    }
    for (const [id, el] of this.nodeEls) {
      const p = this.positions.get(id);
      if (!p) continue;
      el.setAttribute('cx', p.x);
      el.setAttribute('cy', p.y);
    }
  }

  setNodeState(id, state) {
    if (this.nodeState.get(id) === state) return;
    this.nodeState.set(id, state);
    const el = this.nodeEls.get(id);
    el.setAttribute('class', `node ${STATE_CLASS[state]}`);
  }

  setEdgeActive(edgeId, active) {
    if (this.edgeActive.get(edgeId) === active) return;
    this.edgeActive.set(edgeId, active);
    const el = this.edgeEls.get(edgeId);
    el.setAttribute('class', active ? 'edge edge-active' : 'edge');
  }

  resetStates() {
    for (const id of this.nodeState.keys()) this.setNodeState(id, 0);
    for (const id of this.edgeActive.keys()) this.setEdgeActive(id, false);
    this.pulses.length = 0;
  }

  // 每帧调用：根据当前播放时间更新脉冲与 Canvas 绘制
  drawFrame(now, dpr) {
    const { ctx, canvas } = this;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { x, y, k } = this.view;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    for (const p of this.pulses) {
      if (now < p.t0 || now > p.t1) continue;
      const a = this.positions.get(p.from);
      const b = this.positions.get(p.to);
      if (!a || !b) continue;
      const t = (now - p.t0) / (p.t1 - p.t0);
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const grad = ctx.createRadialGradient(px, py, 0, px, py, 10);
      grad.addColorStop(0, 'rgba(255,120,60,0.95)');
      grad.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    return dpr;
  }

  applyView() {
    const { x, y, k } = this.view;
    this.viewport.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  }
}

// FPS 监控：指数滑动平均，低于阈值回调告警
export class FpsMonitor {
  constructor(onSample, windowSize = 30) {
    this.onSample = onSample;
    this.frames = [];
    this.windowSize = windowSize;
    this.last = 0;
  }
  tick(now) {
    if (this.last) {
      this.frames.push(now - this.last);
      if (this.frames.length > this.windowSize) this.frames.shift();
      const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
      this.onSample(1000 / avg);
    }
    this.last = now;
  }
}
