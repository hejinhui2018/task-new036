import type { DomainState } from '../types';

const T0 = Date.parse('2026-09-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/**
 * 示例情景：
 * - v1.0（已发布）：必要服务 + 体验优化
 * - v2.0（草稿）：把「体验优化」拆成「分析（含崩溃报告、使用统计）」与「个性化」
 * - 三个地区规则（CN/US/EU）+ 一个无规则地区用户（演示地区不匹配）
 */
export function seedState(): DomainState {
  return {
    versions: [
      {
        id: 'v1',
        label: 'v1.0 隐私说明',
        status: 'published',
        baseVersionId: null,
        createdAt: T0,
        publishedAt: T0,
        purposes: [
          {
            id: 'essential',
            key: 'essential',
            name: '必要服务',
            parentId: null,
            derivedFrom: [],
            description: '账号、安全与核心功能所必需',
          },
          {
            id: 'exp',
            key: 'experience',
            name: '体验优化',
            parentId: null,
            derivedFrom: [],
            description: '用于改进产品体验的汇总数据',
          },
        ],
      },
      {
        id: 'v2',
        label: 'v2.0 隐私说明',
        status: 'draft',
        baseVersionId: 'v1',
        createdAt: T0 + DAY,
        publishedAt: null,
        purposes: [
          {
            id: 'essential',
            key: 'essential',
            name: '必要服务',
            parentId: null,
            derivedFrom: ['essential'],
          },
          {
            id: 'analytics',
            key: 'analytics',
            name: '分析',
            parentId: null,
            derivedFrom: ['exp'],
            description: '由「体验优化」拆分而来',
          },
          {
            id: 'crash',
            key: 'crash',
            name: '崩溃报告',
            parentId: 'analytics',
            derivedFrom: ['exp'],
          },
          {
            id: 'usage',
            key: 'usage',
            name: '使用统计',
            parentId: 'analytics',
            derivedFrom: [],
            description: '新增用途，无旧同意可映射',
          },
          {
            id: 'personalization',
            key: 'personalization',
            name: '个性化',
            parentId: null,
            derivedFrom: ['exp'],
            description: '由「体验优化」拆分而来',
          },
        ],
      },
    ],
    rules: [
      {
        region: 'CN',
        model: 'opt-in',
        requireExplicitForNew: true,
        splitRequiresReconfirm: false,
        mergeStrategy: 'all',
        cascadeWithdraw: true,
      },
      {
        region: 'US',
        model: 'opt-out',
        requireExplicitForNew: false,
        splitRequiresReconfirm: false,
        mergeStrategy: 'any',
        cascadeWithdraw: true,
      },
      {
        region: 'EU',
        model: 'opt-in',
        requireExplicitForNew: true,
        splitRequiresReconfirm: true,
        mergeStrategy: 'all',
        cascadeWithdraw: true,
      },
    ],
    users: [
      { id: 'u1', name: '张伟', region: 'CN' },
      { id: 'u2', name: 'Alice', region: 'US' },
      { id: 'u3', name: 'Bob', region: 'EU' },
      { id: 'u4', name: 'Carol', region: 'EU' },
      { id: 'u5', name: 'Dora', region: 'ATLANTIS' },
    ],
    records: [
      { userId: 'u1', versionId: 'v1', purposeId: 'essential', status: 'granted', source: 'user', updatedAt: T0 + 1000 },
      { userId: 'u1', versionId: 'v1', purposeId: 'exp', status: 'granted', source: 'user', updatedAt: T0 + 1000 },
      { userId: 'u2', versionId: 'v1', purposeId: 'essential', status: 'granted', source: 'user', updatedAt: T0 + 2000 },
      { userId: 'u2', versionId: 'v1', purposeId: 'exp', status: 'granted', source: 'user', updatedAt: T0 + 2000 },
      { userId: 'u3', versionId: 'v1', purposeId: 'essential', status: 'granted', source: 'user', updatedAt: T0 + 3000 },
      { userId: 'u3', versionId: 'v1', purposeId: 'exp', status: 'granted', source: 'user', updatedAt: T0 + 3000 },
      { userId: 'u4', versionId: 'v1', purposeId: 'essential', status: 'granted', source: 'user', updatedAt: T0 + 4000 },
      { userId: 'u4', versionId: 'v1', purposeId: 'exp', status: 'denied', source: 'user', updatedAt: T0 + 4000 },
      { userId: 'u5', versionId: 'v1', purposeId: 'essential', status: 'granted', source: 'user', updatedAt: T0 + 5000 },
      { userId: 'u5', versionId: 'v1', purposeId: 'exp', status: 'granted', source: 'user', updatedAt: T0 + 5000 },
    ],
    snapshots: [],
  };
}
