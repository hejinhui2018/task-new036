import type {
  ConsentValue,
  Conflict,
  PrivacyVersion,
  PurposeId,
  RegionCode,
  RegionRule,
} from './types';
import { expandToLeaves, leafPurposes } from './graph';

/** 地区默认值：opt-in 默认拒绝；opt-out / notice 默认允许。 */
export function regionDefault(mode: RegionRule['mode']): ConsentValue {
  return mode === 'opt-in' ? 'denied' : 'granted';
}

export function findRegion(
  regions: RegionRule[],
  code: RegionCode,
): RegionRule | null {
  return regions.find((r) => r.code === code) ?? null;
}

/** 若 id 是用途组，展开为其下全部叶子；若是叶子则返回自身（定义在 graph.ts，此处转出供旧引用使用）。 */
export { expandToLeaves } from './graph';

export interface EffectiveState {
  /** 每个叶子用途的有效值（已含地区强制、默认值与依赖继承） */
  values: Record<PurposeId, ConsentValue>;
  /** 每个叶子用途的授权来源：自身选择 / 默认值 / 上游继承 */
  grantedBy: Record<PurposeId, Array<'self' | 'default' | PurposeId>>;
  conflicts: Conflict[];
}

/**
 * 计算一份原始勾选在给定版本 + 地区规则下的「有效同意状态」。
 *
 * 规则优先级：
 *  1. 地区禁止用途 → 恒 denied（显式勾选也无效，给冲突）
 *  2. 必要用途 → 恒 granted（显式拒绝也无效，给冲突）
 *  3. 显式选择 > 地区默认值
 *  4. 依赖边：任一有效 granted 的上游会隐含授权下游；
 *     但显式拒绝永远最强（可独立拒绝下游），撤回上游后若无其他来源即失效。
 *
 * 调用方需保证用途图无环（环由校验器先报出）。
 */
export function effectiveState(
  version: PrivacyVersion,
  rawChoices: Record<PurposeId, ConsentValue>,
  region: RegionRule | null,
  regionCode: RegionCode,
  /**
   * 待确认用途集合（严格迁移下未映射/合并冲突的用途）。
   * 在用户重新确认前，即便存在已授权上游也不得生效；显式授予会解除该暂停。
   */
  suspended: ReadonlySet<PurposeId> = new Set(),
): EffectiveState {
  const conflicts: Conflict[] = [];
  const purposes = version.purposes;
  const leaves = leafPurposes(purposes);
  const leafIds = new Set(leaves.map((p) => p.id));

  if (!region) {
    conflicts.push({
      code: 'region_mismatch',
      message: `用户地区「${regionCode}」没有配置规则，已按最保守的 opt-in 默认拒绝处理。`,
      location: { versionId: version.id, region: regionCode },
    });
  }
  const mode = region?.mode ?? 'opt-in';
  const required = new Set(region?.requiredPurposeIds ?? []);
  const prohibited = new Set(region?.prohibitedPurposeIds ?? []);

  // 仅在叶子之间建立依赖边（组自动展开为叶子）
  // dependsOn 语义：p.dependsOn 列出的是 p 依赖的「上游」用途；
  // 任一上游有效授权即隐含授权 p；上游全部失效则 p 随之失效。
  const predecessors = new Map<PurposeId, Set<PurposeId>>();
  for (const id of leafIds) predecessors.set(id, new Set());
  for (const p of purposes) {
    if (!leafIds.has(p.id)) continue;
    for (const dep of p.dependsOn ?? []) {
      for (const upstream of expandToLeaves(purposes, dep)) {
        if (upstream !== p.id) predecessors.get(p.id)?.add(upstream);
      }
    }
  }

  // 顶层（无依赖入边）优先的拓扑序
  const order: PurposeId[] = [];
  const visited = new Set<PurposeId>();
  const visit = (id: PurposeId, stack: Set<PurposeId>) => {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // 有环时不做继承计算（环已在校验阶段报出）
    stack.add(id);
    for (const pred of predecessors.get(id) ?? []) visit(pred, stack);
    stack.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of leafIds) visit(id, new Set());

  const values: Record<PurposeId, ConsentValue> = {};
  const grantedBy: Record<PurposeId, Array<'self' | 'default' | PurposeId>> = {};

  for (const id of order) {
    const sources: Array<'self' | 'default' | PurposeId> = [];
    let value: ConsentValue;

    if (prohibited.has(id)) {
      value = 'denied';
      if (rawChoices[id] === 'granted') {
        conflicts.push({
          code: 'region_mismatch',
          message: `用途「${id}」在地区「${regionCode}」被禁止，用户的勾选不产生授权。`,
          location: { versionId: version.id, purposeId: id, region: regionCode },
        });
      }
    } else if (required.has(id)) {
      value = 'granted';
      sources.push('self');
      if (rawChoices[id] === 'denied') {
        conflicts.push({
          code: 'required_withdrawn',
          message: `用途「${id}」是地区「${regionCode}」的必要用途，拒绝/撤回无效，仍视为已同意。`,
          location: { versionId: version.id, purposeId: id, region: regionCode },
        });
      }
    } else {
      const raw = rawChoices[id];
      const preds = predecessors.get(id) ?? new Set<PurposeId>();
      const hasPreds = preds.size > 0;
      const grantedPreds = [...preds].filter((pred) => values[pred] === 'granted');

      if (raw === 'denied') {
        // 显式拒绝永远最强
        value = 'denied';
      } else if (hasPreds) {
        // 下游用途：有效上游是必要条件——即便用户显式授予下游，
        // 上游全部失效时下游也不能生效（撤回级联在 opt-out/notice 地区同样成立）。
        // 用户尚未重新确认前，暂停态压过上游推断。
        const awaiting = suspended.has(id) && raw !== 'granted';
        value = !awaiting && grantedPreds.length > 0 ? 'granted' : 'denied';
        if (value === 'granted') sources.push(...grantedPreds);
        if (raw === 'granted') sources.push('self');
      } else {
        // 独立用途：显式选择 > 地区默认；待确认用途在确认前不按默认放开
        const awaiting = suspended.has(id) && raw !== 'granted';
        if (raw === 'granted') {
          value = 'granted';
          sources.push('self');
        } else if (!awaiting && regionDefault(mode) === 'granted') {
          value = 'granted';
          sources.push('default');
        } else {
          value = 'denied';
          sources.push('default');
        }
      }
    }

    values[id] = value;
    grantedBy[id] = sources;
  }

  return { values, grantedBy, conflicts };
}
