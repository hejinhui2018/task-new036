import { describe, it, expect } from 'vitest';
import { applyGrant, applyMigration, applyWithdraw } from '../core/simulate';
import { planMigration } from '../core/migrate';
import { data, mapping, purpose, record, region, user, version } from './fixtures';

function scenario() {
  // v2: a, b ; c 依赖 a；d 独立
  const v1 = version('v1', [purpose('a_old'), purpose('b_old')]);
  const v2 = version('v2', [
    purpose('a'),
    purpose('b'),
    purpose('c', { dependsOn: ['a'] }),
    purpose('d'),
  ], { sequence: 2, parentVersionId: 'v1' });
  const d = data({
    versions: [v1, v2],
    mappings: [
      mapping('v1', 'v2', 'a_old', 'a'),
      mapping('v1', 'v2', 'b_old', 'b'),
    ],
    regions: [region('EU'), region('CN', { mode: 'opt-out' })],
    users: [user('u1', 'EU'), user('u2', 'CN')],
    records: [record('u1', 'v1', 'EU', { a_old: 'granted', b_old: 'granted' })],
  });
  return d;
}

describe('演练：迁移落盘', () => {
  it('迁移后显式继承的选择进入会话，待确认用途被暂停', () => {
    const d = scenario();
    const migration = planMigration(d, 'u1', 'v1', 'v2');
    expect(migration.reconfirmPurposeIds.sort()).toEqual(['c', 'd']);

    const applied = applyMigration(d, 'u1', 'v1', 'v2');
    expect(applied.choices.a).toBe('granted');
    expect(applied.choices.b).toBe('granted');
    // c/d 没有显式勾选，避免把默认/推断冻结
    expect(applied.choices.c).toBeUndefined();
    expect(applied.choices.d).toBeUndefined();
    expect(applied.unconfirmed.sort()).toEqual(['c', 'd']);
    expect(applied.event.type).toBe('migrate');
  });
});

describe('演练：部分撤回与下游级联', () => {
  it('撤回上游 a 后下游 c 一并失效（c 未被显式拒绝）', () => {
    const d = scenario();
    const m = applyMigration(d, 'u1', 'v1', 'v2');
    // 用户先重新确认 c（此时 a 已授权，c 可生效）
    const confirmed = applyGrant(
      { data: d, userId: 'u1', versionId: 'v2', choices: m.choices, unconfirmed: m.unconfirmed },
      'c',
    );
    expect(confirmed.state.c).toBe('granted');
    expect(confirmed.unconfirmed).not.toContain('c');

    // 撤回 a：c 失去唯一上游而失效；affected 同时包含 a 与 c
    const withdrawn = applyWithdraw(
      { data: d, userId: 'u1', versionId: 'v2', choices: confirmed.choices, unconfirmed: confirmed.unconfirmed },
      'a',
    );
    expect(withdrawn.state.a).toBe('denied');
    expect(withdrawn.state.c).toBe('denied');
    expect(withdrawn.affected).toContain('a');
    expect(withdrawn.affected).toContain('c');
    // c 曾被用户显式确认，勾选记录保留为 granted；但失去上游后有效值必须为 denied
    expect(withdrawn.choices.c).toBe('granted');
    expect(withdrawn.state.c).toBe('denied');
    expect(withdrawn.event.type).toBe('withdraw');
  });

  it('重新授予上游后，未被显式拒绝的下游自动恢复', () => {
    const d = scenario();
    const m = applyMigration(d, 'u1', 'v1', 'v2');
    const confirmed = applyGrant(
      { data: d, userId: 'u1', versionId: 'v2', choices: m.choices, unconfirmed: m.unconfirmed },
      'c',
    );
    const withdrawn = applyWithdraw(
      { data: d, userId: 'u1', versionId: 'v2', choices: confirmed.choices, unconfirmed: confirmed.unconfirmed },
      'a',
    );
    expect(withdrawn.state.c).toBe('denied');

    const reGranted = applyGrant(
      { data: d, userId: 'u1', versionId: 'v2', choices: withdrawn.choices, unconfirmed: withdrawn.unconfirmed },
      'a',
    );
    expect(reGranted.state.a).toBe('granted');
    expect(reGranted.state.c).toBe('granted');
  });

  it('opt-out 地区撤回独立用途后不会被默认值“弹回”', () => {
    const d = scenario();
    // u2(CN) 没有任何记录；先在 v2 上以空勾选开始（等价默认状态）
    const input = { data: d, userId: 'u2', versionId: 'v2', choices: {} as Record<string, 'granted' | 'denied'> };
    expect(input).toBeDefined();
    const wd = applyWithdraw(input, 'd');
    expect(wd.state.d).toBe('denied');
    // 再次重算同样输入，状态保持
    const wd2 = applyWithdraw(
      { data: d, userId: 'u2', versionId: 'v2', choices: wd.choices },
      'd',
    );
    expect(wd2.state.d).toBe('denied');
    expect(wd2.affected).toEqual([]); // 第二次没有影响变化 → 幂等
    expect(wd2.event.detail).toContain('幂等');
  });

  it('必要用途不能撤回：产生冲突且状态保持同意', () => {
    const v1 = version('v1', [purpose('necessary_core'), purpose('a')]);
    const d = data({
      versions: [v1],
      regions: [region('EU', { requiredPurposeIds: ['necessary_core'] })],
      users: [user('u1', 'EU')],
      records: [],
    });
    const res = applyWithdraw(
      { data: d, userId: 'u1', versionId: 'v1', choices: {} },
      'necessary_core',
    );
    expect(res.state.necessary_core).toBe('granted');
    expect(res.event.conflicts.some((c) => c.code === 'required_withdrawn')).toBe(true);
  });

  it('重复授予是幂等的：不产生 restored 变化', () => {
    const d = scenario();
    const input = { data: d, userId: 'u1', versionId: 'v2', choices: { a: 'granted' } as Record<string, 'granted' | 'denied'> };
    const first = applyGrant(input, 'a');
    expect(first.affected).toEqual([]);
    expect(first.event.detail).toContain('幂等');
  });

  it('显式拒绝下游后，即便上游授权也保持拒绝（部分撤回优先）', () => {
    const d = scenario();
    const input = {
      data: d,
      userId: 'u1',
      versionId: 'v2',
      choices: { a: 'granted', c: 'denied' } as Record<string, 'granted' | 'denied'>,
    };
    const res = applyWithdraw(input, 'c'); // 已经拒绝 → 幂等
    expect(res.state.c).toBe('denied');
    expect(res.affected).toEqual([]);
  });
});
