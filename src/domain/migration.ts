import type {
  ConsentRecord,
  ConsentStatus,
  ID,
  PolicyVersion,
  RegionRule,
  UserProfile,
} from '../types';
import { deriveMappings, removedPurposes } from './purposes';
import { statusText } from './text';

export type MigrationOutcome =
  | 'inherited' // 旧同意映射到新用途，直接继承
  | 'defaulted' // 无旧同意可映射，按地区规则默认处理
  | 'reconfirm-required' // 规则要求重新确认，不写入记录
  | 'invalidated' // 旧用途在新版本被移除，原同意失效
  | 'already-exists' // 目标版本已有记录，重复迁移跳过
  | 'blocked'; // 地区无规则等原因，无法迁移

export interface MigrationSourceRef {
  id: ID;
  name: string;
  status: ConsentStatus | null;
}

/** 单个用途的迁移判定，含人类可读的映射说明 */
export interface MigrationDecision {
  userId: ID;
  purposeId: ID;
  purposeName: string;
  outcome: MigrationOutcome;
  /** 若产生记录，记录的状态 */
  status: ConsentStatus | null;
  sources: MigrationSourceRef[];
  reason: string;
}

export function findConsent(
  records: ConsentRecord[],
  userId: ID,
  versionId: ID,
  purposeId: ID,
): ConsentRecord | undefined {
  return records.find(
    (r) => r.userId === userId && r.versionId === versionId && r.purposeId === purposeId,
  );
}

/**
 * 计算一个用户从 fromVersion 迁移到 toVersion 时，每个新用途的判定结果。
 * 纯函数：不修改任何数据，应用迁移由 applyMigrationDecisions 完成。
 */
