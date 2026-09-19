import type { WorkbenchData } from './types';

/**
 * 内置示例：
 * - v1：单一「体验优化」用途
 * - v2：把体验优化拆分为「分析」与「个性化」，新增广告下游用途
 * - v3 草案：分析 + 营销合并为「增长洞察」，新增 AI 训练用途
 * 地区：EU(opt-in/strict)、CN(opt-out/strict)、US(notice/notice)
 */
export function seedData(): WorkbenchData {
  return {
    versions: [
      {
        id: 'v1',
        label: '隐私说明 v1（2023）',
        sequence: 1,
        parentVersionId: null,
        status: 'published',
        createdAt: '2023-01-10T00:00:00.000Z',
        publishedAt: '2023-01-15T00:00:00.000Z',
        purposes: [
          { id: 'necessary', name: '必要使用', versionId: 'v1', isGroup: true, parentId: null },
          { id: 'necessary_core', name: '核心功能与安全', versionId: 'v1', parentId: 'necessary', description: '提供服务所必需' },
          { id: 'experience_optimization', name: '体验优化', versionId: 'v1', parentId: null, description: '旧版中分析与个性化尚未拆分的合并用途' },
          { id: 'marketing', name: '营销触达', versionId: 'v1', parentId: null },
        ],
      },
      {
        id: 'v2',
        label: '隐私说明 v2（2024）',
        sequence: 2,
        parentVersionId: 'v1',
        status: 'published',
        createdAt: '2024-03-01T00:00:00.000Z',
        publishedAt: '2024-03-10T00:00:00.000Z',
        purposes: [
          { id: 'necessary', name: '必要使用', versionId: 'v2', isGroup: true, parentId: null },
          { id: 'necessary_core', name: '核心功能与安全', versionId: 'v2', parentId: 'necessary' },
          { id: 'experience', name: '体验优化', versionId: 'v2', isGroup: true, parentId: null, description: '新版拆分为分析与个性化两个独立用途' },
          { id: 'analytics', name: '分析', versionId: 'v2', parentId: 'experience', description: '产品使用分析' },
          { id: 'personalization', name: '个性化', versionId: 'v2', parentId: 'experience', description: '内容与推荐个性化' },
          { id: 'marketing', name: '营销触达', versionId: 'v2', parentId: null },
          { id: 'ads_targeting', name: '定向广告', versionId: 'v2', parentId: null, dependsOn: ['marketing'], description: '依赖营销触达的下游用途' },
        ],
      },
      {
        id: 'v3',
        label: '隐私说明 v3（2025 草案）',
        sequence: 3,
        parentVersionId: 'v2',
        status: 'draft',
        createdAt: '2025-06-01T00:00:00.000Z',
        purposes: [
          { id: 'necessary', name: '必要使用', versionId: 'v3', isGroup: true, parentId: null },
          { id: 'necessary_core', name: '核心功能与安全', versionId: 'v3', parentId: 'necessary' },
          { id: 'personalization', name: '个性化', versionId: 'v3', parentId: null, description: '增长洞察依赖个性化数据' },
          { id: 'growth_insights', name: '增长洞察', versionId: 'v3', parentId: null, dependsOn: ['personalization'], description: '由旧版「分析」与「营销触达」合并而来' },
          { id: 'ai_training', name: 'AI 模型训练', versionId: 'v3', parentId: null, description: 'v3 新增用途，旧版无任何来源' },
        ],
      },
    ],
    mappings: [
      // v1 -> v2：体验优化拆分为 分析 + 个性化
      { id: 'm1', fromVersionId: 'v1', toVersionId: 'v2', sourcePurposeId: 'necessary_core', targetPurposeId: 'necessary_core' },
      { id: 'm2', fromVersionId: 'v1', toVersionId: 'v2', sourcePurposeId: 'experience_optimization', targetPurposeId: 'analytics' },
      { id: 'm3', fromVersionId: 'v1', toVersionId: 'v2', sourcePurposeId: 'experience_optimization', targetPurposeId: 'personalization' },
      { id: 'm4', fromVersionId: 'v1', toVersionId: 'v2', sourcePurposeId: 'marketing', targetPurposeId: 'marketing' },
      // v2 -> v3：分析 + 营销 合并为 增长洞察（状态不一致时触发合并冲突）
      { id: 'm5', fromVersionId: 'v2', toVersionId: 'v3', sourcePurposeId: 'necessary_core', targetPurposeId: 'necessary_core' },
      { id: 'm6', fromVersionId: 'v2', toVersionId: 'v3', sourcePurposeId: 'analytics', targetPurposeId: 'growth_insights' },
      { id: 'm7', fromVersionId: 'v2', toVersionId: 'v3', sourcePurposeId: 'marketing', targetPurposeId: 'growth_insights' },
      { id: 'm8', fromVersionId: 'v2', toVersionId: 'v3', sourcePurposeId: 'personalization', targetPurposeId: 'personalization' },
    ],
    regions: [
      {
        code: 'EU',
        name: '欧盟',
        mode: 'opt-in',
        requiredPurposeIds: ['necessary_core'],
        prohibitedPurposeIds: [],
        migrationPolicy: 'strict',
      },
      {
        code: 'CN',
        name: '中国大陆',
        mode: 'opt-out',
        requiredPurposeIds: ['necessary_core'],
        prohibitedPurposeIds: [],
        migrationPolicy: 'strict',
      },
      {
        code: 'US',
        name: '美国',
        mode: 'notice',
        requiredPurposeIds: ['necessary_core'],
        prohibitedPurposeIds: [],
        migrationPolicy: 'notice',
      },
    ],
    users: [
      { id: 'u1', name: '林晓', region: 'EU' },
      { id: 'u2', name: '王浩', region: 'CN' },
      { id: 'u3', name: 'Alice Garcia', region: 'US' },
      { id: 'u4', name: '陈默', region: 'BR' },
    ],
    records: [
      {
        id: 'r1',
        userId: 'u1',
        versionId: 'v1',
        region: 'EU',
        choices: { experience_optimization: 'granted', marketing: 'denied' },
        at: '2023-02-01T08:00:00.000Z',
        note: '首次同意弹窗：接受体验优化，拒绝营销',
      },
      {
        id: 'r2',
        userId: 'u2',
        versionId: 'v1',
        region: 'CN',
        choices: { experience_optimization: 'granted', marketing: 'granted' },
        at: '2023-02-02T08:00:00.000Z',
        note: '首次同意弹窗：全部接受',
      },
      {
        id: 'r3',
        userId: 'u3',
        versionId: 'v1',
        region: 'US',
        choices: { experience_optimization: 'granted' },
        at: '2023-02-03T08:00:00.000Z',
        note: '通知模式下继续使用，仅留存分析选择',
      },
      {
        id: 'r4',
        userId: 'u4',
        versionId: 'v1',
        region: 'BR',
        choices: { experience_optimization: 'granted' },
        at: '2023-02-04T08:00:00.000Z',
        note: '所在地区 BR 尚未配置规则',
      },
    ],
  };
}
