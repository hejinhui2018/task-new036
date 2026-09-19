import type {
  Conflict,
  ConsentValue,
  MigratedPurpose,
  MigrationResult,
  PurposeId,
  VersionId,
  WorkbenchData,
} from './types';
import { findPurposeCycle, leafPurposes, purposeMap } from './graph';
import { effectiveState, expandToLeaves, findRegion } from './consent';

/** 目的版本是否为源版本的后继（沿 parentVersionId 链）。返回相邻版本链。 */
export function versionChain(
  versions: WorkbenchData['versions'],
  fromId: VersionId,
  toId: VersionId,
): PrivacyVersionChain | null {
  const byId = purposeMapVersion(versions);
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) return null;
  if (fromId === toId) return { chain: [from] };

  const reversed: WorkbenchData['versions'] = [to];
  let cur = to;
  const seen = new Set<VersionId>([to.id]);
  while (cur.parentVersionId) {
    const parent = byId.get(cur.parentVersionId);
    if (!parent) break;
    if (parent.id === fromId) {
      reversed.push(parent);
      return { chain: reversed.reverse() };
    }
    if (seen.has(parent.id)) {
      // 继承链本身成环（异常数据）
      return { chain: null, ancestryCycle: true };
    }
    seen.add(parent.id);
    reversed.push(parent);
    cur = parent;
  }
  return null;
}

interface PrivacyVersionChain {
  /** null 表示继承链存在环 */
  chain: WorkbenchData['versions'] | null;
  ancestryCycle?: boolean;
}

function purposeMapVersion(versions: WorkbenchData['versions']) {
  return new Map(versions.map((v) => [v.id, v]));
}

/** 找到用户在某版本上最近的一次同意记录。 */
export function latestRecord(
  data: WorkbenchData,
  userId: string,
  versionId: VersionId,
) {
  return (
    data.records
      .filter((r) => r.userId === userId && r.versionId === versionId)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null
  );
}

/**
 * 规划一次版本迁移：计算每个新用途在迁移后的值、来源与理由，并收集冲突。
 * 纯函数，不修改输入。
 */
