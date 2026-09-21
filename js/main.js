import { generateTopology } from './data.js';
import { LayoutController } from './layout.js';
import { PropagationEngine } from './propagation.js';
import { AnimationLayer } from './animation.js';
import { toast, setStatus } from './toast.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('topo-svg');
const tooltip = document.getElementById('tooltip');

let graph = null;
let nodeEls = [];
let edgeEls = [];
let engine = null;
let faultSource = null;

const anim = new AnimationLayer(document.getElementById('anim-canvas'));
anim.onFps = (fps) => { document.getElementById('fps').textContent = `FPS: ${fps}`; };
anim.onError = (msg) => toast(msg, 'error');

const layout = new LayoutController({
  onTick: (positions, done) => {
    try {
      applyPositions(positions);
      if (done) setStatus('布局已收敛');
    } catch (err) {
      toast(`布局更新失败: ${err.message}`, 'error');
    }
  },
  onError: (msg) => toast(msg, 'warn'),
});

// ---------- 渲染 ----------
function renderGraph() {
  svg.innerHTML = '';
  const { width, height } = svg.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const gEdges = document.createElementNS(SVG_NS, 'g');
  const gNodes = document.createElementNS(SVG_NS, 'g');
  svg.append(gEdges, gNodes);

  edgeEls = graph.edges.map((e) => {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'topo-edge');
    gEdges.appendChild(line);
    return line;
  });

  nodeEls = graph.nodes.map((n) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `topo-node ${n.type}`);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', n.radius);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('y', n.radius + 11);
    t.textContent = n.label;
    g.append(c, t);
    g.dataset.id = n.id;
    gNodes.appendChild(g);
    return g;
  });
}

function applyPositions(positions) {
  const { nodes, edges } = graph;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].x = positions[i * 2];
    nodes[i].y = positions[i * 2 + 1];
    nodeEls[i].setAttribute('transform', `translate(${nodes[i].x},${nodes[i].y})`);
  }
  for (let i = 0; i < edges.length; i++) {
    const s = nodes[edges[i].source], t = nodes[edges[i].target];
    edgeEls[i].setAttribute('x1', s.x); edgeEls[i].setAttribute('y1', s.y);
    edgeEls[i].setAttribute('x2', t.x); edgeEls[i].setAttribute('y2', t.y);
  }
}

// ---------- 故障传播 ----------
function injectFault(nodeId) {
  try {
    if (!graph.nodes[nodeId]) throw new Error(`节点 ${nodeId} 不存在`);
    resetFaults(false);
    faultSource = nodeId;
    const count = engine.start(nodeId);
    nodeEls[nodeId].classList.add('fault-source');
    setStatus(`故障传播中（源: ${graph.nodes[nodeId].label}）`);
    toast(`已在 ${graph.nodes[nodeId].label} 注入故障，计划事件 ${count} 个`, 'warn');
  } catch (err) {
    toast(`注入故障失败: ${err.message}`, 'error');
  }
}

function resetFaults(notify = true) {
  engine.stop();
  faultSource = null;
  for (const n of graph.nodes) n.state = 'normal';
  for (const e of graph.edges) e.state = 'normal';
  for (const el of nodeEls) el.classList.remove('warn', 'fault', 'fault-source');
  for (const el of edgeEls) el.classList.remove('warn', 'fault');
  anim.clear();
  setStatus('就绪');
  if (notify) toast('已重置全部故障状态', 'ok');
}

function handlePropEvent(evt) {
  if (evt.type === 'node') {
    const n = graph.nodes[evt.nodeId];
    n.state = evt.state;
    const el = nodeEls[evt.nodeId];
    el.classList.toggle('warn', evt.state === 'warn');
    el.classList.toggle('fault', evt.state === 'fault');
    if (evt.state === 'fault') anim.pulse(evt.nodeId);
  } else if (evt.type === 'edge') {
    const e = graph.edges[evt.edgeId];
    e.state = evt.state;
    const el = edgeEls[evt.edgeId];
    el.classList.toggle('warn', evt.state === 'warn');
    el.classList.toggle('fault', evt.state === 'fault');
    if (evt.state === 'warn') anim.spawnEdgeParticle(evt.edgeId, e.delay);
    if (evt.state === 'fault') anim.spawnEdgeParticle(evt.edgeId, 500, '#ff5252');
  } else if (evt.type === 'done') {
    const faults = graph.nodes.filter((n) => n.state === 'fault').length;
    setStatus(`传播结束：${faults}/${graph.nodes.length} 节点受影响`);
    toast(`故障传播结束，共 ${faults} 个节点受影响`, 'error');
  } else if (evt.type === 'error') {
    toast(evt.message, 'error');
  }
}

