import { describe, expect, it } from 'vitest';
import { seedState } from '../src/state/seed';
import { applyMigrationDecisions, planMigration, type MigrationDecision } from '../src/domain/migration';
import { ruleForRegion } from '../src/domain/rules';
import type { ConsentRecord, PolicyVersion } from '../src/types';

const NOW = 1_700_000_000_000;

function fixture() {
  const state = seedState();
  const v1 = state.versions.find((v) => v.id === 'v1')!;
  const v2 = state.versions.find((v) => v.id === 'v2')!;
  const user = (id: string) => state.users.find((u) => u.id === id)!;
  const plan = (userId: string, records: ConsentRecord[] = state.records) =>
    planMigration({
      user: user(userId),
      fromVersion: v1,
      toVersion: v2,
      records,
      rule: ruleForRegion(state.rules, user(userId).region),
    });
  return { state, v1, v2, user, plan };
}

const byPurpose = (ds: MigrationDecision[]) => new Map(ds.map((d) => [d.purposeId, d]));

describe('版本迁移：拆分 / 新增 / 继承', () => {
  it('CN 用户：拆分用途继承旧选择，新增用途需重新确认', () => {
    const m = byPurpose(fixture().plan('u1'));
    expect(m.get('essential')?.outcome).toBe('inherited');
    expect(m.get('analytics')?.outcome).toBe('inherited');
    expect(m.get('analytics')?.status).toBe('granted');
    expect(m.get('crash')?.outcome).toBe('inherited');
    expect(m.get('personalization')?.outcome).toBe('inherited');
    expect(m.get('usage')?.outcome).toBe('reconfirm-required');
    expect(m.get('analytics')?.reason).toContain('体验优化');
  });

  it('EU 用户：拆分后必须重新确认，旧选择不再沿用', () => {
    const m = byPurpose(fixture().plan('u3'));
    expect(m.get('essential')?.outcome).toBe('inherited');
    expect(m.get('analytics')?.outcome).toBe('reconfirm-required');
    expect(m.get('personalization')?.outcome).toBe('reconfirm-required');
    expect(m.get('crash')?.outcome).toBe('reconfirm-required');
    expect(m.get('usage')?.outcome).toBe('reconfirm-required');
  });

  it('US 用户（opt-out）：新增用途按默认同意处理', () => {
    const m = byPurpose(fixture().plan('u2'));
    expect(m.get('usage')?.outcome).toBe('defaulted');
    expect(m.get('usage')?.status).toBe('granted');
    expect(m.get('analytics')?.outcome).toBe('inherited');
  });

  it('旧选择为拒绝时，允许继承的地区继承拒绝', () => {
    const { state, v1, v2 } = fixture();
    const records: ConsentRecord[] = [
      { userId: 'u1', versionId: 'v1', purposeId: 'exp', status: 'denied', source: 'user', updatedAt: NOW },
    ];
    const d = planMigration({
      user: state.users.find((u) => u.id === 'u1')!,
      fromVersion: v1,
      toVersion: v2,
      records,
      rule: ruleForRegion(state.rules, 'CN'),
    });
    const m = byPurpose(d);
    expect(m.get('analytics')?.outcome).toBe('inherited');
    expect(m.get('analytics')?.status).toBe('denied');
    expect(m.get('personalization')?.status).toBe('denied');
  });

  it('应用迁移只写入可继承/默认的用途，待确认用途保持无记录', () => {
    const { state, plan } = fixture();
    const decisions = plan('u1');
    const next = applyMigrationDecisions(state.records, 'u1', 'v2', decisions, NOW);
    const written = next.filter((r) => r.versionId === 'v2' && r.userId === 'u1');
    expect(written.map((r) => r.purposeId).sort()).toEqual([
      'analytics',
      'crash',
      'essential',
      'personalization',
    ]);
    expect(written.find((r) => r.purposeId === 'usage')).toBeUndefined();
    expect(written.every((r) => r.source === 'migration' || r.source === 'default')).toBe(true);
  });
});

