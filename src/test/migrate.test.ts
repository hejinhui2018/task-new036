import { describe, it, expect } from 'vitest';
import { planMigration } from '../core/migrate';
import { seedData } from '../core/seed';
import {
  data,
  mapping,
  purpose,
  record,
  region,
  user,
  version,
} from './fixtures';

/** v1：单一「体验优化」exp_opt + marketing */
function v1() {
  return version('v1', [
    purpose('necessary_core'),
    purpose('exp_opt', { name: '体验优化' }),
    purpose('marketing'),
  ]);
}

/** v2：exp_opt 拆分为 analytics 与 personalization；新增 ads_targeting 下游 */
function v2() {
  return version('v2', [
    purpose('necessary_core'),
    purpose('analytics', { name: '分析' }),
    purpose('personalization', { name: '个性化' }),
    purpose('marketing'),
    purpose('ads_targeting', { dependsOn: ['marketing'] }),
  ], { sequence: 2, parentVersionId: 'v1' });
}

function v1ToV2Mappings() {
  return [
    mapping('v1', 'v2', 'necessary_core', 'necessary_core'),
    mapping('v1', 'v2', 'exp_opt', 'analytics'),
    mapping('v1', 'v2', 'exp_opt', 'personalization'),
    mapping('v1', 'v2', 'marketing', 'marketing'),
  ];
}

describe('版本迁移：体验优化拆分（v1 → v2）', () => {
  it('旧版勾选同意：分析与个性化都继承为有效，且标记为显式继承', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('EU')],
      users: [user('u1', 'EU')],
      records: [record('u1', 'v1', 'EU', { exp_opt: 'granted', marketing: 'denied' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');

    const analytics = res.purposes.find((p) => p.purposeId === 'analytics')!;
    const personalization = res.purposes.find((p) => p.purposeId === 'personalization')!;
    expect(analytics.status).toBe('inherited');
    expect(analytics.value).toBe('granted');
    expect(analytics.explicit).toBe(true);
    expect(analytics.sources).toEqual(['exp_opt']);
    expect(personalization.value).toBe('granted');
    expect(personalization.status).toBe('inherited');
  });

  it('旧版拒绝同样继承：拆分出的用途保持拒绝', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      records: [record('u1', 'v1', 'EU', { exp_opt: 'denied' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    expect(res.purposes.find((p) => p.purposeId === 'analytics')!.value).toBe('denied');
    expect(res.purposes.find((p) => p.purposeId === 'personalization')!.value).toBe('denied');
  });

  it('严格策略下无旧来源的新用途（ads_targeting）必须重新确认', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      records: [record('u1', 'v1', 'EU', { exp_opt: 'granted', marketing: 'granted' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    const ads = res.purposes.find((p) => p.purposeId === 'ads_targeting')!;
    expect(ads.status).toBe('reconfirm');
    expect(ads.value).toBe('denied'); // 暂停生效
    expect(res.reconfirmPurposeIds).toContain('ads_targeting');
    expect(res.conflicts.some((c) => c.code === 'unmapped_purpose' && c.location.purposeId === 'ads_targeting')).toBe(true);
  });

  it('通知型地区：未映射用途不产生 unmapped 冲突，按地区默认与上游重算', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('EU'), region('US', { mode: 'notice', migrationPolicy: 'notice' })],
      users: [user('u3', 'US')],
      records: [record('u3', 'v1', 'US', { exp_opt: 'granted' })],
    });
    const res = planMigration(d, 'u3', 'v1', 'v2');
    const ads = res.purposes.find((p) => p.purposeId === 'ads_targeting')!;
    expect(ads.status).toBe('default');
    expect(res.conflicts.some((c) => c.code === 'unmapped_purpose')).toBe(false);
  });

  it('通知型地区里 marketing 默认允许时，其下游 ads_targeting 随上游有效', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('US', { mode: 'notice', migrationPolicy: 'notice' })],
      users: [user('u3', 'US')],
      records: [record('u3', 'v1', 'US', { exp_opt: 'granted' })],
    });
    const res = planMigration(d, 'u3', 'v1', 'v2');
    expect(res.purposes.find((p) => p.purposeId === 'marketing')!.value).toBe('granted');
    expect(res.purposes.find((p) => p.purposeId === 'ads_targeting')!.value).toBe('granted');
  });

  it('必要用途迁移后恒为同意', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('EU', { requiredPurposeIds: ['necessary_core'] })],
      records: [record('u1', 'v1', 'EU', { exp_opt: 'denied' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    expect(res.purposes.find((p) => p.purposeId === 'necessary_core')!.status).toBe('required');
    expect(res.purposes.find((p) => p.purposeId === 'necessary_core')!.value).toBe('granted');
  });
});

