import { useState } from 'react';
import type { ConsentRecord, ID, PolicyVersion, RegionRule, UserProfile } from '../types';
import { effectiveConsent, previewWithdrawal } from '../domain/consent';
import { treeOrder } from '../domain/purposes';
import { FALLBACK_RULE, ruleForRegion } from '../domain/rules';
import { sourceText, statusText } from '../domain/text';
import { genId, type Action } from '../state/store';

interface Props {
  users: UserProfile[];
  records: ConsentRecord[];
  rules: RegionRule[];
  versions: PolicyVersion[];
  selectedUserId: ID;
  onSelectUser: (id: ID) => void;
  selectedVersionId: ID;
  onSelectVersion: (id: ID) => void;
  highlightPurposeIds: ID[];
  dispatch: (a: Action) => void;
}

export function UsersPanel(props: Props) {
  const { users, records, rules, versions, selectedUserId, onSelectUser, dispatch } = props;
  const [newName, setNewName] = useState('');
  const [newRegion, setNewRegion] = useState('CN');

  const user = users.find((u) => u.id === selectedUserId) ?? users[0];
  const version =
    versions.find((v) => v.id === props.selectedVersionId) ?? versions[0];
  const rule = user ? ruleForRegion(rules, user.region) : undefined;
  const effectiveRule = rule ?? FALLBACK_RULE;
  const regions = Array.from(new Set(rules.map((r) => r.region)));

  return (
    <div className="cols-2">
      <div className="card">
        <h2>示例用户</h2>
        <div className="user-list">
          {users.map((u) => (
            <div
              key={u.id}
              className={`user-item ${u.id === user?.id ? 'active' : ''}`}
              onClick={() => onSelectUser(u.id)}
            >
              <input
                className="input"
                value={u.name}
                onChange={(e) =>
                  dispatch({ type: 'user/update', id: u.id, patch: { name: e.target.value } })
                }
              />
              <input
                className="input mono region"
                value={u.region}
                list="region-options"
                title="用户所在地区（决定适用哪条规则）"
                onChange={(e) =>
                  dispatch({ type: 'user/update', id: u.id, patch: { region: e.target.value } })
                }
              />
              <button
                className="btn danger-text"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'user/remove', id: u.id });
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <datalist id="region-options">
          {regions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <div className="add-row">
          <input
            className="input"
            placeholder="姓名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="input mono region"
            placeholder="地区"
            value={newRegion}
            list="region-options"
            onChange={(e) => setNewRegion(e.target.value)}
          />
          <button
            className="btn primary"
            onClick={() => {
              if (!newName.trim()) return;
              dispatch({ type: 'user/add', id: genId('u'), name: newName, region: newRegion });
              setNewName('');
            }}
          >
            + 添加
          </button>
        </div>
      </div>

      {user && version && (
        <div className="card">
          <div className="card-header">
            <h2>
              同意记录 · {user.name}（{user.region}）
            </h2>
            <select
              className="select"
              value={version.id}
              onChange={(e) => props.onSelectVersion(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.status === 'draft' ? '（草稿）' : ''}
                </option>
              ))}
            </select>
          </div>
          {!rule && (
            <p className="warn">
              ⚠ 地区「{user.region}」未配置规则：迁移将受阻，此处按最严格回退规则展示（见「冲突」页）。
            </p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>用途</th>
                <th>当前状态</th>
                <th>来源</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {treeOrder(version.purposes).map(({ purpose: p, depth }) => {
                const eff = effectiveConsent(records, user.id, version.id, p.id, effectiveRule);
                const rec = records.find(
                  (r) => r.userId === user.id && r.versionId === version.id && r.purposeId === p.id,
                );
                const affected = previewWithdrawal(version, p.id, effectiveRule);
                return (
                  <tr key={p.id} className={props.highlightPurposeIds.includes(p.id) ? 'highlight' : ''}>
                    <td style={{ paddingLeft: 8 + depth * 20 }}>
                      {depth > 0 && <span className="muted">└ </span>}
                      {p.name}
                    </td>
                    <td>
                      {eff.confirmed ? (
                        <span className={`badge ${eff.status === 'granted' ? 'badge-granted' : 'badge-denied'}`}>
                          {statusText(eff.status)}
                        </span>
                      ) : (
                        <span className="badge badge-unset">
                          未确认 <span className="muted">（默认{statusText(eff.status)}）</span>
                        </span>
                      )}
                    </td>
                    <td className="muted">{rec ? sourceText(rec.source) : '—'}</td>
                    <td className="muted small">
                      {rec ? new Date(rec.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                    </td>
                    <td className="actions">
                      <button
                        className="btn"
                        disabled={rec?.status === 'granted'}
                        onClick={() =>
                          dispatch({
                            type: 'consent/set',
                            userId: user.id,
                            versionId: version.id,
                            purposeId: p.id,
                            status: 'granted',
                          })
                        }
                      >
                        同意
                      </button>
                      <button
                        className="btn"
                        disabled={rec?.status === 'denied'}
                        title={
                          affected.length > 1
                            ? `撤回将级联影响下游 ${affected.length - 1} 个用途`
                            : '撤回此用途'
                        }
                        onClick={() =>
                          dispatch({
                            type: 'consent/withdraw',
                            userId: user.id,
                            versionId: version.id,
                            purposeId: p.id,
                          })
                        }
                      >
                        撤回{affected.length > 1 ? `（含下游 ${affected.length - 1}）` : ''}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