export function planMigration(args: {
  user: UserProfile;
  fromVersion: PolicyVersion;
  toVersion: PolicyVersion;
  records: ConsentRecord[];
  rule: RegionRule | undefined;
}): MigrationDecision[] {
  const { user, fromVersion, toVersion, records, rule } = args;
  const decisions: MigrationDecision[] = [];

  if (!rule) {
    for (const p of toVersion.purposes) {
      decisions.push({
        userId: user.id,
        purposeId: p.id,
        purposeName: p.name,
        outcome: 'blocked',
        status: null,
        sources: [],
        reason: `地区「${user.region}」没有匹配的同意规则，无法判定继承方式，迁移受阻`,
      });
    }
    return decisions;
  }

  const defaultStatus: ConsentStatus = rule.model === 'opt-out' ? 'granted' : 'denied';
  const baseName = (id: ID) => fromVersion.purposes.find((p) => p.id === id)?.name ?? id;
  const srcRef = (id: ID): MigrationSourceRef => ({
    id,
    name: baseName(id),
    status: findConsent(records, user.id, fromVersion.id, id)?.status ?? null,
  });

  for (const m of deriveMappings(toVersion, fromVersion)) {
    const purpose = toVersion.purposes.find((p) => p.id === m.purposeId);
    if (!purpose) continue;
    const base = { userId: user.id, purposeId: purpose.id, purposeName: purpose.name };

    const existing = findConsent(records, user.id, toVersion.id, purpose.id);
    if (existing) {
      decisions.push({
        ...base,
        outcome: 'already-exists',
        status: existing.status,
        sources: m.sources.map(srcRef),
        reason: `目标版本已存在该用途的「${statusText(existing.status)}」记录，重复迁移不产生变化`,
      });
      continue;
    }

    if (m.kind === 'new') {
      if (rule.requireExplicitForNew || rule.model === 'opt-in') {
        decisions.push({
          ...base,
          outcome: 'reconfirm-required',
          status: null,
          sources: [],
          reason: `新增用途，无旧同意可映射；${rule.region} 规则要求显式同意（当前默认「${statusText(defaultStatus)}」），需用户重新确认`,
        });
      } else {
        decisions.push({
          ...base,
          outcome: 'defaulted',
          status: defaultStatus,
          sources: [],
          reason: `新增用途，无旧同意可映射；${rule.region} 为 opt-out 模式，按默认「${statusText(defaultStatus)}」处理`,
        });
      }
      continue;
    }

    if (m.kind === 'carry' || m.kind === 'rename') {
      const src = srcRef(m.sources[0]);
      const rec = findConsent(records, user.id, fromVersion.id, m.sources[0]);
      if (rec) {
        decisions.push({
          ...base,
          outcome: 'inherited',
          status: rec.status,
          sources: [src],
          reason:
            m.kind === 'carry'
              ? `与旧用途「${src.name}」一一对应，直接继承旧选择「${statusText(rec.status)}」`
              : `由旧用途「${src.name}」更名而来，视为同一用途，继承「${statusText(rec.status)}」`,
        });
      } else {
        decisions.push({
          ...base,
          outcome: 'defaulted',
          status: defaultStatus,
          sources: [src],
          reason: `旧用途「${src.name}」无同意记录，按 ${rule.region} 默认（${rule.model}）处理为「${statusText(defaultStatus)}」`,
        });
      }
      continue;
    }

    if (m.kind === 'split') {
      const src = srcRef(m.sources[0]);
      const rec = findConsent(records, user.id, fromVersion.id, m.sources[0]);
      if (rule.splitRequiresReconfirm) {
        decisions.push({
          ...base,
          outcome: 'reconfirm-required',
          status: null,
          sources: [src],
          reason: `旧用途「${src.name}」拆分为多个用途，${rule.region} 规则要求拆分后重新确认${
            rec ? `（旧选择为「${statusText(rec.status)}」，不再沿用）` : ''
          }`,
        });
      } else if (rec) {
        decisions.push({
          ...base,
          outcome: 'inherited',
          status: rec.status,
          sources: [src],
          reason: `旧用途「${src.name}」拆分，${rule.region} 规则允许沿用旧选择，继承「${statusText(rec.status)}」`,
        });
      } else {
        decisions.push({
          ...base,
          outcome: 'defaulted',
          status: defaultStatus,
          sources: [src],
          reason: `旧用途「${src.name}」拆分且无记录，按默认处理为「${statusText(defaultStatus)}」`,
        });
      }
      continue;
    }

    // merge：多个旧用途合并为一个新用途
    const srcs = m.sources.map(srcRef);
    const statuses = srcs.map((s) => s.status ?? defaultStatus);
    const granted =
      rule.mergeStrategy === 'all'
        ? statuses.every((s) => s === 'granted')
        : statuses.some((s) => s === 'granted');
    const mixed = new Set(statuses).size > 1;
    const status: ConsentStatus = granted ? 'granted' : 'denied';
    decisions.push({
      ...base,
      outcome: 'inherited',
      status,
      sources: srcs,
      reason: `合并自 ${srcs.map((s) => `「${s.name}」`).join('、')}${
        mixed ? '，来源选择不一致，' : '，'
      }按「${rule.mergeStrategy === 'all' ? '全部同意才继承' : '任一同意即继承'}」策略得「${statusText(status)}」`,
    });
  }

  // 旧版本中被移除的用途：原同意失效
  for (const rem of removedPurposes(toVersion, fromVersion)) {
    const rec = findConsent(records, user.id, fromVersion.id, rem.id);
    if (rec) {
      decisions.push({
        userId: user.id,
        purposeId: rem.id,
        purposeName: rem.name,
        outcome: 'invalidated',
        status: null,
        sources: [{ id: rem.id, name: rem.name, status: rec.status }],
        reason: `旧用途「${rem.name}」在新版本中已移除，原选择「${statusText(rec.status)}」随之失效`,
      });
    }
  }

  return decisions;
}

/**
 * 应用迁移：只为 inherited / defaulted 的判定写入记录；
 * reconfirm-required 不写入（保持“未确认”）；已存在的记录跳过（幂等）。
 */
export function applyMigrationDecisions(
  records: ConsentRecord[],
  userId: ID,
  versionId: ID,
  decisions: MigrationDecision[],
  now: number,
): ConsentRecord[] {
  const writable = decisions.filter(
    (d) => (d.outcome === 'inherited' || d.outcome === 'defaulted') && d.status !== null,
  );
  if (writable.length === 0) return records;
  const existing = new Set(records.map((r) => `${r.userId}|${r.versionId}|${r.purposeId}`));
  const added: ConsentRecord[] = [];
  for (const d of writable) {
    const key = `${userId}|${versionId}|${d.purposeId}`;
    if (existing.has(key)) continue;
    existing.add(key);
    added.push({
      userId,
      versionId,
      purposeId: d.purposeId,
      status: d.status as ConsentStatus,
      source: d.outcome === 'inherited' ? 'migration' : 'default',
      updatedAt: now,
    });
  }
  return added.length > 0 ? [...records, ...added] : records;
}