describe('版本迁移：用途合并（v2 → v3）', () => {
  function v3() {
    return version('v3', [
      purpose('necessary_core'),
      purpose('growth_insights', { dependsOn: [] }),
    ], { sequence: 3, parentVersionId: 'v2' });
  }
  const mergeMappings = [
    mapping('v2', 'v3', 'necessary_core', 'necessary_core'),
    mapping('v2', 'v3', 'analytics', 'growth_insights'),
    mapping('v2', 'v3', 'marketing', 'growth_insights'),
  ];

  it('来源状态一致同意 → 合并继承为同意', () => {
    const d = data({
      versions: [v1(), v2(), v3()],
      mappings: [...v1ToV2Mappings(), ...mergeMappings],
      records: [record('u2', 'v2', 'EU', {
        analytics: 'granted',
        marketing: 'granted',
        personalization: 'granted',
      })],
    });
    const res = planMigration(d, 'u2', 'v2', 'v3');
    const gi = res.purposes.find((p) => p.purposeId === 'growth_insights')!;
    expect(gi.status).toBe('inherited');
    expect(gi.value).toBe('granted');
    expect(gi.sources.sort()).toEqual(['analytics', 'marketing']);
  });

  it('来源状态互相矛盾（一同意一拒绝）→ 合并冲突，必须重新确认', () => {
    const d = data({
      versions: [v1(), v2(), v3()],
      mappings: [...v1ToV2Mappings(), ...mergeMappings],
      records: [record('u1', 'v2', 'EU', { analytics: 'granted', marketing: 'denied' })],
    });
    const res = planMigration(d, 'u1', 'v2', 'v3');
    const gi = res.purposes.find((p) => p.purposeId === 'growth_insights')!;
    expect(gi.status).toBe('reconfirm');
    expect(gi.value).toBe('denied');
    const conflict = res.conflicts.find((c) => c.code === 'merge_conflict');
    expect(conflict).toBeDefined();
    expect(conflict!.location.purposeId).toBe('growth_insights');
    expect(conflict!.location.userId).toBe('u1');
  });
});

