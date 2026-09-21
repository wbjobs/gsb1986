// 运行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTopology, mulberry32 } from '../js/data.js';
import { PropagationEngine } from '../js/propagation.js';

test('拓扑生成: 数量正确、边引用合法、图连通', () => {
  const g = generateTopology(80);
  assert.equal(g.nodes.length, 80);
  assert.ok(g.edges.length > 0);
  for (const e of g.edges) {
    assert.ok(g.nodes[e.source] && g.nodes[e.target], '边端点必须存在');
    assert.ok(e.probability > 0 && e.probability <= 1);
    assert.ok(e.delay > 0);
  }
  // BFS 连通性
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const id = q.shift();
    for (const e of g.adjacency[id]) {
      const nb = e.source === id ? e.target : e.source;
      if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  assert.equal(seen.size, g.nodes.length, '拓扑必须连通');
});

test('拓扑生成: 相同种子结果一致（布局稳定的前提）', () => {
  const a = generateTopology(50, 42);
  const b = generateTopology(50, 42);
  assert.deepEqual(a.edges.map((e) => [e.source, e.target]), b.edges.map((e) => [e.source, e.target]));
});

test('拓扑生成: 非法节点数抛异常', () => {
  assert.throws(() => generateTopology(1), /节点数量非法/);
  assert.throws(() => generateTopology(99999), /节点数量非法/);
});

test('传播计划: 源节点 t=0 故障，事件时间单调不减', () => {
  const g = generateTopology(60);
  const eng = new PropagationEngine(g, { rand: mulberry32(7) });
  const events = eng.plan(0);
  assert.ok(events.length > 0);
  assert.deepEqual(events[0], { type: 'node', nodeId: 0, state: 'fault', time: 0 });
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].time >= events[i - 1].time, '事件时间必须单调');
  }
});

test('传播计划: 故障只沿边到达邻居，状态迁移合法', () => {
  const g = generateTopology(80);
  const eng = new PropagationEngine(g, { rand: mulberry32(99) });
  const events = eng.plan(3);
  const nodeState = new Map();
  const edgeState = new Map();
  const legalNode = { normal: ['warn'], warn: ['fault'], fault: [] };
  const legalEdge = { normal: ['warn'], warn: ['fault', 'normal'], fault: [] };
  for (const n of g.nodes) nodeState.set(n.id, 'normal');
  for (const e of g.edges) edgeState.set(e.id, 'normal');
  nodeState.set(3, 'fault'); // 源直接故障

  for (const evt of events) {
    if (evt.type === 'node') {
      if (evt.nodeId === 3 && evt.time === 0) continue;
      const cur = nodeState.get(evt.nodeId);
      assert.ok(legalNode[cur].includes(evt.state), `节点状态迁移非法: ${cur} -> ${evt.state}`);
      nodeState.set(evt.nodeId, evt.state);
    } else if (evt.type === 'edge') {
      const cur = edgeState.get(evt.edgeId);
      assert.ok(legalEdge[cur].includes(evt.state), `边状态迁移非法: ${cur} -> ${evt.state}`);
      edgeState.set(evt.edgeId, evt.state);
    }
  }
});

test('传播计划: 概率为 0 时故障不扩散', () => {
  const g = generateTopology(40);
  for (const e of g.edges) e.probability = 0;
  const eng = new PropagationEngine(g, { rand: () => 0.999 });
  const events = eng.plan(0);
  const faulted = new Set(events.filter((e) => e.type === 'node' && e.state === 'fault').map((e) => e.nodeId));
  assert.deepEqual([...faulted], [0], '只有源节点故障');
});

test('传播计划: 概率为 1 时故障可达全部连通节点', () => {
  const g = generateTopology(40);
  for (const e of g.edges) e.probability = 1;
  const eng = new PropagationEngine(g, { rand: () => 0 });
  const events = eng.plan(0);
  const faulted = new Set(events.filter((e) => e.type === 'node' && e.state === 'fault').map((e) => e.nodeId));
  assert.equal(faulted.size, g.nodes.length, '连通图上所有节点最终故障');
});

test('传播计划: 非法源节点抛异常', () => {
  const g = generateTopology(10);
  const eng = new PropagationEngine(g);
  assert.throws(() => eng.plan(999), /故障源节点不存在/);
});
