import { useState } from 'react';
import { useStore } from '../state/StoreContext';
import type { ConsentRecord, ConsentValue, DemoUser } from '../core/types';
import { leafPurposes } from '../core/graph';
import { nowIso, uid } from '../core/id';

export function RecordsPage() {
  const { state, dispatch } = useStore();
  const [editingUser, setEditingUser] = useState<string | null>(null);

  const saveUser = (id: string, name: string, region: string) => {
    const user: DemoUser = { id, name, region };
    dispatch({ type: 'user/upsert', user });
    setEditingUser(null);
  };

  return (
    <div>
      <div className="card">
        <h2>示例用户</h2>
        <p className="desc">用户的地区决定适用哪套同意规则。新增用户后可在演练台直接选用。</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>姓名</th>
              <th>地区</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {state.data.users.map((u) => (
              <tr key={u.id}>
                <td className="mono">{u.id}</td>
                <td>
                  {editingUser === u.id ? (
                    <input
                      defaultValue={u.name}
                      autoFocus
                      onBlur={(e) => saveUser(u.id, e.target.value, u.region)}
                    />
                  ) : (
                    u.name
                  )}
                </td>
                <td>
                  {editingUser === `region:${u.id}` ? (
                    <select
                      defaultValue={u.region}
                      autoFocus
                      onChange={(e) => saveUser(u.id, u.name, e.target.value)}
                    >
                      {state.data.regions.map((r) => (
                        <option key={r.code} value={r.code}>{r.code} · {r.name}</option>
                      ))}
                      <option value={u.region}>{u.region}（无规则）</option>
                    </select>
                  ) : (
                    <span
                      className={
                        state.data.regions.some((r) => r.code === u.region)
                          ? 'choice-pill on'
                          : 'choice-pill off'
                      }
                    >
                      {u.region}
                      {state.data.regions.some((r) => r.code === u.region) ? '' : ' · 无规则'}
                    </span>
                  )}
                </td>
                <td>
                  <button className="btn sm" onClick={() => setEditingUser(u.id)}>改名</button>{' '}
                  <button className="btn sm" onClick={() => setEditingUser(`region:${u.id}`)}>
                    改地区
                  </button>{' '}
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      if (confirm(`删除用户「${u.name}」？其同意记录会一并删除。`)) {
                        dispatch({ type: 'user/delete', id: u.id });
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
        <div style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={() => {
              const id = prompt('新用户 ID', `u${Date.now().toString(36)}`);
              if (!id) return;
              if (state.data.users.some((u) => u.id === id)) {
                alert('用户 ID 已存在。');
                return;
              }
              saveUser(id, '新用户', state.data.regions[0]?.code ?? '');
            }}
          >
            + 新增用户
          </button>
        </div>
      </div>

      <div className="card">
        <h2>同意记录（原始勾选）</h2>
        <p className="desc">
          记录的是用户在某版本弹窗上「勾没勾选」。迁移引擎据此判断哪些用途能继承、哪些必须重新确认。
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>版本</th>
              <th>记录地区</th>
              <th>勾选内容</th>
              <th>时间 / 备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...state.data.records]
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .map((r) => {
                const user = state.data.users.find((u) => u.id === r.userId);
                const version = state.data.versions.find((v) => v.id === r.versionId);
                const regionOk = state.data.regions.some((x) => x.code === r.region);
                return (
                  <tr key={r.id}>
                    <td>{user?.name ?? r.userId}<div className="purpose-id">{r.userId}</div></td>
                    <td>{version?.label ?? r.versionId}</td>
                    <td>
                      <span className={`choice-pill ${regionOk ? 'on' : 'off'}`}>{r.region}</span>
                    </td>
                    <td>
                      {Object.entries(r.choices).map(([pid, val]) => (
                        <span
                          key={pid}
                          className="choice-pill"
                          style={{ marginRight: 4 }}
                        >
                          {pid}: {val === 'granted' ? '✓' : '✕'}
                        </span>
                      ))}
                    </td>
                    <td>
                      <div className="muted" style={{ fontSize: 11.5 }}>{new Date(r.at).toLocaleString()}</div>
                      {r.note && <div className="muted" style={{ fontSize: 12 }}>{r.note}</div>}
                    </td>
                    <td>
                      <RecordEditor record={r} />{' '}
                      <button
                        className="btn sm ghost"
                        onClick={() => dispatch({ type: 'record/delete', id: r.id })}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        <div style={{ marginTop: 10 }}>
          <NewRecordButton />
        </div>
      </div>
    </div>
  );
}

function RecordEditor({ record }: { record: ConsentRecord }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const version = state.data.versions.find((v) => v.id === record.versionId);
  const leaves = version ? leafPurposes(version.purposes) : [];
  const [choices, setChoices] = useState<Record<string, ConsentValue>>(record.choices);

  if (!version) return <button className="btn sm" disabled>编辑</button>;

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>编辑</button>
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 40,
          }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>编辑勾选 · {version.label}</h2>
            {leaves.map((p) => (
              <label key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{p.name} <span className="purpose-id">{p.id}</span></span>
                <select
                  value={choices[p.id] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const next = { ...choices };
                    if (val === '') delete next[p.id];
                    else next[p.id] = val as ConsentValue;
                    setChoices(next);
                  }}
                >
                  <option value="">未选择</option>
                  <option value="granted">同意</option>
                  <option value="denied">拒绝</option>
                </select>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="btn primary"
                onClick={() => {
                  dispatch({ type: 'record/upsert', record: { ...record, choices } });
                  setOpen(false);
                }}
              >
                保存
              </button>
              <button className="btn" onClick={() => setOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NewRecordButton() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(state.data.users[0]?.id ?? '');
  const [versionId, setVersionId] = useState(state.data.versions[0]?.id ?? '');
  const [choices, setChoices] = useState<Record<string, ConsentValue>>({});

  const version = state.data.versions.find((v) => v.id === versionId);
  const leaves = version ? leafPurposes(version.purposes) : [];
  const user = state.data.users.find((u) => u.id === userId);

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>+ 新增同意记录</button>
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 40,
          }}
          onClick={() => setOpen(false)}
        >
          <div className="card" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2>新增同意记录</h2>
            <div className="field-row">
              <div className="field">
                <label>用户</label>
                <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  {state.data.users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}（{u.region}）</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>版本</label>
                <select
                  value={versionId}
                  onChange={(e) => {
                    setVersionId(e.target.value);
                    setChoices({});
                  }}
                >
                  {state.data.versions.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {leaves.map((p) => (
              <label key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{p.name} <span className="purpose-id">{p.id}</span></span>
                <select
                  value={choices[p.id] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const next = { ...choices };
                    if (val === '') delete next[p.id];
                    else next[p.id] = val as ConsentValue;
                    setChoices(next);
                  }}
                >
                  <option value="">未选择</option>
                  <option value="granted">同意</option>
                  <option value="denied">拒绝</option>
                </select>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="btn primary"
                onClick={() => {
                  if (!user) return;
                  const record: ConsentRecord = {
                    id: uid('rec'),
                    userId,
                    versionId,
                    region: user.region,
                    choices,
                    at: nowIso(),
                    note: '手动补录',
                  };
                  dispatch({ type: 'record/upsert', record });
                  setOpen(false);
                }}
              >
                保存记录
              </button>
              <button className="btn" onClick={() => setOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
