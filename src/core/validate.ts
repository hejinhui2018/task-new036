import type { Conflict, WorkbenchData } from './types';
import { findMappingCycle, findPurposeCycle } from './graph';

/** 对整份工作台数据做静态校验，返回全部可定位的冲突（编辑器与演练共用）。 */
export function validateData(data: WorkbenchData): Conflict[] {
  const conflicts: Conflict[] = [];
  const versionById = new Map(data.versions.map((v) => [v.id, v]));

  // 1. 用途图环 + 悬空父级/依赖
  for (const v of data.versions) {
    const ids = new Set(v.purposes.map((p) => p.id));
    const cycle = findPurposeCycle(v.purposes);
    if (cycle) {
      conflicts.push({
        code: 'purpose_cycle',
        message: `版本「${v.label}」用途图存在循环引用：${cycle.join(' → ')}。`,
        location: { versionId: v.id, path: cycle },
      });
    }
    for (const p of v.purposes) {
      if (p.parentId && !ids.has(p.parentId)) {
        conflicts.push({
          code: 'purpose_cycle',
          message: `用途「${p.name}」的父级「${p.parentId}」在版本「${v.label}」中不存在（悬空层级引用）。`,
          location: { versionId: v.id, purposeId: p.id },
        });
      }
      for (const dep of p.dependsOn ?? []) {
        if (!ids.has(dep)) {
          conflicts.push({
            code: 'purpose_cycle',
            message: `用途「${p.name}」依赖的下游用途「${dep}」在版本「${v.label}」中不存在（悬空依赖）。`,
            location: { versionId: v.id, purposeId: p.id, path: [p.id, dep] },
          });
        }
      }
    }
  }

  // 2. 版本继承：父版本必须存在
  for (const v of data.versions) {
    if (v.parentVersionId && !versionById.has(v.parentVersionId)) {
      conflicts.push({
        code: 'version_fork',
        message: `版本「${v.label}」声明的父版本「${v.parentVersionId}」不存在。`,
        location: { versionId: v.id },
      });
    }
  }

  // 3. 映射环
  const mappingCycle = findMappingCycle(data.mappings);
  if (mappingCycle) {
    conflicts.push({
      code: 'mapping_cycle',
      message: `版本间用途映射存在循环引用：${mappingCycle.path.join(' → ')}。旧同意将无法判定迁移方向。`,
      location: { mappingId: mappingCycle.mappingIds[0], path: mappingCycle.path },
    });
  }

  // 4. 单条映射的版本/用途存在性
  for (const m of data.mappings) {
    const fromV = versionById.get(m.fromVersionId);
    const toV = versionById.get(m.toVersionId);
    if (!fromV) {
      conflicts.push({
        code: 'mapping_source_missing',
        message: `映射 ${m.id} 的源版本「${m.fromVersionId}」不存在。`,
        location: { mappingId: m.id, versionId: m.fromVersionId },
      });
      continue;
    }
    if (!toV) {
      conflicts.push({
        code: 'mapping_target_missing',
        message: `映射 ${m.id} 的目标版本「${m.toVersionId}」不存在。`,
        location: { mappingId: m.id, versionId: m.toVersionId },
      });
      continue;
    }
    if (!fromV.purposes.some((p) => p.id === m.sourcePurposeId)) {
      conflicts.push({
        code: 'mapping_source_missing',
        message: `映射 ${m.id} 的源用途「${m.sourcePurposeId}」不在版本「${fromV.label}」中。`,
        location: { mappingId: m.id, versionId: fromV.id, purposeId: m.sourcePurposeId },
      });
    }
    if (!toV.purposes.some((p) => p.id === m.targetPurposeId)) {
      conflicts.push({
        code: 'mapping_target_missing',
        message: `映射 ${m.id} 的目标用途「${m.targetPurposeId}」不在版本「${toV.label}」中。`,
        location: { mappingId: m.id, versionId: toV.id, purposeId: m.targetPurposeId },
      });
    }
  }

  // 5. 地区规则引用的用途必须在至少一个版本里存在（提示性，按版本定位从略）
  const allPurposeIds = new Set<string>();
  for (const v of data.versions) for (const p of v.purposes) allPurposeIds.add(p.id);
  for (const r of data.regions) {
    for (const id of [...(r.requiredPurposeIds ?? []), ...(r.prohibitedPurposeIds ?? [])]) {
      if (!allPurposeIds.has(id)) {
        conflicts.push({
          code: 'region_mismatch',
          message: `地区「${r.name}(${r.code})」引用了不存在的用途「${id}」。`,
          location: { region: r.code, purposeId: id },
        });
      }
    }
  }

  // 6. 同意记录的版本/用户/地区一致性
  for (const rec of data.records) {
    if (!versionById.has(rec.versionId)) {
      conflicts.push({
        code: 'region_mismatch',
        message: `同意记录 ${rec.id} 引用的版本「${rec.versionId}」不存在。`,
        location: { userId: rec.userId, versionId: rec.versionId },
      });
    }
    if (!data.users.some((u) => u.id === rec.userId)) {
      conflicts.push({
        code: 'region_mismatch',
        message: `同意记录 ${rec.id} 属于不存在的用户「${rec.userId}」。`,
        location: { userId: rec.userId, versionId: rec.versionId },
      });
    }
    if (!data.regions.some((r) => r.code === rec.region)) {
      conflicts.push({
        code: 'region_mismatch',
        message: `用户「${rec.userId}」的同意记录地区为「${rec.region}」，但没有该地区规则。`,
        location: { userId: rec.userId, region: rec.region, versionId: rec.versionId },
      });
    }
  }

  return conflicts;
}