export function planMigration(
  data: WorkbenchData,
  userId: string,
  fromVersionId: VersionId,
  toVersionId: VersionId,
): MigrationResult {
  const conflicts: Conflict[] = [];
  const fromV = data.versions.find((v) => v.id === fromVersionId);
  const toV = data.versions.find((v) => v.id === toVersionId);
  if (!fromV || !toV) {
    throw new Error(
      `planMigration: 版本不存在（from=${fromVersionId}, to=${toVersionId}）`,
    );
  }

  const user = data.users.find((u) => u.id === userId);
  const regionCode =
    user?.region ??
    latestRecord(data, userId, fromVersionId)?.region ??
    '';
  const region = findRegion(data.regions, regionCode);

  // 用途图环检测（两个版本都查，环会让继承与撤回级联不可信）
  for (const v of [fromV, toV]) {
    const cycle = findPurposeCycle(v.purposes);
    if (cycle) {
      conflicts.push({
        code: 'purpose_cycle',
        message: `版本「${v.label}」的用途图存在循环引用：${cycle.join(' → ')}。`,
        location: { versionId: v.id, path: cycle },
      });
    }
  }

  // 版本分叉检测：目标版本不在源版本的后继链上
  let chainWorks = false;
  const chainResult = versionChain(data.versions, fromVersionId, toVersionId);
  if (chainResult?.ancestryCycle) {
    conflicts.push({
      code: 'version_fork',
      message: `版本继承链存在循环引用，无法判定「${fromV.label}」与「${toV.label}」的先后关系。`,
      location: { versionId: toVersionId },
    });
  } else if (chainResult?.chain) {
    chainWorks = true;
  } else if (fromVersionId !== toVersionId) {
    conflicts.push({
      code: 'version_fork',
      message: `「${toV.label}」不是「${fromV.label}」的后继版本（版本分叉）。旧同意不能跨分叉自动继承，所有新用途都需要重新确认。`,
      location: { versionId: toVersionId },
    });
  } else {
    chainWorks = true;
  }

  // 旧版本上的有效同意
  const record = latestRecord(data, userId, fromVersionId);
  const oldEff = effectiveState(
    fromV,
    record?.choices ?? {},
    region,
    regionCode,
  );
  conflicts.push(...oldEff.conflicts);

  // 沿版本链逐跳复合映射关系，得到 目标叶子用途 -> 最初版本来源叶子集合。
  // 同版本“迁移”不经过映射：记录里已显式选择的用途沿用到当前状态，其余按地区默认。
  let lineage: Map<PurposeId, PurposeId[]>;
  if (fromVersionId === toVersionId) {
    lineage = new Map();
    if (record) {
      for (const leaf of leafPurposes(fromV.purposes)) {
        if (Object.prototype.hasOwnProperty.call(record.choices, leaf.id)) {
          lineage.set(leaf.id, [leaf.id]);
        }
      }
    }
  } else if (chainWorks) {
    lineage = composeLineage(data, chainResult!.chain!, conflicts);
  } else {
    lineage = new Map<PurposeId, PurposeId[]>();
  }

  const targetLeaves = leafPurposes(toV.purposes);
  const required = new Set(region?.requiredPurposeIds ?? []);
  const prohibited = new Set(region?.prohibitedPurposeIds ?? []);
  const policy = region?.migrationPolicy ?? 'strict';

  const rawChoices: Record<PurposeId, ConsentValue> = {};
  const prelim: Array<{
    purposeId: PurposeId;
    sources: PurposeId[];
    kind: MigratedPurpose['status'] | 'unmapped';
    explicit: boolean;
    reason: string;
  }> = [];

  for (const leaf of targetLeaves) {
    const sources = (lineage.get(leaf.id) ?? []).filter((s) =>
      leafPurposes(fromV.purposes).some((p) => p.id === s),
    );

    if (prohibited.has(leaf.id)) {
      prelim.push({
        purposeId: leaf.id,
        sources,
        kind: 'prohibited',
        explicit: false,
        reason: `用途「${leaf.name}」在地区「${regionCode}」被禁止，迁移后保持无效，任何旧授权都不延续。`,
      });
      continue;
    }
    if (required.has(leaf.id)) {
      prelim.push({
        purposeId: leaf.id,
        sources,
        kind: 'required',
        explicit: false,
        reason: `用途「${leaf.name}」是地区「${regionCode}」的必要用途，无需迁移即恒为已同意。`,
      });
      continue;
    }

    if (sources.length > 0) {
      const granted = sources.filter((s) => oldEff.values[s] === 'granted');
      const denied = sources.filter((s) => oldEff.values[s] === 'denied');
      if (granted.length > 0 && denied.length > 0) {
        // 用途合并：来源授权状态互相矛盾
        conflicts.push({
          code: 'merge_conflict',
          message: `新用途「${leaf.name}」由旧用途 ${sources
            .map((s) => `「${nameOf(fromV, s)}」`)
            .join('、')} 合并而来，但旧同意状态不一致（${granted
            .map((s) => nameOf(fromV, s))
            .join('、')} 已同意 / ${denied
            .map((s) => nameOf(fromV, s))
            .join('、')} 已拒绝），无法自动继承，必须重新确认。`,
          location: {
            versionId: toVersionId,
            purposeId: leaf.id,
            userId,
          },
        });
        prelim.push({
          purposeId: leaf.id,
          sources,
          kind: 'reconfirm',
          explicit: false,
          reason: `合并来源的旧同意互相矛盾：${granted
            .map((s) => `${nameOf(fromV, s)}=同意`)
            .join('，')}；${denied
            .map((s) => `${nameOf(fromV, s)}=拒绝`)
            .join('，')}。按最保守处理，等待用户重新确认。`,
        });
        continue;
      }
      const value: ConsentValue = granted.length > 0 ? 'granted' : 'denied';
      const explicit = sources.some(
        (s) => record?.choices?.[s] === value,
      );
      if (explicit) rawChoices[leaf.id] = value;
      prelim.push({
        purposeId: leaf.id,
        sources,
        kind: 'inherited',
        explicit,
        reason:
          value === 'granted'
            ? `旧版用途 ${sources
                .map((s) => `「${nameOf(fromV, s)}」`)
                .join('、')} 为已同意，经版本映射继承到「${leaf.name}」，授权继续有效。`
            : `旧版用途 ${sources
                .map((s) => `「${nameOf(fromV, s)}」`)
                .join('、')} 为已拒绝，拒绝状态同样继承，「${leaf.name}」迁移后保持关闭。`,
      });
      continue;
    }

    // 无任何旧来源
    if (fromVersionId === toVersionId) {
      prelim.push({
        purposeId: leaf.id,
        sources: [],
        kind: 'unmapped',
        explicit: false,
        reason: '该版本上没有历史选择，按地区默认规则处理。',
      });
    } else if (policy === 'strict') {
      conflicts.push({
        code: 'unmapped_purpose',
        message: `新用途「${leaf.name}」在旧版说明中没有对应用途（或映射链中断），地区「${regionCode}」采用严格迁移策略，必须重新确认。`,
        location: { versionId: toVersionId, purposeId: leaf.id, userId },
      });
      prelim.push({
        purposeId: leaf.id,
        sources: [],
        kind: 'reconfirm',
        explicit: false,
        reason: `旧版说明中找不到「${leaf.name}」的任何来源用途。严格策略下不能替用户推定同意，必须重新确认。`,
      });
    } else {
      prelim.push({
        purposeId: leaf.id,
        sources: [],
        kind: 'unmapped',
        explicit: false,
        reason: `旧版无对应用途；地区「${regionCode}」迁移策略为通知模式，按该地区默认规则（${
          region?.mode === 'opt-in' ? '默认拒绝' : '默认允许'
        }）生效。`,
      });
    }
  }

  // 在新版本上重算有效状态（地区强制 + 下游依赖继承）。
  // reconfirm 用途在用户确认前处于暂停：即使有已授权上游也不生效，保证预览与执行一致。
  const suspended = new Set(
    prelim.filter((p) => p.kind === 'reconfirm').map((p) => p.purposeId),
  );
  const newEff = effectiveState(toV, rawChoices, region, regionCode, suspended);
  conflicts.push(...newEff.conflicts);

  const purposes: MigratedPurpose[] = prelim.map((p) => {
    if (p.kind === 'unmapped') {
      const value = newEff.values[p.purposeId];
      return {
        purposeId: p.purposeId,
        value,
        status: 'default',
        sources: [],
        explicit: false,
        reason: p.reason,
      };
    }
    return {
      purposeId: p.purposeId,
      value: newEff.values[p.purposeId],
      status: p.kind,
      sources: p.sources,
      explicit: p.explicit,
      reason: p.reason,
    };
  });

  return {
    userId,
    region: regionCode,
    fromVersionId,
    toVersionId,
    purposes,
    conflicts,
    grantedPurposeIds: targetLeaves
      .map((p) => p.id)
      .filter((id) => newEff.values[id] === 'granted'),
    reconfirmPurposeIds: purposes
      .filter((p) => p.status === 'reconfirm')
      .map((p) => p.purposeId),
  };
}

