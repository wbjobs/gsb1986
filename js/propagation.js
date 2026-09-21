// 故障传播引擎：从故障源出发沿边 BFS，按边延迟/概率调度传播事件
// 事件: { type:'node', nodeId, state, time } / { type:'edge', edgeId, state, time }
export class PropagationEngine {
  constructor(graph, { rand = Math.random } = {}) {
    this.graph = graph; // { nodes, edges, adjacency }
    this.rand = rand;
    this.timers = [];
    this.listeners = new Set();
    this.running = false;
  }

  onEvent(fn) { this.listeners.add(fn); }
  _emit(evt) { for (const fn of this.listeners) fn(evt); }

  // 预计算完整传播计划（可测试、可校验正确性）
  plan(sourceId) {
    const { nodes, adjacency } = this.graph;
    if (!nodes[sourceId]) throw new Error(`故障源节点不存在: ${sourceId}`);
    const events = [];
    const nodeState = new Map([[sourceId, 'fault']]);
    const edgeDone = new Set();
    const queue = [{ id: sourceId, time: 0 }];
    events.push({ type: 'node', nodeId: sourceId, state: 'fault', time: 0 });

    while (queue.length) {
      queue.sort((a, b) => a.time - b.time);
      const { id, time } = queue.shift();
      for (const edge of adjacency[id]) {
        if (edgeDone.has(edge.id)) continue;
        edgeDone.add(edge.id);
        const neighbor = edge.source === id ? edge.target : edge.source;
        if (nodeState.get(neighbor) === 'fault') continue;
        const arrive = time + edge.delay;
        events.push({ type: 'edge', edgeId: edge.id, state: 'warn', time });
        if (this.rand() < edge.probability) {
          events.push({ type: 'edge', edgeId: edge.id, state: 'fault', time: arrive });
          if (!nodeState.has(neighbor)) {
            nodeState.set(neighbor, 'warn');
            events.push({ type: 'node', nodeId: neighbor, state: 'warn', time: arrive });
            events.push({ type: 'node', nodeId: neighbor, state: 'fault', time: arrive + 400 });
            nodeState.set(neighbor, 'fault');
            queue.push({ id: neighbor, time: arrive + 400 });
          }
        } else {
          events.push({ type: 'edge', edgeId: edge.id, state: 'normal', time: arrive });
        }
      }
    }
    events.sort((a, b) => a.time - b.time);
    return events;
  }

  // 按计划调度执行，实时发出事件
  start(sourceId) {
    this.stop();
    const events = this.plan(sourceId);
    this.running = true;
    const t0 = performance.now();
    for (const evt of events) {
      const timer = setTimeout(() => {
        if (!this.running) return;
        try {
          this._emit(evt);
        } catch (err) {
          this._emit({ type: 'error', message: `传播事件处理失败: ${err.message}` });
        }
      }, evt.time);
      this.timers.push(timer);
    }
    const total = events.length ? events[events.length - 1].time : 0;
    this.timers.push(setTimeout(() => {
      this.running = false;
      this._emit({ type: 'done', duration: total });
    }, total + 50));
    return events.length;
  }

  stop() {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
