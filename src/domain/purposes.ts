import type { ID, PolicyVersion, Purpose } from '../types';

export type MappingKind = 'carry' | 'rename' | 'split' | 'merge' | 'new';

/** 新版本中单个用途相对基线版本的映射关系（由 derivedFrom 推导，不单独存储） */
export interface PurposeMapping {
  purposeId: ID;
  kind: MappingKind;
  /** 基线版本中的来源用途 id（已过滤掉无效引用） */
  sources: ID[];
}

/**
 * 由 derivedFrom 推导映射类型：
 * - 无有效来源 → new（新增）
 * - 多个来源 → merge（合并）
 * - 同一来源被多个新用途引用 → split（拆分）
 * - 单一来源且 key 不变 → carry（继承）；key 变化 → rename（更名）
 */
export function deriveMappings(version: PolicyVersion, base: PolicyVersion): PurposeMapping[] {
  const baseIds = new Set(base.purposes.map((p) => p.id));
  const sourceUseCount = new Map<ID, number>();
  for (const p of version.purposes) {
    for (const s of p.derivedFrom) {
      if (!baseIds.has(s)) continue;
      sourceUseCount.set(s, (sourceUseCount.get(s) ?? 0) + 1);
    }
  }
  return version.purposes.map((p) => {
    const sources = p.derivedFrom.filter((s) => baseIds.has(s));
    let kind: MappingKind;
    if (sources.length === 0) {
      kind = 'new';
    } else if (sources.length > 1) {
      kind = 'merge';
    } else if ((sourceUseCount.get(sources[0]) ?? 0) > 1) {
      kind = 'split';
    } else {
      const src = base.purposes.find((b) => b.id === sources[0]);
      kind = src && src.key === p.key ? 'carry' : 'rename';
    }
    return { purposeId: p.id, kind, sources };
  });
}

/** 基线版本中未被任何新用途引用的用途（迁移时将失效） */
export function removedPurposes(version: PolicyVersion, base: PolicyVersion): Purpose[] {
  const referenced = new Set<ID>();
  for (const p of version.purposes) {
    for (const s of p.derivedFrom) referenced.add(s);
  }
  return base.purposes.filter((p) => !referenced.has(p.id));
}

/** 用途的全部下游（子孙）用途 id，循环安全 */
export function descendantsOf(purposes: Purpose[], id: ID): ID[] {
  const children = new Map<ID, ID[]>();
  for (const p of purposes) {
    if (!p.parentId) continue;
    const arr = children.get(p.parentId) ?? [];
    arr.push(p.id);
    children.set(p.parentId, arr);
  }
  const out: ID[] = [];
  const seen = new Set<ID>([id]);
  const queue: ID[] = [id];
  while (queue.length > 0) {
    const cur = queue.shift() as ID;
    for (const c of children.get(cur) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** 检测父链中的循环引用，返回成环的用途 id 组（每组一个环） */
export function findCycles(purposes: Purpose[]): ID[][] {
  const parent = new Map<ID, ID | null>(purposes.map((p) => [p.id, p.parentId]));
  const state = new Map<ID, 1 | 2>(); // 1=在当前路径上 2=已完成
  const cycles: ID[][] = [];
  for (const p of purposes) {
    if (state.has(p.id)) continue;
    const path: ID[] = [];
    let cur: ID | null = p.id;
    while (cur !== null && parent.has(cur) && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== null && state.get(cur) === 1) {
      cycles.push(path.slice(path.indexOf(cur)));
    }
    for (const id of path) state.set(id, 2);
  }
  return cycles;
}

/** 按树的先序（带深度）展开用途，用于 UI 缩进渲染；循环与悬空引用安全 */
export function treeOrder(purposes: Purpose[]): { purpose: Purpose; depth: number }[] {
  const ids = new Set(purposes.map((p) => p.id));
  const byParent = new Map<ID | null, Purpose[]>();
  for (const p of purposes) {
    const parent = p.parentId && p.parentId !== p.id && ids.has(p.parentId) ? p.parentId : null;
    const arr = byParent.get(parent) ?? [];
    arr.push(p);
    byParent.set(parent, arr);
  }
  const out: { purpose: Purpose; depth: number }[] = [];
  const visited = new Set<ID>();
  const walk = (parentId: ID | null, depth: number) => {
    for (const p of byParent.get(parentId) ?? []) {
      if (visited.has(p.id)) continue;
      visited.add(p.id);
      out.push({ purpose: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  // 环上的用途没有根可达，追加到末尾保证可见
  for (const p of purposes) {
    if (visited.has(p.id)) continue;
    visited.add(p.id);
    out.push({ purpose: p, depth: 0 });
    walk(p.id, 1);
  }
  return out;
}
