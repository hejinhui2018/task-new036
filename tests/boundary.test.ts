import { describe, expect, it } from 'vitest';
import { seedState } from '../src/state/seed';
import { detectConflicts } from '../src/domain/conflicts';
import { deriveMappings, findCycles, treeOrder } from '../src/domain/purposes';
import { applyMigrationDecisions, planMigration } from '../src/domain/migration';
import { ruleForRegion } from '../src/domain/rules';
import type { ConsentRecord, PolicyVersion } from '../src/types';

const NOW = 1_700_000_000_000;

const draft = (id: string, baseVersionId: string | null, purposes: PolicyVersion['purposes']): PolicyVersion => ({
  id,
  label: id,
  status: 'draft',
  baseVersionId,
  purposes,
  createdAt: 0,
  publishedAt: null,
});

describe('边界：冲突检测与定位', () => {
  it('地区不匹配：用户地区无规则时产生可定位冲突', () => {
    const conflicts = detectConflicts(seedState());
    const c = conflicts.find((x) => x.kind === 'region-mismatch');
    expect(c).toBeDefined();
    expect(c?.location.userId).toBe('u5');
    expect(c?.location.region).toBe('ATLANTIS');
  });

  it('循环引用：父链成环可被检测并定位到具体用途', () => {
    const state = seedState();
    const cyclic = draft('vc', null, [
      { id: 'a', key: 'a', name: 'A', parentId: 'b', derivedFrom: [] },
      { id: 'b', key: 'b', name: 'B', parentId: 'a', derivedFrom: [] },
    ]);
    const conflicts = detectConflicts({ ...state, versions: [...state.versions, cyclic] });
    const c = conflicts.find((x) => x.kind === 'circular-ref');
    expect(c).toBeDefined();
    expect(c?.location.versionId).toBe('vc');
    expect(new Set(c?.location.purposeIds)).toEqual(new Set(['a', 'b']));
    // 树展开在循环下也不会死循环
    expect(treeOrder(cyclic.purposes)).toHaveLength(2);
  });

  it('自引用也视为循环', () => {
    const purposes = [{ id: 'x', key: 'x', name: 'X', parentId: 'x', derivedFrom: [] }];
    expect(findCycles(purposes)).toEqual([['x']]);
  });

  it('版本分叉：同一基线出现两个已发布后继', () => {
    const state = seedState();
    const forkA: PolicyVersion = { ...draft('vf1', 'v1', []), status: 'published', publishedAt: NOW };
    const forkB: PolicyVersion = { ...draft('vf2', 'v1', []), status: 'published', publishedAt: NOW };
    const conflicts = detectConflicts({ ...state, versions: [...state.versions, forkA, forkB] });
    const forks = conflicts.filter((x) => x.kind === 'version-fork');
    expect(forks.length).toBe(2);
    expect(forks.map((f) => f.location.versionId).sort()).toEqual(['vf1', 'vf2']);
  });

  it('用途合并冲突：来源用途选择不一致时可定位到用户与用途', () => {
    const state = seedState();
    const v3 = draft('v3', 'v2', [
      { id: 'smart', key: 'smart', name: '智能体验', parentId: null, derivedFrom: ['analytics', 'personalization'] },
    ]);
    const records: ConsentRecord[] = [
      ...state.records,
      { userId: 'u1', versionId: 'v2', purposeId: 'analytics', status: 'granted', source: 'user', updatedAt: NOW },
      { userId: 'u1', versionId: 'v2', purposeId: 'personalization', status: 'denied', source: 'user', updatedAt: NOW },
    ];
    const conflicts = detectConflicts({ ...state, versions: [...state.versions, v3], records });
    const c = conflicts.find((x) => x.kind === 'purpose-merge');
    expect(c).toBeDefined();
    expect(c?.location.versionId).toBe('v3');
    expect(c?.location.purposeIds).toContain('smart');
    expect(c?.location.userId).toBe('u1');
  });

  it('合并来源一致时不产生合并冲突', () => {
    const state = seedState();
    const v3 = draft('v3', 'v2', [
      { id: 'smart', key: 'smart', name: '智能体验', parentId: null, derivedFrom: ['analytics', 'personalization'] },
    ]);
    const records: ConsentRecord[] = [
      ...state.records,
      { userId: 'u1', versionId: 'v2', purposeId: 'analytics', status: 'granted', source: 'user', updatedAt: NOW },
      { userId: 'u1', versionId: 'v2', purposeId: 'personalization', status: 'granted', source: 'user', updatedAt: NOW },
    ];
    const conflicts = detectConflicts({ ...state, versions: [...state.versions, v3], records });
    expect(conflicts.filter((x) => x.kind === 'purpose-merge')).toHaveLength(0);
  });
});

describe('边界：空数据与缺省', () => {
  it('空用途版本：迁移只产生失效判定且不崩溃', () => {
    const state = seedState();
    const v1 = state.versions.find((v) => v.id === 'v1')!;
    const empty = draft('vempty', 'v1', []);
    const user = state.users.find((u) => u.id === 'u1')!;
    const ds = planMigration({
      user,
      fromVersion: v1,
      toVersion: empty,
      records: state.records,
      rule: ruleForRegion(state.rules, user.region),
    });
    expect(ds).toHaveLength(2); // essential + exp 两条旧记录都失效
    expect(ds.every((d) => d.outcome === 'invalidated')).toBe(true);
    const next = applyMigrationDecisions(state.records, user.id, empty.id, ds, NOW);
    expect(next).toBe(state.records); // 没有可写入的
  });

  it('无任何记录的用户：全部按地区默认处理', () => {
    const state = seedState();
    const v1 = state.versions.find((v) => v.id === 'v1')!;
    const v2 = state.versions.find((v) => v.id === 'v2')!;
    const user = state.users.find((u) => u.id === 'u1')!;
    const ds = planMigration({
      user,
      fromVersion: v1,
      toVersion: v2,
      records: [],
      rule: ruleForRegion(state.rules, user.region),
    });
    const m = new Map(ds.map((d) => [d.purposeId, d]));
    // CN 为 opt-in：默认拒绝
    expect(m.get('essential')?.outcome).toBe('defaulted');
    expect(m.get('essential')?.status).toBe('denied');
    expect(m.get('analytics')?.outcome).toBe('defaulted');
    expect(m.get('analytics')?.status).toBe('denied');
  });

  it('derivedFrom 指向不存在的旧用途 → 视为新增', () => {
    const state = seedState();
    const v1 = state.versions.find((v) => v.id === 'v1')!;
    const ghost = draft('vg', 'v1', [
      { id: 'p1', key: 'p1', name: 'P1', parentId: null, derivedFrom: ['ghost-id'] },
    ]);
    const mappings = deriveMappings(ghost, v1);
    expect(mappings[0].kind).toBe('new');
    expect(mappings[0].sources).toEqual([]);
  });

  it('用途父级指向不存在的 id：树展开按顶级处理', () => {
    const purposes = [
      { id: 'a', key: 'a', name: 'A', parentId: 'missing', derivedFrom: [] },
      { id: 'b', key: 'b', name: 'B', parentId: 'a', derivedFrom: [] },
    ];
    const rows = treeOrder(purposes);
    expect(rows).toHaveLength(2);
    expect(rows[0].purpose.id).toBe('a');
    expect(rows[1].depth).toBe(1);
  });
});