describe('版本迁移：合并策略', () => {
  const v3: PolicyVersion = {
    id: 'v3',
    label: 'v3.0',
    status: 'draft',
    baseVersionId: 'v2',
    createdAt: 0,
    publishedAt: null,
    purposes: [
      { id: 'smart', key: 'smart', name: '智能体验', parentId: null, derivedFrom: ['analytics', 'personalization'] },
    ],
  };
  const records: ConsentRecord[] = [
    { userId: 'u1', versionId: 'v2', purposeId: 'analytics', status: 'granted', source: 'user', updatedAt: NOW },
    { userId: 'u1', versionId: 'v2', purposeId: 'personalization', status: 'denied', source: 'user', updatedAt: NOW },
  ];

  const planMerge = (region: string) => {
    const state = seedState();
    return planMigration({
      user: { id: 'u1', name: '测试', region },
      fromVersion: state.versions.find((v) => v.id === 'v2')!,
      toVersion: v3,
      records,
      rule: ruleForRegion(state.rules, region),
    });
  };

  it('mergeStrategy=all：任一来源拒绝则整体拒绝', () => {
    const d = planMerge('CN');
    expect(d[0].outcome).toBe('inherited');
    expect(d[0].status).toBe('denied');
    expect(d[0].reason).toContain('不一致');
  });

  it('mergeStrategy=any：任一来源同意即继承同意', () => {
    const d = planMerge('US');
    expect(d[0].outcome).toBe('inherited');
    expect(d[0].status).toBe('granted');
  });
});

describe('版本迁移：失效与受阻', () => {
  it('旧用途在新版本被移除 → 原同意失效', () => {
    const { state, v1 } = fixture();
    const v4: PolicyVersion = {
      id: 'v4',
      label: 'v4.0',
      status: 'draft',
      baseVersionId: 'v1',
      createdAt: 0,
      publishedAt: null,
      purposes: [
        { id: 'essential', key: 'essential', name: '必要服务', parentId: null, derivedFrom: ['essential'] },
      ],
    };
    const d = planMigration({
      user: state.users.find((u) => u.id === 'u1')!,
      fromVersion: v1,
      toVersion: v4,
      records: state.records,
      rule: ruleForRegion(state.rules, 'CN'),
    });
    const inv = d.find((x) => x.outcome === 'invalidated');
    expect(inv?.purposeId).toBe('exp');
    expect(inv?.reason).toContain('失效');
  });

  it('用户地区无规则 → 全部用途迁移受阻', () => {
    const m = fixture().plan('u5');
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((d) => d.outcome === 'blocked')).toBe(true);
  });

  it('更名（key 变化、单一来源）视为同一用途继承', () => {
    const { state, v1 } = fixture();
    const v5: PolicyVersion = {
      id: 'v5',
      label: 'v5.0',
      status: 'draft',
      baseVersionId: 'v1',
      createdAt: 0,
      publishedAt: null,
      purposes: [
        { id: 'exp2', key: 'experience-plus', name: '体验优化 Plus', parentId: null, derivedFrom: ['exp'] },
      ],
    };
    const d = planMigration({
      user: state.users.find((u) => u.id === 'u1')!,
      fromVersion: v1,
      toVersion: v5,
      records: state.records,
      rule: ruleForRegion(state.rules, 'CN'),
    });
    const m = byPurpose(d);
    expect(m.get('exp2')?.outcome).toBe('inherited');
    expect(m.get('exp2')?.status).toBe('granted');
    expect(m.get('essential')?.outcome).toBe('invalidated');
  });
});

describe('迁移判定的来源引用', () => {
  it('每条判定都带来源用途与其旧选择，便于审计', () => {
    const m = byPurpose(fixture().plan('u1'));
    const analytics = m.get('analytics')!;
    expect(analytics.sources).toHaveLength(1);
    expect(analytics.sources[0].id).toBe('exp');
    expect(analytics.sources[0].status).toBe('granted');
  });
});
