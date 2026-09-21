import { generateGraph, validateGraph } from './graph.js';
import { simulatePropagation, statesAt } from './propagation.js';
import { Renderer, FpsMonitor } from './renderer.js';

const $ = (sel) => document.querySelector(sel);
const svg = $('#stage');
const canvas = $('#fx');

// ---------- 异常提示 ----------
function toast(message, level = 'error') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4200);
}
window.addEventListener('error', (e) => toast(`运行时错误: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => toast(`异步错误: ${e.reason?.message || e.reason}`));

// ---------- 应用状态 ----------
const app = {
  graph: null,
  renderer: null,
  worker: null,
  workerFailed: false,
  timeline: null,     // 传播时间线
  playhead: 0,        // 播放头 ms
  playing: false,
  speed: 1,
  lastFrame: 0,
  dpr: window.devicePixelRatio || 1,
  lowFpsWarned: false,
};

const fpsMonitor = new FpsMonitor((fps) => {
  $('#fps').textContent = `${fps.toFixed(0)} fps`;
  if (fps < 30 && !app.lowFpsWarned) {
    app.lowFpsWarned = true;
    toast('帧率偏低，建议减少节点数量或降低播放速度', 'warn');
  } else if (fps > 45) {
    app.lowFpsWarned = false;
  }
});

// ---------- 布局 Worker ----------
function startLayout() {
  const { nodes, edges } = app.graph;
  const rect = svg.getBoundingClientRect();
  try {
    app.worker = new Worker('./js/layout-worker.js');
  } catch (err) {
    app.workerFailed = true;
    toast(`Web Worker 不可用，已降级为主线程布局: ${err.message}`, 'warn');
    fallbackLayout();
    return;
  }
  const idList = nodes.map((n) => n.id);
  app.worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'tick') {
      const p = msg.positions; // 交错 [x0,y0,x1,y1,...]
      const xs = new Array(idList.length), ys = new Array(idList.length);
      for (let i = 0; i < idList.length; i++) { xs[i] = p[i * 2]; ys[i] = p[i * 2 + 1]; }
      app.renderer.setPositions(idList, xs, ys);
    } else if (msg.type === 'done') {
      $('#layout-status').textContent = '布局完成';
    } else if (msg.type === 'error') {
      toast(`布局 Worker 错误: ${msg.message}`, 'warn');
    }
  };
  app.worker.onerror = (err) => {
    app.workerFailed = true;
    toast(`布局 Worker 异常，已降级: ${err.message || '未知错误'}`, 'warn');
    app.worker.terminate();
    fallbackLayout();
  };
  // 发送 px、py 合并数组
  app.worker.postMessage({
    type: 'init', nodes, edges,
    width: Math.max(400, rect.width), height: Math.max(300, rect.height),
    seed: 1,
  });
  $('#layout-status').textContent = '布局计算中…';
}

// Worker 不可用时的兜底：主线程一次性静态螺线布局。
function fallbackLayout() {
  const { nodes } = app.graph;
  const rect = svg.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const xs = [], ys = [], ids = [];
  nodes.forEach((n, i) => {
    const r = 10 * Math.sqrt(i + 0.5);
    const a = i * 2.399963;
    ids.push(n.id);
    xs.push(cx + r * Math.cos(a));
    ys.push(cy + r * Math.sin(a));
  });
  app.renderer.setPositions(ids, xs, ys);
  $('#layout-status').textContent = '布局完成（降级模式）';
}

// ---------- 故障注入与播放 ----------
function injectFault(sourceId) {
  try {
    app.renderer.resetStates();
    app.timeline = simulatePropagation(app.graph, sourceId, 7);
    app.playhead = 0;
    app.playing = true;
    $('#btn-play').textContent = '暂停';
    $('#stat-faults').textContent = `${app.timeline.faulted.size} / ${app.graph.nodes.length}`;
    $('#stat-duration').textContent = `${(app.timeline.duration / 1000).toFixed(1)} s`;
    // 预注册脉冲
    app.renderer.pulses = app.timeline.pulses.map((p) => ({ ...p }));
    toast(`已注入故障: 节点 N${sourceId}`, 'info');
  } catch (err) {
    toast(`故障注入失败: ${err.message}`);
  }
}

function applyPlayhead(t) {
  const states = statesAt(app.timeline, t);
  for (const n of app.graph.nodes) app.renderer.setNodeState(n.id, states.get(n.id) ?? 0);
  // 活跃边集合：只遍历脉冲一次，O(P) 而非 O(E*P)
  const active = new Set();
  for (const p of app.timeline.pulses) {
    if (t >= p.t0 && t < p.t1) active.add(p.edgeId);
  }
  for (const e of app.graph.edges) app.renderer.setEdgeActive(e.id, active.has(e.id));
  $('#time').textContent = `${(t / 1000).toFixed(1)} s`;
  const ratio = app.timeline.duration ? t / app.timeline.duration : 0;
  $('#progress').value = Math.min(1, ratio);
}

// ---------- 主动画循环 ----------
function frame(now) {
  requestAnimationFrame(frame);
  fpsMonitor.tick(now);
  if (app.playing && app.timeline) {
    const dt = app.lastFrame ? (now - app.lastFrame) * app.speed : 0;
    app.playhead = Math.min(app.timeline.duration, app.playhead + dt);
    applyPlayhead(app.playhead);
    if (app.playhead >= app.timeline.duration) {
      app.playing = false;
      $('#btn-play').textContent = '播放';
    }
  }
  app.lastFrame = now;
  app.renderer.drawFrame(app.playhead, app.dpr);
}

// ---------- 交互：缩放 / 平移 / 点选注入 ----------
function bindInteractions() {
  let panning = false, sx = 0, sy = 0;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('node')) {
      injectFault(Number(e.target.dataset.id));
      return;
    }
    panning = true; sx = e.clientX; sy = e.clientY;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!panning) return;
    app.renderer.view.x += e.clientX - sx;
    app.renderer.view.y += e.clientY - sy;
    sx = e.clientX; sy = e.clientY;
    app.renderer.applyView();
  });
  svg.addEventListener('pointerup', () => { panning = false; });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = app.renderer.view;
    const k = Math.min(4, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    v.x = mx - ((mx - v.x) / v.k) * k;
    v.y = my - ((my - v.y) / v.k) * k;
    v.k = k;
    app.renderer.applyView();
  }, { passive: false });
}

function bindControls() {
  $('#btn-inject').addEventListener('click', () => {
    const id = Math.floor(Math.random() * app.graph.nodes.length);
    injectFault(id);
  });
  $('#btn-play').addEventListener('click', () => {
    if (!app.timeline) { toast('请先注入故障', 'warn'); return; }
    app.playing = !app.playing;
    $('#btn-play').textContent = app.playing ? '暂停' : '播放';
  });
  $('#btn-reset').addEventListener('click', () => {
    app.playing = false;
    app.playhead = 0;
    app.timeline = null;
    app.renderer.resetStates();
    $('#btn-play').textContent = '播放';
    $('#time').textContent = '0.0 s';
    $('#progress').value = 0;
    $('#stat-faults').textContent = '0 / 0';
    $('#stat-duration').textContent = '-';
  });
  $('#speed').addEventListener('change', (e) => { app.speed = Number(e.target.value); });
  $('#progress').addEventListener('input', (e) => {
    if (!app.timeline) return;
    app.playhead = Number(e.target.value) * app.timeline.duration;
    applyPlayhead(app.playhead);
  });
  $('#btn-rebuild').addEventListener('click', () => init());
  window.addEventListener('resize', () => { app.dpr = app.renderer.resize(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) app.lastFrame = 0; // 切回时不产生巨大 dt 跳变
  });
}

// ---------- 初始化 ----------
function init() {
  try {
    if (app.worker) app.worker.terminate();
    const count = Number($('#node-count').value);
    app.graph = validateGraph(generateGraph(count, 42));
    svg.innerHTML = '';
    app.renderer = new Renderer(svg, canvas, app.graph);
    app.dpr = app.renderer.resize();
    app.timeline = null;
    app.playhead = 0;
    app.playing = false;
    $('#stat-faults').textContent = `0 / ${app.graph.nodes.length}`;
    $('#stat-duration').textContent = '-';
    startLayout();
  } catch (err) {
    toast(`初始化失败: ${err.message}`);
  }
}

bindControls();
bindInteractions();
init();
requestAnimationFrame(frame);
