// 布局控制器：优先 Web Worker，失败时降级到主线程，保证功能可用
export class LayoutController {
  constructor({ onTick, onError }) {
    this.onTick = onTick;
    this.onError = onError;
    this.worker = null;
    this.fallback = false;
    this._fallbackTimer = null;
  }

  start(payload) {
    this.stop();
    if (!this.fallback) {
      try {
        this.worker = new Worker('js/layout-worker.js');
        this.worker.onmessage = (ev) => {
          const msg = ev.data;
          if (msg.type === 'tick') this.onTick(msg.positions, msg.done);
          else if (msg.type === 'error') this._fail(`布局 Worker 错误: ${msg.message}`, payload);
        };
        this.worker.onerror = (e) => {
          this._fail(`布局 Worker 启动失败: ${e.message || '未知错误'}`, payload);
        };
        this.worker.postMessage(payload);
        return;
      } catch (err) {
        this._fail(`无法创建 Worker: ${err.message}`, payload);
        return;
      }
    }
    this._runOnMainThread(payload);
  }

  _fail(message, payload) {
    this.onError?.(message + '，已降级为主线程布局');
    this.fallback = true;
    this.stop();
    this._runOnMainThread(payload);
  }

  // 主线程降级：与 worker 相同的简化力导向，分片执行避免卡死
  _runOnMainThread(payload) {
    const { nodes, edges, width, height } = payload;
    const n = nodes.length;
    const px = nodes.map((d) => d.x || width / 2);
    const py = nodes.map((d) => d.y || height / 2);
    let alpha = 1;
    const decay = 1 - Math.pow(0.001, 1 / 300);
    const step = () => {
      for (let iter = 0; iter < 5 && alpha > 0; iter++) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const dx = px[i] - px[j], dy = py[i] - py[j];
            const d2 = dx * dx + dy * dy;
            if (d2 < 1 || d2 > 25600) continue;
            const f = (90 * alpha) / d2;
            px[i] += dx * f; py[i] += dy * f;
            px[j] -= dx * f; py[j] -= dy * f;
          }
        }
        for (const e of edges) {
          const dx = px[e.target] - px[e.source], dy = py[e.target] - py[e.source];
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 70) * 0.02 * alpha;
          px[e.source] += dx * f; py[e.source] += dy * f;
          px[e.target] -= dx * f; py[e.target] -= dy * f;
        }
        alpha = Math.max(0, alpha - decay);
      }
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { out[i * 2] = px[i]; out[i * 2 + 1] = py[i]; }
      this.onTick(out, alpha <= 0);
      if (alpha > 0) this._fallbackTimer = setTimeout(step, 16);
    };
    step();
  }

  pin(id, x, y, fixed) {
    if (this.worker && !this.fallback) {
      this.worker.postMessage({ type: 'pin', id, x, y, fixed });
    }
  }

  stop() {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
  }
}
