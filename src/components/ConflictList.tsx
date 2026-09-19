import type { Conflict } from '../core/types';

const CODE_LABEL: Record<string, string> = {
  version_fork: '版本分叉',
  mapping_cycle: '映射循环',
  purpose_cycle: '用途循环/悬空',
  merge_conflict: '合并冲突',
  region_mismatch: '地区不匹配',
  unmapped_purpose: '缺少映射',
  mapping_target_missing: '映射目标缺失',
  mapping_source_missing: '映射来源缺失',
  published_version_mutated: '修改已发布版本',
  required_withdrawn: '必要用途不可撤回',
};

export function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div>
      {conflicts.map((c, i) => (
        <div className="conflict-item" key={`${c.code}-${i}`}>
          <div className="conflict-title">
            <span className="badge conflict">{CODE_LABEL[c.code] ?? c.code}</span>
          </div>
          <p className="conflict-msg">{c.message}</p>
          <div className="loc-tags">
            {c.location.versionId && (
              <span className="loc-tag" title="版本">version: {c.location.versionId}</span>
            )}
            {c.location.purposeId && (
              <span className="loc-tag" title="用途">purpose: {c.location.purposeId}</span>
            )}
            {c.location.mappingId && (
              <span className="loc-tag" title="映射">mapping: {c.location.mappingId}</span>
            )}
            {c.location.userId && (
              <span className="loc-tag" title="用户">user: {c.location.userId}</span>
            )}
            {c.location.region && (
              <span className="loc-tag" title="地区">region: {c.location.region}</span>
            )}
            {c.location.path && c.location.path.length > 0 && (
              <span className="loc-tag" title="环路径">
                path: {c.location.path.join(' → ')}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