describe('版本迁移：分叉与映射问题', () => {
  it('目标版本不在后继链上 → 版本分叉冲突，所有用途都不能继承', () => {
    // v3 声明父版本为 v1（与 v2 平级分叉）
    const forkedV3 = version('v3', [
      purpose('necessary_core'),
      purpose('analytics'),
    ], { sequence: 3, parentVersionId: 'v1' });
    const d = data({
      versions: [v1(), v2(), forkedV3],
      mappings: [
        ...v1ToV2Mappings(),
        // 即使存在 v2→v3 的映射，分叉时也不允许沿它继承
        mapping('v2', 'v3', 'analytics', 'analytics'),
      ],
      records: [record('u1', 'v2', 'EU', { analytics: 'granted' })],
    });
    const res = planMigration(d, 'u1', 'v2', 'v3');
    expect(res.conflicts.some((c) => c.code === 'version_fork')).toBe(true);
    const a = res.purposes.find((p) => p.purposeId === 'analytics')!;
    expect(['reconfirm', 'default']).toContain(a.status);
    expect(a.status).not.toBe('inherited');
  });

  it('映射指向不存在的目标用途 → mapping_target_missing 且可定位 mappingId', () => {
    const v3Empty = version('v3', [purpose('necessary_core')], { sequence: 3, parentVersionId: 'v2' });
    const d = data({
      versions: [v1(), v2(), v3Empty],
      mappings: [
        ...v1ToV2Mappings(),
        mapping('v2', 'v3', 'analytics', 'ghost', 'bad_map'),
      ],
      records: [record('u1', 'v2', 'EU', { analytics: 'granted' })],
    });
    const res = planMigration(d, 'u1', 'v2', 'v3');
    const c = res.conflicts.find((x) => x.code === 'mapping_target_missing');
    expect(c).toBeDefined();
    expect(c!.location.mappingId).toBe('bad_map');
  });

  it('多跳版本链 v1→v2→v3 的来源可以正确复合', () => {
    // v3 只保留 personalization；v2.personalization 来自 v1.exp_opt
    const v3 = version('v3', [
      purpose('necessary_core'),
      purpose('personalization'),
    ], { sequence: 3, parentVersionId: 'v2' });
    const d = data({
      versions: [v1(), v2(), v3],
      mappings: [
        ...v1ToV2Mappings(),
        mapping('v2', 'v3', 'necessary_core', 'necessary_core'),
        mapping('v2', 'v3', 'personalization', 'personalization'),
      ],
      records: [record('u1', 'v1', 'EU', { exp_opt: 'granted' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v3');
    const p = res.purposes.find((x) => x.purposeId === 'personalization')!;
    expect(p.status).toBe('inherited');
    expect(p.sources).toEqual(['exp_opt']);
    expect(p.value).toBe('granted');
  });
});

describe('版本迁移：地区不匹配', () => {
  it('用户地区没有规则：按最保守处理并报地区不匹配', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('EU')],
      users: [user('u9', 'BR')],
      records: [record('u9', 'v1', 'BR', { exp_opt: 'granted' })],
    });
    const res = planMigration(d, 'u9', 'v1', 'v2');
    expect(res.conflicts.some((c) => c.code === 'region_mismatch' && c.location.region === 'BR')).toBe(true);
    // 保守 opt-in：显式同意的映射仍继承，但新用途 ads 需重新确认
    expect(res.purposes.find((p) => p.purposeId === 'analytics')!.value).toBe('granted');
  });

  it('地区禁止的用途迁移后为 prohibited 且不继承旧授权', () => {
    const d = data({
      versions: [v1(), v2()],
      mappings: v1ToV2Mappings(),
      regions: [region('EU', { prohibitedPurposeIds: ['personalization'] })],
      records: [record('u1', 'v1', 'EU', { exp_opt: 'granted' })],
    });
    const res = planMigration(d, 'u1', 'v1', 'v2');
    const p = res.purposes.find((x) => x.purposeId === 'personalization')!;
    expect(p.status).toBe('prohibited');
    expect(p.value).toBe('denied');
  });
});

describe('内置示例数据端到端', () => {
  it('林晓(EU) v1→v2：拆分继承成功，ads_targeting 需重新确认', () => {
    const res = planMigration(seedData(), 'u1', 'v1', 'v2');
    expect(res.purposes.find((p) => p.purposeId === 'analytics')!.value).toBe('granted');
    expect(res.purposes.find((p) => p.purposeId === 'personalization')!.value).toBe('granted');
    expect(res.purposes.find((p) => p.purposeId === 'marketing')!.value).toBe('denied');
    // ads_targeting 是 v2 新增下游用途，无映射来源，strict 下需重新确认
    expect(res.reconfirmPurposeIds).toContain('ads_targeting');
  });

  it('王浩(CN) v2→v3：analytics 同意、marketing 同意，增长洞察继承成功；ai_training 需确认', () => {
    const d = seedData();
    // 给 u2 补一份 v2 记录（两个来源都同意）
    d.records.push(record('u2', 'v2', 'CN', {
      analytics: 'granted',
      personalization: 'granted',
      marketing: 'granted',
      ads_targeting: 'granted',
    }, '2024-05-01T00:00:00.000Z'));
    const res = planMigration(d, 'u2', 'v2', 'v3');
    expect(res.purposes.find((p) => p.purposeId === 'growth_insights')!.status).toBe('inherited');
    expect(res.purposes.find((p) => p.purposeId === 'growth_insights')!.value).toBe('granted');
    expect(res.reconfirmPurposeIds).toContain('ai_training');
  });

  it('林晓(EU) v2→v3：analytics 同意但 marketing 拒绝 → 增长洞察合并冲突', () => {
    const d = seedData();
    d.records.push(record('u1', 'v2', 'EU', {
      analytics: 'granted',
      personalization: 'granted',
      marketing: 'denied',
    }, '2024-05-02T00:00:00.000Z'));
    const res = planMigration(d, 'u1', 'v2', 'v3');
    expect(res.conflicts.some((c) => c.code === 'merge_conflict')).toBe(true);
    expect(res.purposes.find((p) => p.purposeId === 'growth_insights')!.status).toBe('reconfirm');
  });

  it('陈默(BR) 无地区规则 → 地区不匹配冲突', () => {
    const res = planMigration(seedData(), 'u4', 'v1', 'v2');
    expect(res.conflicts.some((c) => c.code === 'region_mismatch')).toBe(true);
  });
});
