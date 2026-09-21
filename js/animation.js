// Canvas 动画层：故障沿边传播的粒子流 + 故障节点脉冲光环
// 性能手段：rAF、对象池、离屏裁剪、devicePixelRatio 适配、粒子上限
const MAX_PARTICLES = 600;

export class AnimationLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.pool = [];
    this.pulses = new Map(); // nodeId -> startTime
    this.enabled = true;
    this.getNodePos = () => null;
    this.getEdgeEnds = () => null;
    this.running = false;
    this.onFps = null;
    this._frames = 0;
    this._fpsTime = 0;
    this._boundLoop = this._loop.bind(this);
    this._lastTs = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w; this.height = h;
  }

  // 沿边发射一个传播粒子
  spawnEdgeParticle(edgeId, duration, color = '#ffb142') {
    if (!this.enabled) return;
    if (this.particles.length >= MAX_PARTICLES) return; // 上限保护
    const p = this.pool.pop() || {};
    p.edgeId = edgeId; p.t = 0;
    p.duration = Math.max(80, duration);
    p.color = color;
    this.particles.push(p);
  }

  pulse(nodeId) {
    if (!this.enabled) return;
    this.pulses.set(nodeId, performance.now());
  }

  clear() {
    for (const p of this.particles) this.pool.push(p);
    this.particles.length = 0;
    this.pulses.clear();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTs = performance.now();
    this._fpsTime = this._lastTs;
    this._frames = 0;
    requestAnimationFrame(this._boundLoop);
  }

  stop() { this.running = false; }

  _loop(ts) {
    if (!this.running) return;
    const dt = Math.min(50, ts - this._lastTs);
    this._lastTs = ts;
    this._frames++;
    if (ts - this._fpsTime >= 1000) {
      const fps = (this._frames * 1000) / (ts - this._fpsTime);
      this.onFps?.(Math.round(fps));
      this._frames = 0; this._fpsTime = ts;
    }
    try {
      this._render(ts, dt);
    } catch (err) {
      this.onError?.(`动画渲染异常: ${err.message}`);
    }
    requestAnimationFrame(this._boundLoop);
  }

  _render(ts, dt) {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    if (!this.enabled) return;

    // 粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt / p.duration;
      if (p.t >= 1) {
        this.particles.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      const ends = this.getEdgeEnds(p.edgeId);
      if (!ends) continue;
      const x = ends.x1 + (ends.x2 - ends.x1) * p.t;
      const y = ends.y1 + (ends.y2 - ends.y1) * p.t;
      if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue; // 离屏裁剪
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 故障节点脉冲光环
    for (const [nodeId, start] of this.pulses) {
      const age = ts - start;
      if (age > 1500) { this.pulses.delete(nodeId); continue; }
      const pos = this.getNodePos(nodeId);
      if (!pos) continue;
      const k = age / 1500;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(255, 82, 82, ${0.8 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.arc(pos.x, pos.y, pos.r + 4 + k * 26, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
