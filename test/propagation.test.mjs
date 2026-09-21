// 运行: node test/propagation.test.mjs
import assert from 'node:assert/strict';
import { generateGraph, validateGraph, buildAdjacency } from '../js/graph.js';
import { simulatePropagation, statesAt } from '../js/propagation.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

const graph = validateGraph(generateGraph(300, 42));

test('图生成：连通且节点数正确', () => {
  assert.equal(graph.nodes.length, 300);
  // BFS 验证连通
  const adj = buildAdjacency(graph);
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    for (const { to } of adj.get(q.shift())) {
      if (!seen.has(to)) { seen.add(to); q.push(to); }
    }
  }
  assert.equal(seen.size, 300);
});

test('传播：相同 seed 结果完全可复现', () => {
  const a = simulatePropagation(graph, 5, 7);
  const b = simulatePropagation(graph, 5, 7);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.pulses, b.pulses);
});

test('传播：事件时间严格递增且不超过 duration', () => {
  const { events, duration } = simulatePropagation(graph, 5, 7);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].time >= events[i - 1].time, '时间必须单调不减');
  }
  assert.equal(events.at(-1).time, duration);
});

test('传播：每个节点最多故障一次，源节点 t=0', () => {
  const { events } = simulatePropagation(graph, 5, 7);
  const ids = events.map((e) => e.nodeId);
  assert.equal(new Set(ids).size, ids.length, '节点不能重复故障');
  assert.equal(events[0].nodeId, 5);
  assert.equal(events[0].time, 0);
});

test('传播：概率=1 时所有可达节点全部故障', () => {
  const g = generateGraph(200, 1);
  for (const e of g.edges) e.probability = 1;
  const { faulted } = simulatePropagation(g, 0, 7);
  assert.equal(faulted.size, 200);
});

test('传播：概率=0 时只有源节点故障', () => {
  const g = generateGraph(100, 1);
  for (const e of g.edges) e.probability = 0;
  const { faulted, events } = simulatePropagation(g, 0, 7);
  assert.equal(faulted.size, 1);
  assert.equal(events.length, 1);
});

test('传播：脉冲时间区间与事件一致', () => {
  const { events, pulses } = simulatePropagation(graph, 5, 7);
  const eventByNode = new Map(events.map((e) => [e.nodeId, e.time]));
  for (const p of pulses) {
    assert.ok(p.t1 > p.t0, '脉冲结束必须晚于开始');
    assert.equal(eventByNode.get(p.to), p.t1, '脉冲到达时刻应等于节点故障时刻');
  }
});

test('状态查询：t<0 全部正常，t>=duration 全部故障/无预警', () => {
  const tl = simulatePropagation(graph, 5, 7);
  const before = statesAt(tl, -1);
  assert.equal(before.size, 0);
  const after = statesAt(tl, tl.duration + 1);
  for (const [, s] of after) assert.equal(s, 2, '结束后不应有预警态');
  assert.equal(after.size, tl.faulted.size);
});

test('异常：源节点不存在时抛出错误', () => {
  assert.throws(() => simulatePropagation(graph, 9999, 7), /不存在/);
});

test('异常：非法图数据被拒绝', () => {
  assert.throws(() => validateGraph({ nodes: [], edges: [{ id: 0, source: 1, target: 2, probability: 0.5 }] }), /不存在/);
  assert.throws(() => generateGraph(1), /非法/);
});

test('性能：1500 节点传播模拟 < 500ms', () => {
  const big = generateGraph(1500, 9);
  const t0 = performance.now();
  simulatePropagation(big, 0, 7);
  const cost = performance.now() - t0;
  console.log(`    (耗时 ${cost.toFixed(1)}ms)`);
  assert.ok(cost < 500, `模拟耗时 ${cost.toFixed(0)}ms 超限`);
});

console.log(`\n${passed} 项测试通过`);
