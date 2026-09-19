import type { DomainData, ID } from '../types';
import { deriveMappings, findCycles } from './purposes';
import { ruleForRegion } from './rules';

export type ConflictKind = 'version-fork' | 'purpose-merge' | 'circular-ref' | 'region-mismatch';

/** 冲突：携带可定位信息（版本/用途/用户/地区），UI 可跳转 */
export interface Conflict {
  id: string;
  kind: ConflictKind;
  title: string;
  detail: string;
  location: {
    versionId?: ID;
    purposeIds?: ID[];
    userId?: ID;
    region?: string;
  };
}

const MAX_CONFLICTS = 200;

/** 扫描全部领域数据，返回可定位的冲突列表 */
export function detectConflicts(state: DomainData): Conflict[] {
  const conflicts: Conflict[] = [];
  let seq = 0;
  const push = (c: Omit<Conflict, 'id'>) => {
    if (conflicts.length < MAX_CONFLICTS) conflicts.push({ ...c, id: `c${++seq}` });
  };

  // 1) 版本分叉：同一基线出现 ≥2 个已发布后继
  const publishedByBase = new Map<ID, typeof state.versions>();
  for (const v of state.versions) {
    if (v.status !== 'published' || !v.baseVersionId) continue;
    const arr = publishedByBase.get(v.baseVersionId) ?? [];
    arr.push(v);
    publishedByBase.set(v.baseVersionId, arr);
  }
  for (const [baseId, kids] of publishedByBase) {
    if (kids.length < 2) continue;
    const baseLabel = state.versions.find((v) => v.id === baseId)?.label ?? baseId;
    for (const kid of kids) {
      push({
        kind: 'version-fork',
        title: `版本分叉：「${baseLabel}」有 ${kids.length} 个已发布后继`,
        detail: `已发布后继：${kids.map((k) => `「${k.label}」`).join('、')}。同一基线分叉出多个发布版本，迁移来源将产生歧义。`,
        location: { versionId: kid.id },
      });
    }
  }

  // 2) 循环引用：用途父链成环
  for (const v of state.versions) {
    for (const cycle of findCycles(v.purposes)) {
      const names = cycle.map(
        (id) => v.purposes.find((p) => p.id === id)?.name ?? id,
      );
      push({
        kind: 'circular-ref',
        title: `循环引用：${names.join(' → ')} → ${names[0]}`,
        detail: `版本「${v.label}」中用途 ${names.map((n) => `「${n}」`).join('、')} 的父级关系构成循环，层级树无法确定上下游。`,
        location: { versionId: v.id, purposeIds: cycle },
      });
    }
  }

  // 3) 用途合并冲突：合并来源上用户的选择不一致
  for (const v of state.versions) {
    if (!v.baseVersionId) continue;
    const base = state.versions.find((x) => x.id === v.baseVersionId);
    if (!base) continue;
    for (const m of deriveMappings(v, base)) {
      if (m.kind !== 'merge') continue;
      const target = v.purposes.find((p) => p.id === m.purposeId);
      for (const user of state.users) {
        const statuses = m.sources.map(
          (s) =>
            state.records.find(
              (r) => r.userId === user.id && r.versionId === base.id && r.purposeId === s,
            )?.status ?? null,
        );
        const explicit = statuses.filter((s): s is 'granted' | 'denied' => s !== null);
        if (new Set(explicit).size < 2) continue;
        const rule = ruleForRegion(state.rules, user.region);
        const srcNames = m.sources.map(
          (s, i) => `「${base.purposes.find((p) => p.id === s)?.name ?? s}」=${statuses[i] === 'granted' ? '同意' : statuses[i] === 'denied' ? '拒绝' : '无记录'}`,
        );
        push({
          kind: 'purpose-merge',
          title: `用途合并冲突：「${target?.name ?? m.purposeId}」来源选择不一致`,
          detail: `用户 ${user.name}（${user.region}）在「${base.label}」对来源用途的选择不一致：${srcNames.join('，')}。合并后将按 ${user.region} 规则的「${rule?.mergeStrategy === 'any' ? '任一同意即继承' : '全部同意才继承'}」策略处理。`,
          location: { versionId: v.id, purposeIds: [m.purposeId], userId: user.id },
        });
      }
    }
  }

  // 4) 地区不匹配：用户所在地区没有对应规则
  for (const user of state.users) {
    if (ruleForRegion(state.rules, user.region)) continue;
    push({
      kind: 'region-mismatch',
      title: `地区不匹配：${user.name} 的地区「${user.region}」无规则`,
      detail: `用户 ${user.name} 所在地区「${user.region}」没有配置同意规则，迁移将被阻止，同意状态只能按最严格回退规则展示。`,
      location: { userId: user.id, region: user.region },
    });
  }

  const order: ConflictKind[] = ['version-fork', 'circular-ref', 'purpose-merge', 'region-mismatch'];
  return conflicts.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
