import { useMemo, useState } from 'react';
import { useStore } from '../state/StoreContext';
import { validateData } from '../core/validate';
import { ConflictList } from '../components/ConflictList';

export function SnapshotsPage() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const conflicts = useMemo(() => validateData(state.data), [state.data]);
  const grouped = useMemo(() => {
    const byCode = new Map<string, typeof conflicts>();
    for (const c of conflicts) {
      byCode.set(c.code, [...(byCode.get(c.code) ?? []), c]);
    }
    return byCode;
  }, [conflicts]);

  const createSnapshot = () => {
    const finalName = name.trim() || `情景 ${state.snapshots.length + 1}`;
    dispatch({ type: 'snapshot/create', name: finalName, note: note.trim() || undefined });
    setName('');
    setNote('');
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consentpath-data-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed.versions || !parsed.mappings || !parsed.regions) {
          throw new Error('缺少必要字段（versions / mappings / regions）');
        }
        dispatch({
          type: 'state/replace',
          state: {
            data: parsed,
            events: [],
            sessions: {},
            snapshots: state.snapshots,
            notice: null,
          },
        });
        alert('数据已导入。');
      } catch (err) {
        alert(`导入失败：${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="card">
        <h2>规则健康检查</h2>
        <p className="desc">
          对当前全部草稿与发布数据做静态校验：版本分叉、用途合并隐患、循环引用、悬空映射、地区不匹配都会在此定位。
        </p>
        {conflicts.length === 0 ? (
          <div className="empty-hint" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
            ✓ 未发现静态规则冲突。
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {[...grouped.entries()].map(([code, list]) => (
                <span key={code} className="badge conflict">{code} × {list.length}</span>
              ))}
            </div>
            <ConflictList conflicts={conflicts} />
          </>
        )}
      </div>

      <div className="card">
        <h2>情景快照</h2>
        <p className="desc">
          快照会冻结当前的版本、用途、映射、地区、同意记录以及演练事件日志；恢复快照会整体回到该情景（该操作可撤销）。
          草稿本身也会自动保存在浏览器，刷新页面不会丢失。
        </p>
        <div className="field-row">
          <div className="field" style={{ flex: 1 }}>
            <label>快照名称</label>
            <input
              value={name}
              placeholder="例如：EU 用户 v1→v2 拆分演练"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>备注（可选）</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label>&nbsp;</label>
            <button className="btn primary" onClick={createSnapshot}>保存当前情景</button>
          </div>
        </div>

        {state.snapshots.length === 0 ? (
          <div className="empty-hint">还没有快照。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>保存时间</th>
                <th>规模</th>
                <th>备注</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {[...state.snapshots].reverse().map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="muted">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="muted">
                    {s.data.versions.length} 版本 · {s.data.mappings.length} 映射 ·{' '}
                    {s.data.records.length} 记录 · {s.events.length} 事件
                  </td>
                  <td className="muted">{s.note ?? '—'}</td>
                  <td>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        if (confirm(`恢复快照「${s.name}」？当前未保存的编辑可以用撤销找回。`)) {
                          dispatch({ type: 'snapshot/restore', id: s.id });
                        }
                      }}
                    >
                      恢复
                    </button>{' '}
                    <button
                      className="btn sm ghost"
                      onClick={() => {
                        if (confirm(`删除快照「${s.name}」？`)) {
                          dispatch({ type: 'snapshot/delete', id: s.id });
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>数据管理</h2>
        <p className="desc">全部数据只存于浏览器 localStorage。可以导出为 JSON 备份或在团队间传递情景。</p>
        <div className="toolbar">
          <button className="btn" onClick={exportJson}>导出数据 JSON</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            导入数据 JSON
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = '';
              }}
            />
          </label>
          <span className="spacer" />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('重置为内置示例数据？当前编辑可通过撤销找回（快照保留）。')) {
                dispatch({ type: 'state/reset' });
              }
            }}
          >
            重置为示例数据
          </button>
        </div>
      </div>
    </div>
  );
}
