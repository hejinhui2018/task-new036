import { useMemo } from 'react';
import type { ID, PolicyVersion, Purpose } from '../types';
import { deriveMappings, removedPurposes, treeOrder, type PurposeMapping } from '../domain/purposes';
import { mappingKindText } from '../domain/text';
import { genId, type Action } from '../state/store';

interface Props {
  versions: PolicyVersion[];
  selectedId: ID;
  onSelect: (id: ID) => void;
  highlightPurposeIds: ID[];
  dispatch: (a: Action) => void;
}

const MAPPING_BADGE: Record<PurposeMapping['kind'], string> = {
  carry: 'badge-carry',
  rename: 'badge-rename',
  split: 'badge-split',
  merge: 'badge-merge',
  new: 'badge-new',
};

export function VersionPanel({ versions, selectedId, onSelect, highlightPurposeIds, dispatch }: Props) {
  const version = versions.find((v) => v.id === selectedId) ?? versions[0];
  const base = version.baseVersionId
    ? versions.find((v) => v.id === version.baseVersionId)
    : undefined;
  const editable = version.status === 'draft';

  const mappingByPurpose = useMemo(() => {
    if (!base) return new Map<ID, PurposeMapping>();
    return new Map(deriveMappings(version, base).map((m) => [m.purposeId, m]));
  }, [version, base]);

  const removed = useMemo(
    () => (base ? removedPurposes(version, base) : []),
    [version, base],
  );

  const rows = useMemo(() => treeOrder(version.purposes), [version]);
  const hasChildren = versions.some((v) => v.baseVersionId === version.id);
  const labelOf = (id: ID) => versions.find((v) => v.id === id)?.label ?? id;

  const update = (purposeId: ID, patch: Partial<Purpose>) =>
    dispatch({ type: 'purpose/update', versionId: version.id, purposeId, patch });

  return (
    <div className="cols-2">
      <div className="card">
        <h2>说明版本</h2>
        <p className="muted">草稿可自由编辑；发布后不可变，只能基于它创建新草稿。</p>
        <div className="version-list">
          {versions.map((v) => (
            <button
              key={v.id}
              className={`version-item ${v.id === version.id ? 'active' : ''}`}
              onClick={() => onSelect(v.id)}
            >
              <span className="version-label">{v.label}</span>
              <span className={`badge ${v.status === 'draft' ? 'badge-draft' : 'badge-published'}`}>
                {v.status === 'draft' ? '草稿' : '已发布'}
              </span>
              {v.baseVersionId && <span className="muted small">基于 {labelOf(v.baseVersionId)}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <input
            className="input version-title"
            value={version.label}
            disabled={!editable}
            onChange={(e) => dispatch({ type: 'version/rename', id: version.id, label: e.target.value })}
          />
          <span className={`badge ${editable ? 'badge-draft' : 'badge-published'}`}>
            {editable ? '草稿' : '已发布 · 不可变'}
          </span>
        </div>
        <div className="toolbar">
          {editable && (
            <button
              className="btn primary"
              onClick={() => {
                if (window.confirm(`发布后「${version.label}」将不可修改，确认发布？`)) {
                  dispatch({ type: 'version/publish', id: version.id });
                }
              }}
            >
              发布此版本
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              const id = genId('v');
              dispatch({ type: 'version/createDraft', baseId: version.id, id });
              onSelect(id);
            }}
          >
            + 基于此版本新建草稿
          </button>
          {editable && (
            <button
              className="btn danger-text"
              disabled={hasChildren}
              title={hasChildren ? '已有后继版本，不能删除' : '删除此草稿'}
              onClick={() => {
                if (window.confirm(`确定删除草稿「${version.label}」？`)) {
                  dispatch({ type: 'version/deleteDraft', id: version.id });
                }
              }}
            >
              删除草稿
            </button>
          )}
        </div>

        {!editable && <p className="muted">已发布版本为不可变快照；如需调整请基于它新建草稿。</p>}
        {base && removed.length > 0 && (
          <p className="warn">
            ⚠ 旧版本用途 {removed.map((r) => `「${r.name}」`).join('、')} 未在新版本中映射，迁移时对应同意将失效。
          </p>
        )}

        <table className="table">
          <thead>
            <tr>
              <th>用途名称</th>
              <th>key</th>
              <th>父用途</th>
              {base && <th>迁移来源（{base.label}）</th>}
              {base && <th>映射</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ purpose: p, depth }) => {
              const mapping = mappingByPurpose.get(p.id);
              return (
                <tr key={p.id} className={highlightPurposeIds.includes(p.id) ? 'highlight' : ''}>
                  <td style={{ paddingLeft: 8 + depth * 20 }}>
                    {depth > 0 && <span className="muted">└ </span>}
                    <input
                      className="input"
                      value={p.name}
                      disabled={!editable}
                      onChange={(e) => update(p.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      value={p.key}
                      disabled={!editable}
                      onChange={(e) => update(p.id, { key: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={p.parentId ?? ''}
                      disabled={!editable}
                      onChange={(e) => update(p.id, { parentId: e.target.value || null })}
                    >
                      <option value="">（顶级）</option>
                      {version.purposes
                        .filter((q) => q.id !== p.id)
                        .map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  {base && (
                    <td>
                      <select
                        multiple
                        className="select multi"
                        size={Math.min(3, Math.max(2, base.purposes.length))}
                        value={p.derivedFrom}
                        disabled={!editable}
                        title="按住 Ctrl/⌘ 多选：0 个=新增，1 个=继承/拆分，多个=合并"
                        onChange={(e) =>
                          update(p.id, {
                            derivedFrom: Array.from(e.target.selectedOptions).map((o) => o.value),
                          })
                        }
                      >
                        {base.purposes.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {base && (
                    <td>
                      {mapping && (
                        <span
                          className={`badge ${MAPPING_BADGE[mapping.kind]}`}
                          title={
                            mapping.sources.length > 0
                              ? `来源：${mapping.sources
                                  .map((s) => base.purposes.find((b) => b.id === s)?.name ?? s)
                                  .join('、')}`
                              : '无来源（新增用途）'
                          }
                        >
                          {mappingKindText(mapping.kind)}
                        </span>
                      )}
                    </td>
                  )}
                  <td>
                    {editable && (
                      <button
                        className="btn danger-text"
                        onClick={() =>
                          dispatch({ type: 'purpose/remove', versionId: version.id, purposeId: p.id })
                        }
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable && (
          <button className="btn" onClick={() => dispatch({ type: 'purpose/add', versionId: version.id })}>
            + 新增用途
          </button>
        )}
      </div>
    </div>
  );
}
