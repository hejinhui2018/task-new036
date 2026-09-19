import type { Conflict, Purpose, PurposeId, VersionId } from './types';

/** 版本内用途索引 */
export function purposeMap(purposes: Purpose[]): Map<PurposeId, Purpose> {
  return new Map(purposes.map((p) => [p.id, p]));
}

/** 叶子用途：没有子用途且未被标记为用途组。同意只挂在叶子上。 */
export function leafPurposes(purposes: Purpose[]): Purpose[] {
  const hasChild = new Set<PurposeId>();
  for (const p of purposes) {
    if (p.parentId) hasChild.add(p.parentId);
  }
  return purposes.filter((p) => !p.isGroup && !hasChild.has(p.id));
}

/** 一个节点的全部出边：层级子节点 + 显式依赖的下游用途 */
export function outgoingEdges(p: Purpose, purposes: Purpose[]): PurposeId[] {
  const byParent = purposes.filter((c) => c.parentId === p.id).map((c) => c.id);
  return Array.from(new Set([...byParent, ...(p.dependsOn ?? [])]));
}

/**
 * 在用途图中寻找环（合并层级边与下游依赖边）。
 * 返回首个环上的节点路径（首尾相同），无环返回 null。
 */
export function findPurposeCycle(purposes: Purpose[]): PurposeId[] | null {
  const adj = new Map<PurposeId, PurposeId[]>();
  for (const p of purposes) adj.set(p.id, outgoingEdges(p, purposes));

  const state = new Map<PurposeId, 0 | 1 | 2>(); // 0=未访问 1=在栈中 2=完成
  const stack: PurposeId[] = [];

  const dfs = (node: PurposeId): PurposeId[] | null => {
    state.set(node, 1);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (!adj.has(next)) continue; // 悬空引用交给别处报错
      const s = state.get(next) ?? 0;
      if (s === 1) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (s === 0) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };

  for (const id of adj.keys()) {
    if ((state.get(id) ?? 0) === 0) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 某用途的全部下游用途（反向沿 dependsOn 边的传递闭包）：
 * 即直接或间接「依赖本用途」的用途。撤回上游用途时，这些下游用途一并失去授权来源。
 */
export function downstreamClosure(
  purposes: Purpose[],
  rootId: PurposeId,
): { id: PurposeId; path: PurposeId[] }[] {
  // 先构建反向边：upstream -> 依赖它的用途集合（组展开为叶子）
  const dependents = new Map<PurposeId, Set<PurposeId>>();
  for (const p of purposes) {
    for (const dep of p.dependsOn ?? []) {
      for (const upstream of expandToLeaves(purposes, dep)) {
        const set = dependents.get(upstream) ?? new Set<PurposeId>();
        for (const leaf of expandToLeaves(purposes, p.id)) set.add(leaf);
        dependents.set(upstream, set);
      }
    }
  }

  const result: { id: PurposeId; path: PurposeId[] }[] = [];
  const seen = new Set<PurposeId>();

  const walk = (id: PurposeId, path: PurposeId[]) => {
    for (const dep of dependents.get(id) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const nextPath = [...path, dep];
      result.push({ id: dep, path: nextPath });
      walk(dep, nextPath);
    }
  };
  walk(rootId, [rootId]);
  return result;
}

/** 用途树上的祖先链（用于展示「组 > 子用途」面包屑）。 */
export function ancestorChain(purposes: Purpose[], id: PurposeId): Purpose[] {
  const byId = purposeMap(purposes);
  const chain: Purpose[] = [];
  let cur = byId.get(id);
  const guard = new Set<PurposeId>();
  while (cur?.parentId && byId.has(cur.parentId) && !guard.has(cur.id)) {
    guard.add(cur.id);
    cur = byId.get(cur.parentId);
    if (cur) chain.unshift(cur);
  }
  return chain;
}

/** 若 id 是用途组，展开为其下全部叶子；若是叶子则返回自身。 */
export function expandToLeaves(purposes: Purpose[], id: PurposeId): PurposeId[] {
  const byId = purposeMap(purposes);
  const node = byId.get(id);
  if (!node) return [];
  if (!node.isGroup) return [id];
  const leaves = new Set(leafPurposes(purposes).map((p) => p.id));
  const out: PurposeId[] = [];
  const walk = (cur: PurposeId) => {
    const curNode = byId.get(cur);
    if (!curNode) return;
    if (leaves.has(cur)) {
      out.push(cur);
      return;
    }
    for (const child of purposes.filter((p) => p.parentId === cur)) {
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

// ---------- 版本间映射图 ---------- //

export interface MappingEdge {
  mappingId: string;
  node: string; // `${versionId}:${purposeId}`
}

export function mappingNode(versionId: VersionId, purposeId: PurposeId): string {
  return `${versionId}::${purposeId}`;
}

/**
 * 在跨版本映射图中寻找环。
 * 例如 v1.a -> v2.b 与 v2.b -> v1.a 同时存在即为循环引用。
 */
export function findMappingCycle(
  mappings: {
    id: string;
    fromVersionId: VersionId;
    sourcePurposeId: PurposeId;
    toVersionId: VersionId;
    targetPurposeId: PurposeId;
  }[],
): { path: string[]; mappingIds: string[] } | null {
  const adj = new Map<string, { to: string; mappingId: string }[]>();
  for (const m of mappings) {
    const from = mappingNode(m.fromVersionId, m.sourcePurposeId);
    const to = mappingNode(m.toVersionId, m.targetPurposeId);
    const list = adj.get(from) ?? [];
    list.push({ to, mappingId: m.id });
    adj.set(from, list);
    if (!adj.has(to)) adj.set(to, []);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const edgeStack: string[] = [];

  const dfs = (node: string): { path: string[]; mappingIds: string[] } | null => {
    state.set(node, 1);
    stack.push(node);
    for (const { to, mappingId } of adj.get(node) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 1) {
        const start = stack.indexOf(to);
        return {
          path: [...stack.slice(start), to],
          mappingIds: [...edgeStack.slice(start), mappingId],
        };
      }
      if (s === 0) {
        edgeStack.push(mappingId);
        const found = dfs(to);
        if (found) return found;
        edgeStack.pop();
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      const found = dfs(node);
      if (found) return found;
    }
  }
  return null;
}

/** 快速构造一个用途环冲突（位置可定位）。 */
export function purposeCycleConflict(
  versionId: VersionId,
  path: PurposeId[],
): Conflict {
  return {
    code: 'purpose_cycle',
    message: `用途依赖存在循环引用：${path.join(' → ')}。撤回级联与继承计算要求用途图无环。`,
    location: { versionId, path },
  };
}
