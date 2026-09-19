import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ID } from './types';
import type { Conflict } from './domain/conflicts';
import { detectConflicts } from './domain/conflicts';
import { appReducer, initAppState, persistAppState, type Action } from './state/store';
import { VersionPanel } from './components/VersionPanel';
import { RulesPanel } from './components/RulesPanel';
import { UsersPanel } from './components/UsersPanel';
import { RehearsalPanel } from './components/RehearsalPanel';
import { ConflictsPanel } from './components/ConflictsPanel';

export interface OpLogEntry {
  id: number;
  time: string;
  text: string;
}

type TabKey = 'versions' | 'rules' | 'users' | 'rehearsal' | 'conflicts';

let logSeq = 0;

export default function App() {
  const [app, dispatch] = useReducer(appReducer, 0, () => initAppState());
  const [tab, setTab] = useState<TabKey>('versions');
  const [selectedVersionId, setSelectedVersionId] = useState<ID | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<ID | null>(null);
  const [highlightPurposeIds, setHighlightPurposeIds] = useState<ID[]>([]);
  const [log, setLog] = useState<OpLogEntry[]>([]);
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapName, setSnapName] = useState('');

  const state = app.present;
  const conflicts = useMemo(() => detectConflicts(state), [state]);

  // 刷新恢复：每次状态变化后持久化到 localStorage
  useEffect(() => {
    persistAppState(app);
  }, [app]);

  const appendLog = (text: string) => {
    logSeq += 1;
    setLog((prev) =>
      [
        {
          id: logSeq,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          text,
        },
        ...prev,
      ].slice(0, 80),
    );
  };

  const selectedVersion =
    state.versions.find((v) => v.id === selectedVersionId) ?? state.versions[0] ?? null;
  const selectedUser = state.users.find((u) => u.id === selectedUserId) ?? state.users[0] ?? null;

  const locateConflict = (c: Conflict) => {
    if (c.location.versionId) setSelectedVersionId(c.location.versionId);
    if (c.location.userId) setSelectedUserId(c.location.userId);
    setHighlightPurposeIds(c.location.purposeIds ?? []);
    setTab(c.location.userId && c.kind !== 'version-fork' ? 'users' : 'versions');
  };

  const saveSnapshot = () => {
    const name = snapName.trim() || `快照 ${state.snapshots.length + 1}`;
    dispatch({ type: 'snapshot/save', name });
    appendLog(`保存情景快照「${name}」`);
    setSnapName('');
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'versions', label: '版本与用途' },
    { key: 'rules', label: '地区规则' },
    { key: 'users', label: '用户与同意' },
    { key: 'rehearsal', label: '迁移演练' },
    { key: 'conflicts', label: `冲突 (${conflicts.length})` },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          ConsentPath <span>隐私同意迁移演练台</span>
        </div>
        <div className="header-actions">
          <button
            className="btn"
            disabled={app.past.length === 0}
            title="撤销上一步操作"
            onClick={() => dispatch({ type: 'history/undo' })}
          >
            ⟲ 撤销{app.past.length > 0 ? ` (${app.past.length})` : ''}
          </button>
          <button
            className="btn"
            disabled={app.future.length === 0}
            title="重做"
            onClick={() => dispatch({ type: 'history/redo' })}
          >
            ⟳ 重做{app.future.length > 0 ? ` (${app.future.length})` : ''}
          </button>
          <div className="snapshot-wrap">
            <button className="btn" onClick={() => setSnapOpen((o) => !o)}>
              情景快照 ({state.snapshots.length}) ▾
            </button>
            {snapOpen && (
              <div className="snapshot-panel card">
                <div className="snap-save">
                  <input
                    className="input"
                    placeholder="快照名称，如：v2 发布前"
                    value={snapName}
                    onChange={(e) => setSnapName(e.target.value)}
                  />
                  <button className="btn primary" onClick={saveSnapshot}>
                    保存当前情景
                  </button>
                </div>
                {state.snapshots.length === 0 && <p className="muted">暂无快照</p>}
                {state.snapshots.map((s) => (
                  <div key={s.id} className="snap-item">
                    <div>
                      <div>{s.name}</div>
                      <div className="muted small">
                        {new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </div>
                    </div>
                    <div className="snap-actions">
                      <button
                        className="btn"
                        onClick={() => {
                          dispatch({ type: 'snapshot/restore', id: s.id });
                          appendLog(`恢复情景快照「${s.name}」`);
                        }}
                      >
                        恢复
                      </button>
                      <button
                        className="btn danger-text"
                        onClick={() => dispatch({ type: 'snapshot/delete', id: s.id })}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn danger"
            onClick={() => {
              if (window.confirm('确定要放弃当前全部数据并恢复示例数据吗？（可通过撤销找回）')) {
                dispatch({ type: 'reset' });
                appendLog('已恢复示例数据');
              }
            }}
          >
            恢复示例数据
          </button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''} ${
              t.key === 'conflicts' && conflicts.length > 0 ? 'has-conflicts' : ''
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === 'versions' && selectedVersion && (
          <VersionPanel
            versions={state.versions}
            selectedId={selectedVersion.id}
            onSelect={(id) => {
              setSelectedVersionId(id);
              setHighlightPurposeIds([]);
            }}
            highlightPurposeIds={highlightPurposeIds}
            dispatch={dispatch}
          />
        )}
        {tab === 'rules' && <RulesPanel rules={state.rules} dispatch={dispatch} />}
        {tab === 'users' && selectedUser && selectedVersion && (
          <UsersPanel
            users={state.users}
            records={state.records}
            rules={state.rules}
            versions={state.versions}
            selectedUserId={selectedUser.id}
            onSelectUser={setSelectedUserId}
            selectedVersionId={selectedVersion.id}
            onSelectVersion={setSelectedVersionId}
            highlightPurposeIds={highlightPurposeIds}
            dispatch={dispatch}
          />
        )}
        {tab === 'rehearsal' && (
          <RehearsalPanel
            state={state}
            selectedUserId={selectedUser?.id ?? null}
            onSelectUser={setSelectedUserId}
            dispatch={dispatch}
            log={log}
            onLog={appendLog}
          />
        )}
        {tab === 'conflicts' && <ConflictsPanel conflicts={conflicts} onLocate={locateConflict} />}
      </main>
    </div>
  );
}

export type { Action };
