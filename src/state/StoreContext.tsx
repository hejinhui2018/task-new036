import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  historyReducer,
  loadPersisted,
  persistState,
  type Action,
  type AppState,
} from './store';

interface StoreContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  canUndo: boolean;
  canRedo: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(
    historyReducer,
    undefined,
    () => ({ past: [], present: loadPersisted(), future: [] }),
  );

  // 刷新恢复：状态变化即写入 localStorage（草稿自动保存）
  useEffect(() => {
    persistState(history.present);
  }, [history.present]);

  const value = useMemo<StoreContextValue>(
    () => ({
      state: history.present,
      dispatch,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    }),
    [history],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 <StoreProvider> 内使用');
  return ctx;
}

/** 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl+Y 重做 */
export function useUndoRedoShortcuts() {
  const { dispatch, canUndo, canRedo } = useStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y') return;
      const inputFocused =
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (inputFocused) return;
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (canRedo) dispatch({ type: 'redo' });
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        if (canRedo) dispatch({ type: 'redo' });
      } else {
        e.preventDefault();
        if (canUndo) dispatch({ type: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, canUndo, canRedo]);
}

export function useAction() {
  const { dispatch } = useStore();
  return useCallback((action: Action) => dispatch(action), [dispatch]);
}
