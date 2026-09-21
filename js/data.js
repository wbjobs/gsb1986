// 拓扑数据模型：确定性随机生成（固定种子 => 布局可复现、稳定）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 分层拓扑：core -> aggregation -> access -> host
export function generateTopology(nodeCount, seed = 1986) {
  if (!Number.isInteger(nodeCount) || nodeCount < 4 || nodeCount > 2000) {
    throw new Error(`节点数量非法: ${nodeCount}（允许 4 ~ 2000）`);
  }
  const rand = mulberry32(seed);
  const layers = [
    { type: 'core',   ratio: 0.05, r: 10 },
    { type: 'agg',    ratio: 0.20, r: 8 },
    { type: 'access', ratio: 0.45, r: 6 },
    { type: 'host',   ratio: 0.30, r: 4 },
  ];
  const nodes = [];
  const byLayer = [[], [], [], []];
  let remaining = nodeCount;
  layers.forEach((layer, li) => {
    const n = li === layers.length - 1 ? remaining : Math.max(1, Math.round(nodeCount * layer.ratio));
    remaining -= n;
    for (let i = 0; i < n; i++) {
      const node = {
        id: nodes.length,
        label: `${layer.type}-${i}`,
        type: layer.type,
        layer: li,
        radius: layer.r,
        x: 0, y: 0,
        fixed: false,
        state: 'normal', // normal | warn | fault
      };
      nodes.push(node);
      byLayer[li].push(node);
    }
  });

  const edges = [];
  const seen = new Set();
  const addEdge = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    edges.push({
      id: edges.length, source: a, target: b,
      delay: 300 + rand() * 900,        // 传播延迟 ms
      probability: 0.55 + rand() * 0.4, // 传播概率
      state: 'normal',
    });
  };
  // 相邻层连接（主干）
  for (let li = 1; li < byLayer.length; li++) {
    for (const node of byLayer[li]) {
      const parents = byLayer[li - 1];
      addEdge(parents[Math.floor(rand() * parents.length)].id, node.id);
      if (rand() < 0.25) addEdge(parents[Math.floor(rand() * parents.length)].id, node.id);
    }
  }
  // 同层少量互联
  for (const layerNodes of byLayer) {
    for (const node of layerNodes) {
      if (rand() < 0.08 && layerNodes.length > 1) {
        addEdge(node.id, layerNodes[Math.floor(rand() * layerNodes.length)].id);
      }
    }
  }
  // 连通性保障：core 层链式互联；每个父层节点至少连接一个下一层节点
  for (let i = 1; i < byLayer[0].length; i++) {
    addEdge(byLayer[0][i - 1].id, byLayer[0][i].id);
  }
  for (let li = 1; li < byLayer.length; li++) {
    for (const parent of byLayer[li - 1]) {
      const hasChild = edges.some((e) =>
        (e.source === parent.id && nodes[e.target].layer === li) ||
        (e.target === parent.id && nodes[e.source].layer === li));
      if (!hasChild) {
        const children = byLayer[li];
        addEdge(parent.id, children[Math.floor(rand() * children.length)].id);
      }
    }
  }

  const adjacency = nodes.map(() => []);
  for (const e of edges) {
    adjacency[e.source].push(e);
    adjacency[e.target].push(e);
  }
  return { nodes, edges, adjacency };
}
