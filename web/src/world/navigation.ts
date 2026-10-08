import type { NavGraph } from "../theme-engine/types";

type P = [number, number];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function nearestNode(graph: NavGraph, p: P): string {
  let best = "";
  let bestD = Infinity;
  for (const [id, n] of Object.entries(graph.nodes)) {
    const d = dist(n, p);
    if (d < bestD) (bestD = d), (best = id);
  }
  return best;
}

/** Shortest walk from `from` to `to` along the theme's path network (Dijkstra; graphs are tiny). */
export function route(graph: NavGraph, from: P, to: P): P[] {
  // Short hops don't need the path network.
  if (dist(from, to) < 3) return [to];
  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  if (!start || !goal) return [to];
  const adj = new Map<string, string[]>();
  for (const [a, b] of graph.edges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const d = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([start]);
  while (open.size) {
    let u = "";
    let du = Infinity;
    for (const n of open) if ((d.get(n) ?? Infinity) < du) (du = d.get(n)!), (u = n);
    open.delete(u);
    if (u === goal) break;
    for (const v of adj.get(u) ?? []) {
      const alt = du + dist(graph.nodes[u], graph.nodes[v]);
      if (alt < (d.get(v) ?? Infinity)) {
        d.set(v, alt);
        prev.set(v, u);
        open.add(v);
      }
    }
  }
  const ids: string[] = [];
  for (let n: string | undefined = goal; n; n = prev.get(n)) {
    ids.unshift(n);
    if (n === start) break;
  }
  if (ids[0] !== start) return [to]; // disconnected graph
  const path: P[] = ids.map((id) => graph.nodes[id]);
  // Skip the first node if we're already past it towards the second.
  if (path.length > 1 && dist(from, path[1]) < dist(path[0], path[1])) path.shift();
  path.push(to);
  return path;
}
