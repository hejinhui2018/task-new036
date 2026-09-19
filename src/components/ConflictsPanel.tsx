import type { Conflict, ConflictKind } from '../domain/conflicts';
import { conflictKindText } from '../domain/text';

interface Props {
  conflicts: Conflict[];
  onLocate: (c: Conflict) => void;
}

const KIND_ICON: Record<ConflictKind, string> = {
  'version-fork': '⑂',
  'purpose-merge': '⊕',
  'circular-ref': '⟳',
  'region-mismatch': '⚑',
};

const KIND_ORDER: ConflictKind[] = ['version-fork', 'purpose-merge', 'circular-ref', 'region-mismatch'];

export function ConflictsPanel({ conflicts, onLocate }: Props) {
  if (conflicts.length === 0) {
    return (
      <div className="card">
        <h2>冲突</h2>
        <p className="muted">当前没有检测到冲突。版本分叉、用途合并分歧、循环引用、地区不匹配都会在此列出并可定位。</p>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>冲突（{conflicts.length}）</h2>
      <p className="muted">点击「定位」跳转到相关版本/用户并高亮相关用途。</p>
      {KIND_ORDER.map((kind) => {
        const items = conflicts.filter((c) => c.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className="conflict-group">
            <h3>
              {KIND_ICON[kind]} {conflictKindText(kind)}（{items.length}）
            </h3>
            {items.map((c) => (
              <div key={c.id} className={`conflict-item conflict-${c.kind}`}>
                <div className="conflict-body">
                  <div className="conflict-title">{c.title}</div>
                  <div className="muted">{c.detail}</div>
                </div>
                <button className="btn" onClick={() => onLocate(c)}>
                  定位
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
