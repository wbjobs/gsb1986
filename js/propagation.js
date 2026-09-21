import { createRng } from './rng.js';
import { buildAdjacency } from './graph.js';

// 故障传播引擎：离散事件模拟。
// 从源节点出发，沿边按 (延迟, 概率) 传播，输出完整时间线：
//   events: [{ time, nodeId, edgeId|null }]  节点故障事件（按时间升序）
//   pulses: [{ edgeId, from, to, t0, t1 }]   边上的传播脉冲（用于动画）
// 给定相同 seed，结果完全可复现（正确性可测试）。
export function simulatePropagation(graph, sourceId, seed = 7) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!ids.has(sourceId)) throw new Error(`故障源节点不存在: ${sourceId}`);

  const rng = createRng(seed);
  const adj = buildAdjacency(graph);
  const events = [{ time: 0, nodeId: sourceId, edgeId: null }];
  const pulses = [];
  const faulted = new Set([sourceId]);
  const scheduled = new Set([sourceId]);

  // 最小堆按时间弹出，保证全局时间顺序正确
  const heap = [{ time: 0, nodeId: sourceId, edgeId: null }];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].time <= heap[i].time) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].time < heap[m].time) m = l;
        if (r < heap.length && heap[r].time < heap[m].time) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const { time, nodeId } = pop();
    for (const { to, edge } of adj.get(nodeId)) {
      if (scheduled.has(to)) continue;
      if (rng() >= edge.probability) continue; // 该边未传播
      scheduled.add(to);
      const t1 = time + edge.delay;
      pulses.push({ edgeId: edge.id, from: nodeId, to, t0: time, t1 });
      push({ time: t1, nodeId: to, edgeId: edge.id });
      events.push({ time: t1, nodeId: to, edgeId: edge.id });
      faulted.add(to);
    }
  }
  events.sort((a, b) => a.time - b.time);
  const duration = events.length ? events[events.length - 1].time : 0;
  return { events, pulses, duration, faulted };
}

// 查询任意时刻各节点状态：0正常 1预警(已被调度未爆发) 2故障
export function statesAt(timeline, t) {
  const state = new Map();
  for (const p of timeline.pulses) {
    if (t >= p.t0 && t < p.t1) state.set(p.to, 1);
  }
  for (const e of timeline.events) {
    if (e.time <= t) state.set(e.nodeId, 2);
  }
  return state;
}