// ---------- 交互 ----------
function svgPoint(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

let drag = null;
svg.addEventListener('pointerdown', (ev) => {
  const g = ev.target.closest('.topo-node');
  if (!g) return;
  const id = Number(g.dataset.id);
  drag = { id, moved: false };
  g.classList.add('dragging');
  g.setPointerCapture?.(ev.pointerId);
});
svg.addEventListener('pointermove', (ev) => {
  const g = ev.target.closest?.('.topo-node');
  if (drag) {
    drag.moved = true;
    const p = svgPoint(ev);
    const n = graph.nodes[drag.id];
    n.x = p.x; n.y = p.y; n.fixed = true;
    nodeEls[drag.id].setAttribute('transform', `translate(${p.x},${p.y})`);
    layout.pin(drag.id, p.x, p.y, true);
    refreshEdges(drag.id);
    return;
  }
  if (g) {
    const n = graph.nodes[Number(g.dataset.id)];
    tooltip.hidden = false;
    tooltip.style.left = `${ev.clientX + 12}px`;
    tooltip.style.top = `${ev.clientY + 12}px`;
    tooltip.innerHTML = `<b>${n.label}</b><br>类型: ${n.type}<br>状态: ${n.state}<br>点击注入故障，拖拽固定位置`;
  } else {
    tooltip.hidden = true;
  }
});
svg.addEventListener('pointerup', (ev) => {
  const g = ev.target.closest('.topo-node');
  if (g) g.classList.remove('dragging');
  if (drag && !drag.moved && g) injectFault(drag.id);
  drag = null;
});
svg.addEventListener('pointerleave', () => { tooltip.hidden = true; });

function refreshEdges(nodeId) {
  for (const e of graph.adjacency[nodeId]) {
    const s = graph.nodes[e.source], t = graph.nodes[e.target];
    const el = edgeEls[e.id];
    el.setAttribute('x1', s.x); el.setAttribute('y1', s.y);
    el.setAttribute('x2', t.x); el.setAttribute('y2', t.y);
  }
}

// ---------- 装配 ----------
function build(nodeCount) {
  try {
    setStatus('生成拓扑...');
    layout.stop();
    engine?.stop();
    graph = generateTopology(nodeCount);
    engine = new PropagationEngine(graph);
    engine.onEvent(handlePropEvent);
    renderGraph();
    anim.getNodePos = (id) => {
      const n = graph.nodes[id];
      return n ? { x: n.x, y: n.y, r: n.radius } : null;
    };
    anim.getEdgeEnds = (id) => {
      const e = graph.edges[id];
      if (!e) return null;
      const s = graph.nodes[e.source], t = graph.nodes[e.target];
      return { x1: s.x, y1: s.y, x2: t.x, y2: t.y };
    };
    const { clientWidth: w, clientHeight: h } = document.getElementById('stage');
    setStatus('布局计算中...');
    layout.start({
      type: 'layout',
      nodes: graph.nodes.map((n) => ({ layer: n.layer, fixed: n.fixed })),
      edges: graph.edges.map((e) => ({ source: e.source, target: e.target })),
      width: Math.max(400, w), height: Math.max(300, h),
      iterations: 300, seed: 1986,
    });
  } catch (err) {
    toast(`构建拓扑失败: ${err.message}`, 'error');
    setStatus('构建失败');
  }
}

// ---------- 全局异常兜底 ----------
window.addEventListener('error', (ev) => {
  toast(`未捕获异常: ${ev.message}`, 'error');
});
window.addEventListener('unhandledrejection', (ev) => {
  toast(`异步异常: ${ev.reason?.message || ev.reason}`, 'error');
});

// ---------- 控件 ----------
document.getElementById('btn-reset').addEventListener('click', () => resetFaults());
document.getElementById('btn-relayout').addEventListener('click', () => {
  for (const n of graph.nodes) n.fixed = false;
  build(graph.nodes.length);
});
document.getElementById('sel-size').addEventListener('change', (ev) => {
  build(Number(ev.target.value));
});
document.getElementById('chk-anim').addEventListener('change', (ev) => {
  anim.enabled = ev.target.checked;
  if (!anim.enabled) anim.clear();
});
window.addEventListener('resize', () => anim.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) anim.stop(); else anim.start();
});

build(Number(document.getElementById('sel-size').value));
anim.start();
