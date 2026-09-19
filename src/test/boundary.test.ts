import { describe, it, expect } from 'vitest';
import { applyMigration, applyWithdraw } from '../core/simulate';
import { planMigration } from '../core/migrate';
import { effectiveState } from '../core/consent';
import { data, mapping, purpose, record, region, user, version } from './fixtures';

describe('边界规则', () => {
  it('撤回用途组会展开到全部叶子，并级联各叶子的下游', () => {
    const v = version('v1', [
      purpose('g', { isGroup: true }),
      purpose('a', { parentId: 'g' }),
      purpose('b', { parentId: 'g' }),
      purpose('d_a', { dependsOn: ['a'] }),
      purpose('standalone'),
    ]);
    const d = data({
      versions: [v],
      regions: [region('CN', { mode: 'opt-out' })],
      users: [user('u1', 'CN')],
      records: [],
    });
    // opt-out 下默认全部允许；撤回整组 g
    const res = applyWithdraw(
      { data: d, userId: 'u1', versionId: 'v1', choices: {} },
      'g',
    );
    expect(res.state.a).toBe('denied');
    expect(res.state.b).toBe('denied');
    expect(res.state.d_a).toBe('denied'); // a 的下游也失效
    expect(res.state.standalone).toBe('granted'); // 组外用途不受影响
    expect(res.affected.sort()).toEqual(['a', 'b', 'd_a']);
    // 组本身不是叶子，不出现在状态里
    expect(res.state.g).toBeUndefined();
  });

  it('同版本「迁移」（from === to）：不产生分叉冲突，无记录时全部按地区默认', () => {
    const v = version('v1', [purpose('a'), purpose('b')]);
    const d = data({
      versions: [v],
      users: [user('u1', 'EU')],
      records: [],
    });
    const res = planMigration(d, 'u1', 'v1', 'v1');
    expect(res.conflicts.some((c) => c.code === 'version_fork')).toBe(false);
    expect(res.purposes.every((p) => p.status === 'default')).toBe(true);
    expect(res.purposes.every((p) => p.value === 'denied')).toBe(true); // EU opt-in
  });

  it('重复规划同一迁移：纯函数结果确定（幂等）', () => {
    const v1 = version('v1', [purpose('a_old')]);
    const v2 = version('v2', [purpose('a'), purpose('new_p')], { sequence: 2, parentVersionId: 'v1' });
    const d = data({
      versions: [v1, v2],
      mappings: [mapping('v1', 'v2', 'a_old', 'a')],
      records: [record('u1', 'v1', 'EU', { a_old: 'granted' })],
    });
    const first = planMigration(d, 'u1', 'v1', 'v2');
    const second = planMigration(d, 'u1', 'v1', 'v2');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.reconfirmPurposeIds).toEqual(['new_p']);
  });

  it('重复执行迁移与撤回后再执行迁移：原始数据不被演练污染', () => {
    const v1 = version('v1', [purpose('a_old')]);
    const v2 = version('v2', [purpose('a')], { sequence: 2, parentVersionId: 'v1' });
    const d = data({
      versions: [v1, v2],
      mappings: [mapping('v1', 'v2', 'a_old', 'a')],
      records: [record('u1', 'v1', 'EU', { a_old: 'granted' })],
    });
    const recordsBefore = d.records.length;
    applyMigration(d, 'u1', 'v1', 'v2');
    applyMigration(d, 'u1', 'v1', 'v2');
    expect(d.records).toHaveLength(recordsBefore); // 演练不写正式记录
    expect(d.records[0].choices).toEqual({ a_old: 'granted' });
  });

  it('一个旧用途拆分到多个新用途：拒绝旧用途时所有拆分目标都拒绝，且不产生合并冲突', () => {
    const v1 = version('v1', [purpose('exp')]);
    const v2 = version('v2', [purpose('analytics'), purpose('personalization')], {
      sequence: 2,
      parentVersionId: 'v1',
    });
    const d = data({
      versions: [v1, v2],
      mappings: [
        mapping('v1', 'v2', 'exp', 'analytics'),
        mapping('v1', 'v2', 'exp', 'personalization'),
      ],
      records: [record('u1', 'v1', 'EU', { exp: 'denied' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    for (const id of ['analytics', 'personalization']) {
      const p = res.purposes.find((x) => x.purposeId === id)!;
      expect(p.value).toBe('denied');
      expect(p.status).toBe('inherited');
    }
    expect(res.conflicts.some((c) => c.code === 'merge_conflict')).toBe(false);
  });

  it('opt-in 下用户什么都没勾：迁移后映射用途不继承（拒绝不来自显式选择），但不产生新冲突', () => {
    const v1 = version('v1', [purpose('a_old')]);
    const v2 = version('v2', [purpose('a')], { sequence: 2, parentVersionId: 'v1' });
    const d = data({
      versions: [v1, v2],
      mappings: [mapping('v1', 'v2', 'a_old', 'a')],
      users: [user('u1', 'EU')],
      records: [record('u1', 'v1', 'EU', {})],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    const a = res.purposes.find((x) => x.purposeId === 'a')!;
    expect(a.value).toBe('denied');
    expect(a.explicit).toBe(false);
  });

  it('禁止地区的用途即便显式勾选也不生效', () => {
    const v = version('v1', [purpose('a')]);
    const d = data({
      versions: [v],
      regions: [region('EU', { prohibitedPurposeIds: ['a'] })],
      users: [user('u1', 'EU')],
      records: [],
    });
    // 直接在引擎层验证：显式 granted 也被地区规则压成 denied 并给冲突
    const eff = effectiveState(v, { a: 'granted' }, d.regions[0], 'EU');
    expect(eff.values.a).toBe('denied');
    expect(eff.conflicts.some((c) => c.code === 'region_mismatch')).toBe(true);
  });
});
