import { describe, expect, it } from 'vitest';
import { seedState } from '../src/state/seed';
import { applyWithdrawal, previewWithdrawal, upsertConsent } from '../src/domain/consent';
import { ruleForRegion } from '../src/domain/rules';
import type { ConsentRecord, ConsentStatus } from '../src/types';

const NOW = 1_700_000_000_000;

/** 给 u1 在 v2 上准备好全部用途的同意记录 */
function migratedRecords(): { records: ConsentRecord[]; v2purposes: string[] } {
  const state = seedState();
  let records = [...state.records];
  const grants: [string, ConsentStatus][] = [
    ['analytics', 'granted'],
    ['crash', 'granted'],
    ['usage', 'granted'],
    ['personalization', 'granted'],
  ];
  for (const [pid, status] of grants) {
    records = upsertConsent(records, 'u1', 'v2', pid, status, 'migration', NOW);
  }
  return { records, v2purposes: grants.map(([p]) => p) };
}

const statusOf = (records: ConsentRecord[], pid: string) =>
  records.find((r) => r.userId === 'u1' && r.versionId === 'v2' && r.purposeId === pid)?.status;

describe('撤回与下游级联', () => {
  it('撤回父用途会级联到全部下游用途', () => {
    const state = seedState();
    const v2 = state.versions.find((v) => v.id === 'v2')!;
    const rule = ruleForRegion(state.rules, 'CN')!;
    const { records } = migratedRecords();

    const affected = previewWithdrawal(v2, 'analytics', rule);
    expect(affected).toEqual(['analytics', 'crash', 'usage']);

    const { records: next, changed, skipped } = applyWithdrawal(records, 'u1', 'v2', affected, NOW + 1);
    expect(changed.sort()).toEqual(['analytics', 'crash', 'usage']);
    expect(skipped).toEqual([]);
    expect(statusOf(next, 'analytics')).toBe('denied');
    expect(statusOf(next, 'crash')).toBe('denied');
    expect(statusOf(next, 'usage')).toBe('denied');
    // 兄弟分支不受影响
    expect(statusOf(next, 'personalization')).toBe('granted');
  });

  it('部分撤回：只撤回子用途，父用途与兄弟用途不受影响', () => {
    const state = seedState();
    const v2 = state.versions.find((v) => v.id === 'v2')!;
    const rule = ruleForRegion(state.rules, 'CN')!;
    const { records } = migratedRecords();

    const affected = previewWithdrawal(v2, 'crash', rule);
    expect(affected).toEqual(['crash']);

    const { records: next } = applyWithdrawal(records, 'u1', 'v2', affected, NOW + 1);
    expect(statusOf(next, 'crash')).toBe('denied');
    expect(statusOf(next, 'analytics')).toBe('granted');
    expect(statusOf(next, 'usage')).toBe('granted');
  });

  it('地区规则关闭级联时，撤回只影响自身', () => {
    const state = seedState();
    const v2 = state.versions.find((v) => v.id === 'v2')!;
    const rule = { ...ruleForRegion(state.rules, 'CN')!, cascadeWithdraw: false };
    expect(previewWithdrawal(v2, 'analytics', rule)).toEqual(['analytics']);
  });

  it('撤回后可以重新确认（重新同意）', () => {
    const state = seedState();
    const v2 = state.versions.find((v) => v.id === 'v2')!;
    const rule = ruleForRegion(state.rules, 'CN')!;
    const { records } = migratedRecords();

    const affected = previewWithdrawal(v2, 'analytics', rule);
    const withdrawn = applyWithdrawal(records, 'u1', 'v2', affected, NOW + 1).records;
    expect(statusOf(withdrawn, 'analytics')).toBe('denied');

    const reconfirmed = upsertConsent(withdrawn, 'u1', 'v2', 'analytics', 'granted', 'user', NOW + 2);
    expect(statusOf(reconfirmed, 'analytics')).toBe('granted');
    // 下游仍保持拒绝，需逐一确认
    expect(statusOf(reconfirmed, 'crash')).toBe('denied');
  });

  it('无记录的用途撤回 = 写入一条拒绝记录', () => {
    const state = seedState();
    const { records } = migratedRecords();
    const before = records.find(
      (r) => r.userId === 'u1' && r.versionId === 'v2' && r.purposeId === 'essential',
    );
    expect(before).toBeUndefined();
    const { records: next, changed } = applyWithdrawal(records, 'u1', 'v2', ['essential'], NOW + 1);
    expect(changed).toEqual(['essential']);
    expect(statusOf(next, 'essential')).toBe('denied');
    expect(state.versions.length).toBeGreaterThan(0);
  });
});
