import { useMemo, useState } from 'react';
import { useStore } from '../state/StoreContext';
import type { PrivacyVersion, PurposeMapping } from '../core/types';
import { uid } from '../core/id';
import { findMappingCycle } from '../core/graph';

/** 版本间用途映射编辑：一对 source→target 即拆分；多对一即合并。 */
export function MappingsEditor({
  version,
  frozen,
}: {
  version: PrivacyVersion;
  frozen: boolean;
}) {
  const { state, dispatch } = useStore();

  // 默认展示「父版本 → 当前版本」的映射；可切换
  const parentId = version.parentVersionId;
  const [pair, setPair] = useState<{ from: string; to: string }>(
    parentId ? { from: parentId, to: version.id } : { from: '', to: version.id },
  );

  const fromVersion = state.data.versions.find((v) => v.id === pair.from);
  const toVersion = state.data.versions.find((v) => v.id === pair.to);

  const mappings = useMemo(
    () =>
      state.data.mappings.filter(
        (m) => m.fromVersionId === pair.from && m.toVersionId === pair.to,
      ),
    [state.data.mappings, pair],
  );

  const cycle = useMemo(() => findMappingCycle(state.data.mappings), [state.data.mappings]);
  const cycleMappingIds = new Set(cycle?.mappingIds ?? []);

  const addMapping = () => {
    if (!fromVersion || !toVersion) {
      alert('请先选择有效的源版本与目标版本。');
      return;
    }
    const mapping: PurposeMapping = {
      id: uid('map'),
      fromVersionId: fromVersion.id,
      toVersionId: toVersion.id,
      sourcePurposeId: fromVersion.purposes[0]?.id ?? '',
      targetPurposeId: toVersion.purposes[0]?.id ?? '',
    };
    dispatch({ type: 'mapping/upsert', mapping });
  };

  const update = (m: PurposeMapping, patch: Partial<PurposeMapping>) => {
    dispatch({ type: 'mapping/upsert', mapping: { ...m, ...patch } });
  };

  return (
    <div className="card">
      <h2>版本间用途映射</h2>
      <p className="desc">
        一条「旧用途 → 新用途」规则决定旧同意的继承路径。
        一个旧用途指向多个新用途是<strong>拆分</strong>；多个旧用途指向同一个新用途是<strong>合并</strong>
        （来源状态不一致时迁移会报合并冲突）。映射首尾相接形成闭环会报循环引用。
      </p>
      <div className="field-row">
        <div className="field">
          <label>源版本</label>
          <select value={pair.from} onChange={(e) => setPair({ ...pair, from: e.target.value })}>
            <option value="">（请选择）</option>
            {state.data.versions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>目标版本</label>
          <select value={pair.to} onChange={(e) => setPair({ ...pair, to: e.target.value })}>
            {state.data.versions.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 0 auto' }}>
          <label>&nbsp;</label>
          <button className="btn sm primary" onClick={addMapping} disabled={!pair.from}>
            + 映射规则
          </button>
        </div>
      </div>

      {cycle && (
        <div className="conflict-item">
          <div className="conflict-title">⚠ 映射循环引用</div>
          <p className="conflict-msg">{cycle.path.join(' → ')}</p>
          <div className="loc-tags">
            {cycle.mappingIds.map((id) => (
              <span key={id} className="loc-tag">mapping: {id}</span>
            ))}
          </div>
        </div>
      )}

      {mappings.length === 0 ? (
        <div className="empty-hint">该版本对之间还没有映射规则。</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>旧用途（{fromVersion?.id}）</th>
              <th></th>
              <th style={{ width: '38%' }}>新用途（{toVersion?.id}）</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => {
              const sourceMissing = !fromVersion?.purposes.some((p) => p.id === m.sourcePurposeId);
              const targetMissing = !toVersion?.purposes.some((p) => p.id === m.targetPurposeId);
              return (
                <tr key={m.id} style={cycleMappingIds.has(m.id) ? { background: 'var(--danger-weak)' } : undefined}>
                  <td>
                    <select
                      value={m.sourcePurposeId}
                      style={{ width: '100%' }}
                      onChange={(e) => update(m, { sourcePurposeId: e.target.value })}
                    >
                      {(fromVersion?.purposes ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.id}{p.isGroup ? '·组' : ''}）
                        </option>
                      ))}
                    </select>
                    {sourceMissing && <span className="badge conflict" style={{ marginTop: 4 }}>来源缺失</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>→</td>
                  <td>
                    <select
                      value={m.targetPurposeId}
                      style={{ width: '100%' }}
                      onChange={(e) => update(m, { targetPurposeId: e.target.value })}
                    >
                      {(toVersion?.purposes ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}（{p.id}{p.isGroup ? '·组' : ''}）
                        </option>
                      ))}
                    </select>
                    {targetMissing && <span className="badge conflict" style={{ marginTop: 4 }}>目标缺失</span>}
                  </td>
                  <td>
                    <button
                      className="btn sm ghost"
                      onClick={() => dispatch({ type: 'mapping/delete', mappingId: m.id })}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {frozen && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          当前选中的版本已发布冻结，但映射规则属于版本间关系，仍可随时调整（演练将立即反映）。
        </p>
      )}
    </div>
  );
}