/**
 * 沿版本链复合用途映射：
 * 对每一跳 (prev -> next)，把「当前用途 -> 最初来源集合」向前传播。
 * 组节点在传播时自动展开为其叶子。
 */
function composeLineage(
  data: WorkbenchData,
  chain: WorkbenchData['versions'],
  conflicts: Conflict[],
): Map<PurposeId, PurposeId[]> {
  // 起点：第一版每个叶子 -> 自身
  let current = new Map<PurposeId, PurposeId[]>();
  for (const leaf of leafPurposes(chain[0].purposes)) {
    current.set(leaf.id, [leaf.id]);
  }

  for (let i = 1; i < chain.length; i++) {
    const prevV = chain[i - 1];
    const nextV = chain[i];
    const prevById = purposeMap(prevV.purposes);
    const nextById = purposeMap(nextV.purposes);

    // 规范化到叶子层级的前向边：叶子来源 -> 叶子目标集合
    const forward = new Map<PurposeId, Set<PurposeId>>();
    for (const m of data.mappings) {
      if (m.fromVersionId !== prevV.id || m.toVersionId !== nextV.id) continue;

      const source = prevById.get(m.sourcePurposeId);
      const target = nextById.get(m.targetPurposeId);
      if (!source) {
        conflicts.push({
          code: 'mapping_source_missing',
          message: `映射 ${m.id} 引用的旧用途「${m.sourcePurposeId}」在版本「${prevV.label}」中不存在。`,
          location: { mappingId: m.id, versionId: prevV.id },
        });
        continue;
      }
      if (!target) {
        conflicts.push({
          code: 'mapping_target_missing',
          message: `映射 ${m.id} 指向的新用途「${m.targetPurposeId}」在版本「${nextV.label}」中不存在。`,
          location: { mappingId: m.id, versionId: nextV.id },
        });
        continue;
      }
      const sourceLeaves = expandToLeaves(prevV.purposes, source.id);
      const targetLeavesSet = expandToLeaves(nextV.purposes, target.id);
      for (const s of sourceLeaves) {
        const set = forward.get(s) ?? new Set<PurposeId>();
        targetLeavesSet.forEach((t) => set.add(t));
        forward.set(s, set);
      }
    }

    const next = new Map<PurposeId, PurposeId[]>();
    for (const [curId, origins] of current) {
      for (const sourceId of expandToLeaves(prevV.purposes, curId)) {
        for (const targetId of forward.get(sourceId) ?? []) {
          const merged = new Set(next.get(targetId) ?? []);
          origins.forEach((o) => merged.add(o));
          next.set(targetId, [...merged]);
        }
      }
    }
    current = next;
  }

  return current;
}

function nameOf(version: WorkbenchData['versions'][number], id: PurposeId) {
  return version.purposes.find((p) => p.id === id)?.name ?? id;
}
