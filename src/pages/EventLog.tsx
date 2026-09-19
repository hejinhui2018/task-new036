import { useStore } from '../state/StoreContext';
import { ConflictList } from '../components/ConflictList';

const TYPE_LABEL: Record<string, string> = {
  migrate: '版本迁移',
  withdraw: '部分撤回',
  reconfirm: '重新确认',
  grant: '授予',
  conflict: '冲突',
};

export function EventLog() {
  const { state, dispatch } = useStore();
  const events = [...state.events].reverse();

  return (
    <div className="card">
      <div className="section-title">
        演练事件日志
        <span className="spacer" />
        <button
          className="btn sm ghost"
          disabled={events.length === 0}
          onClick={() => dispatch({ type: 'sim/clearEvents' })}
        >
          清空
        </button>
      </div>
      {events.length === 0 ? (
        <div className="empty-hint">
          还没有演练操作。选择用户与版本后点击「执行迁移」，再尝试撤回与重新确认。
        </div>
      ) : (
        events.map((e) => {
          const user = state.data.users.find((u) => u.id === e.userId);
          const version = state.data.versions.find((v) => v.id === e.versionId);
          return (
            <div key={e.id} className={`event-item ${e.type}`}>
              <div className="event-meta">
                <strong>{TYPE_LABEL[e.type] ?? e.type}</strong>
                <span>{user?.name ?? e.userId}</span>
                <span>{version?.label ?? e.versionId}</span>
                <span>{new Date(e.at).toLocaleString()}</span>
              </div>
              <p className="event-detail">{e.detail}</p>
              <div className="event-meta">
                用途：{e.purposeIds.map((id) => {
                  const p = version?.purposes.find((x) => x.id === id);
                  return p?.name ?? id;
                }).join('、')}
              </div>
              <details>
                <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
                  操作后有效状态（{Object.keys(e.resultingState).length} 项）
                </summary>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(e.resultingState).map(([id, val]) => (
                    <span key={id} className={`choice-pill ${val === 'granted' ? 'on' : 'off'}`}>
                      {id}: {val === 'granted' ? '同意' : '拒绝'}
                    </span>
                  ))}
                </div>
              </details>
              {e.conflicts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <ConflictList conflicts={e.conflicts} />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
