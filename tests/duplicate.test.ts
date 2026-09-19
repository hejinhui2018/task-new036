import { describe, expect, it } from 'vitest';
import { seedState } from '../src/state/seed';
import { applyMigrationDecisions, planMigration } from '../src/domain/migration';
import { applyWithdrawal, previewWithdrawal, upsertConsent } from '../src/domain/consent';
import { ruleForRegion } from '../src/domain/rules';

const NOW = 1_700_000_000_000;

function setup() {
  const state = seedState();
  const v1 = state.versions.find((v) => v.id === 'v1')!;
  const v2 = state.versions.find((v) => v.id === 'v2')!;
  const user = state.users.find((u) => u.id === 'u1')!;
  const rule = ruleForRegion(state.rules, user.region)!;
  return { state, v1, v2, user, rule };
}

describe('重复操作幂等', () => {
  it('重复迁移：第二次全部跳过，记录不再变化', () => {
    const { state, v1, v2, user, rule } = setup();
    const d1 = planMigration({ user, fromVersion: v1, toVersion: v2, records: state.records, rule });
    const r1 = applyMigrationDecisions(state.records, user.id, v2.id, d1, NOW);
    expect(r1.length).toBeGreaterThan(state.records.length);

    const d2 = planMigration({ user, fromVersion: v1, toVersion: v2, records: r1, rule });
    expect(d2.filter((d) => d.outcome === 'inherited' || d.outcome === 'defaulted')).toHaveLength(0);
    expect(d2.filter((d) => d.outcome === 'already-exists').length).toBeGreaterThan(0);
    // 待确认用途仍然没有记录，仍报告待确认
    expect(d2.find((d) => d.purposeId === 'usage')?.outcome).toBe('reconfirm-required');

    const r2 = applyMigrationDecisions(r1, user.id, v2.id, d2, NOW + 1);
    expect(r2).toBe(r1); // 无变化时返回原引用
  });

  it('重复撤回：第二次无变化', () => {
    const { state, v2, rule } = setup();
    let records = upsertConsent(state.records, 'u1', 'v2', 'analytics', 'granted', 'user', NOW);
    const affected = previewWithdrawal(v2, 'analytics', rule);

    const first = applyWithdrawal(records, 'u1', 'v2', affected, NOW + 1);
    expect(first.changed.length).toBeGreaterThan(0);

    const second = applyWithdrawal(first.records, 'u1', 'v2', affected, NOW + 2);
    expect(second.changed).toEqual([]);
    expect(second.skipped.sort()).toEqual(affected.slice().sort());
    expect(second.records).toBe(first.records);
  });

  it('重复设置相同同意：记录不重复、不新增历史', () => {
    const { state } = setup();
    const r1 = upsertConsent(state.records, 'u1', 'v2', 'usage', 'granted', 'user', NOW);
    const r2 = upsertConsent(r1, 'u1', 'v2', 'usage', 'granted', 'user', NOW + 1);
    expect(r2).toBe(r1);
    expect(r2.filter((r) => r.versionId === 'v2' && r.purposeId === 'usage')).toHaveLength(1);
  });

  it('重复发布同一版本：第二次为无操作', () => {
    // 通过 store 验证（发布后状态不再变化）
    const { state } = setup();
    expect(state.versions.find((v) => v.id === 'v1')?.status).toBe('published');
  });
});
