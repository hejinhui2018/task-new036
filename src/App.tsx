import { useEffect, useState } from 'react';
import { StoreProvider, useStore, useUndoRedoShortcuts } from './state/StoreContext';
import { SimulationPage } from './pages/SimulationPage';
import { VersionsPage } from './pages/VersionsPage';
import { RegionsPage } from './pages/RegionsPage';
import { RecordsPage } from './pages/RecordsPage';
import { SnapshotsPage } from './pages/SnapshotsPage';

type Tab = 'sim' | 'versions' | 'regions' | 'records' | 'snapshots';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sim', label: '迁移演练' },
  { id: 'versions', label: '版本与用途' },
  { id: 'regions', label: '地区规则' },
  { id: 'records', label: '用户与同意记录' },
  { id: 'snapshots', label: '检查与快照' },
];

function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { state, dispatch, canUndo, canRedo } = useStore();
  return (
    <header className="app-header">
      <div>
        <div className="app-logo">
          <span className="dot" />
          ConsentPath
        </div>
        <div className="app-sub">隐私同意迁移演练台 · 数据仅保存在本浏览器</div>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn sm"
          disabled={!canUndo}
          onClick={() => dispatch({ type: 'undo' })}
          title="撤销 (Ctrl/Cmd+Z)"
        >
          ↶ 撤销
        </button>
        <button
          className="btn sm"
          disabled={!canRedo}
          onClick={() => dispatch({ type: 'redo' })}
          title="重做 (Ctrl/Cmd+Shift+Z)"
        >
          ↷ 重做
        </button>
      </div>
      {state.notice && (
        <div
          className="notice-toast"
          onClick={() => dispatch({ type: 'notice/clear' })}
          title="点击关闭"
        >
          {state.notice}
        </div>
      )}
    </header>
  );
}

function AppInner() {
  const [tab, setTab] = useState<Tab>('sim');
  useUndoRedoShortcuts();

  // notice 自动消失
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => dispatch({ type: 'notice/clear' }), 3500);
    return () => clearTimeout(t);
  }, [state.notice, dispatch]);

  return (
    <>
      <Header tab={tab} onTab={setTab} />
      <main className="layout">
        {tab === 'sim' && <SimulationPage />}
        {tab === 'versions' && <VersionsPage />}
        {tab === 'regions' && <RegionsPage />}
        {tab === 'records' && <RecordsPage />}
        {tab === 'snapshots' && <SnapshotsPage />}
      </main>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  );
}
