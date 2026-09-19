import type { RegionRule } from '../types';

/** 按地区代码查找规则（大小写不敏感） */
export function ruleForRegion(rules: RegionRule[], region: string): RegionRule | undefined {
  const target = region.trim().toLowerCase();
  return rules.find((r) => r.region.trim().toLowerCase() === target);
}

/** 地区无匹配规则时的最严格回退：仅用于展示，迁移仍会被阻止 */
export const FALLBACK_RULE: RegionRule = {
  region: '(回退)',
  model: 'opt-in',
  requireExplicitForNew: true,
  splitRequiresReconfirm: true,
  mergeStrategy: 'all',
  cascadeWithdraw: true,
};
