import { useState } from 'react';
import { useStore } from '../state/StoreContext';
import type { RegionRule } from '../core/types';

const MODE_DESC: Record<RegionRule['mode'], string> = {
  'opt-in': '必须显式同意，默认拒绝（GDPR 式）',
  'opt-out': '默认允许，可显式拒绝',
  notice: '仅告知，无需选择，恒为允许',
};

export function RegionsPage() {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState<string | null>(null);

  const blank = (): RegionRule => ({
    code: '',
    name: '',
    mode: 'opt-in',
    requiredPurposeIds: [],
    prohibitedPurposeIds: [],
    migrationPolicy: 'strict',
  });

  const allPurposeOptions = Array.from(
    new Set(
      state.data.versions.flatMap((v) =>
        v.purposes.filter((p) => !p.isGroup).map((p) => [v.id, p.id, p.name] as const),
      ),
    ),
  );

  return (
    <div className="card">
      <h2>地区同意规则</h2>
      <p className="desc">
        不同地区沿用各自的同意模式与迁移策略。必要用途恒为同意且不可撤回；被禁用途即便勾选也无效。
      </p>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setEditing(`__new_${Date.now()}`)}>
          + 新增地区规则
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>地区</th>
            <th>同意模式</th>
            <th>必要用途</th>
            <th>禁止用途</th>
            <th>迁移策略</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {state.data.regions.map((r) => (
            <tr key={r.code}>
              <td>
                <strong>{r.name}</strong>
                <div className="purpose-id">{r.code}</div>
              </td>
              <td>{MODE_DESC[r.mode]}</td>
              <td>{(r.requiredPurposeIds ?? []).join('、') || '—'}</td>
              <td>{(r.prohibitedPurposeIds ?? []).join('、') || '—'}</td>
              <td>{r.migrationPolicy === 'notice' ? '通知模式（默认生效）' : '严格（需重新确认）'}</td>
              <td>
                <button className="btn sm" onClick={() => setEditing(r.code)}>编辑</button>{' '}
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    if (confirm(`删除地区「${r.name}」？相关用户将出现地区不匹配。`)) {
                      dispatch({ type: 'region/delete', code: r.code });
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

      {editing && (
        <RegionEditor
          initial={state.data.regions.find((r) => r.code === editing) ?? blank()}
          isNew={!state.data.regions.some((r) => r.code === editing)}
          options={allPurposeOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RegionEditor({
  initial,
  isNew,
  options,
  onClose,
}: {
  initial: RegionRule;
  isNew: boolean;
  options: readonly (readonly [string, string, string])[];
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [rule, setRule] = useState<RegionRule>(initial);
  const [requiredText, setRequiredText] = useState((initial.requiredPurposeIds ?? []).join(', '));
  const [prohibitedText, setProhibitedText] = useState((initial.prohibitedPurposeIds ?? []).join(', '));

  const save = () => {
    if (!rule.code.trim() || !rule.name.trim()) {
      alert('地区代码与名称不能为空。');
      return;
    }
    if (isNew && state.data.regions.some((r) => r.code === rule.code)) {
      alert('该地区代码已存在。');
      return;
    }
    dispatch({
      type: 'region/upsert',
      region: {
        ...rule,
        requiredPurposeIds: parseList(requiredText),
        prohibitedPurposeIds: parseList(prohibitedText),
      },
    });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 560, margin: 20, marginBottom: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{isNew ? '新增地区规则' : `编辑地区 ${rule.code}`}</h2>
        <div className="field-row">
          <div className="field">
            <label>地区代码（如 EU / CN / US）</label>
            <input
              value={rule.code}
              disabled={!isNew}
              onChange={(e) => setRule({ ...rule, code: e.target.value.trim() })}
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>名称</label>
            <input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>同意模式</label>
            <select
              value={rule.mode}
              onChange={(e) => setRule({ ...rule, mode: e.target.value as RegionRule['mode'] })}
            >
              <option value="opt-in">{MODE_DESC['opt-in']}</option>
              <option value="opt-out">{MODE_DESC['opt-out']}</option>
              <option value="notice">{MODE_DESC.notice}</option>
            </select>
          </div>
          <div className="field">
            <label>迁移策略</label>
            <select
              value={rule.migrationPolicy ?? 'strict'}
              onChange={(e) =>
                setRule({ ...rule, migrationPolicy: e.target.value as 'strict' | 'notice' })
              }
            >
              <option value="strict">严格：未映射用途必须重新确认</option>
              <option value="notice">通知：未映射用途按默认规则生效</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>必要用途 ID（逗号分隔，恒同意、不可撤回）</label>
          <input value={requiredText} onChange={(e) => setRequiredText(e.target.value)} />
        </div>
        <div className="field">
          <label>禁止用途 ID（逗号分隔，勾选也无效）</label>
          <input value={prohibitedText} onChange={(e) => setProhibitedText(e.target.value)} />
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>
          已知叶子用途：
          {options.map(([v, id, name]) => (
            <span key={`${v}:${id}`} className="loc-tag" style={{ marginRight: 4, color: 'var(--text-muted)', borderColor: 'var(--border-strong)', background: 'var(--gray-weak)' }}>
              {v}/{id}（{name}）
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={save}>保存</button>
          <button className="btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

function parseList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
