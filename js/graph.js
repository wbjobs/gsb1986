import { createRng } from './rng.js';

// 生成连通随机拓扑：先随机树保证连通，再补随机边
export function generateGraph(nodeCount, seed = 42) {
  if (!Number.isInteger(nodeCount) || nodeCount < 2 || nodeCount > 5000) {
    throw new Error(`节点数量非法: ${nodeCount}（需在 2~5000 之间）`);
  }
  const rng = createRng(seed);
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({ id: i, name: `N${i}`, state: 0 }); // 0正常 1预警 2故障
  }
  const edges = [];
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const seen = new Set();
  const addEdge = (a, b) => {
    if (a === b || seen.has(key(a, b))) return false;
    seen.add(key(a, b));
    edges.push({
      id: edges.length,
      source: a,
      target: b,
      delay: 200 + Math.floor(rng() * 800),   // 传播延迟 ms
      probability: 0.55 + rng() * 0.45,        // 传播概率
    });
    return true;
  };
  // 随机树（连通骨架）
  for (let i = 1; i < nodeCount; i++) addEdge(i, Math.floor(rng() * i));
  // 补充冗余边，模拟真实网络
  const extra = Math.floor(nodeCount * 0.6);
  for (let i = 0; i < extra; i++) {
    addEdge(Math.floor(rng() * nodeCount), Math.floor(rng() * nodeCount));
  }
  return { nodes, edges };
}

// 数据校验，异常时抛出带说明的错误
export function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('拓扑数据格式错误：缺少 nodes/edges 数组');
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) throw new Error('拓扑数据错误：节点 id 重复');
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new Error(`边 ${e.id} 引用了不存在的节点`);
    }
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new Error(`边 ${e.id} 传播概率越界: ${e.probability}`);
    }
  }
  return graph;
}

// 邻接表（无向）
export function buildAdjacency(graph) {
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    adj.get(e.source).push({ to: e.target, edge: e });
    adj.get(e.target).push({ to: e.source, edge: e });
  }
  return adj;
}
