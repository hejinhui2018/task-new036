import type {
  ConsentRecord,
  ConsentSource,
  ConsentStatus,
  ID,
  PolicyVersion,
  RegionRule,
} from '../types';
import { descendantsOf } from './purposes';

export interface EffectiveConsent {
  status: ConsentStatus;
  /** true = 有明确记录；false = 仅按地区规则默认 */
  confirmed: boolean;
  source: ConsentSource | null;
}

/** 有效同意状态：有记录看记录，无记录按地区规则默认 */
export function effectiveConsent(
  records: ConsentRecord[],
  userId: ID,
  versionId: ID,
  purposeId: ID,
  rule: RegionRule,
): EffectiveConsent {
  const rec = records.find(
    (r) => r.userId === userId && r.versionId === versionId && r.purposeId === purposeId,
  );
  if (rec) return { status: rec.status, confirmed: true, source: rec.source };
  return { status: rule.model === 'opt-out' ? 'granted' : 'denied', confirmed: false, source: null };
}

/** 写入/更新一条同意记录；状态与来源都相同则原样返回（幂等） */
export function upsertConsent(
  records: ConsentRecord[],
  userId: ID,
  versionId: ID,
  purposeId: ID,
  status: ConsentStatus,
  source: ConsentSource,
  now: number,
): ConsentRecord[] {
  const idx = records.findIndex(
    (r) => r.userId === userId && r.versionId === versionId && r.purposeId === purposeId,
  );
  if (idx >= 0) {
    const cur = records[idx];
    if (cur.status === status && cur.source === source) return records;
    const next = records.slice();
    next[idx] = { ...cur, status, source, updatedAt: now };
    return next;
  }
  return [...records, { userId, versionId, purposeId, status, source, updatedAt: now }];
}

/** 撤回影响的用途：自身 + （规则开启级联时）全部下游用途 */
export function previewWithdrawal(
  version: PolicyVersion,
  purposeId: ID,
  rule: RegionRule,
): ID[] {
  return [purposeId, ...(rule.cascadeWithdraw ? descendantsOf(version.purposes, purposeId) : [])];
}

/** 执行撤回：把受影响用途置为拒绝；已是拒绝的跳过并计入 skipped（幂等） */
export function applyWithdrawal(
  records: ConsentRecord[],
  userId: ID,
  versionId: ID,
  purposeIds: ID[],
  now: number,
): { records: ConsentRecord[]; changed: ID[]; skipped: ID[] } {
  let out = records;
  const changed: ID[] = [];
  const skipped: ID[] = [];
  for (const pid of purposeIds) {
    const cur = out.find(
      (r) => r.userId === userId && r.versionId === versionId && r.purposeId === pid,
    );
    if (cur && cur.status === 'denied') {
      skipped.push(pid);
      continue;
    }
    out = upsertConsent(out, userId, versionId, pid, 'denied', 'user', now);
    changed.push(pid);
  }
  return { records: out, changed, skipped };
}
