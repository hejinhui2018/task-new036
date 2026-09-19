import { useMemo, useState } from 'react';
import type { DomainState, ID } from '../types';
import { findConsent, planMigration, type MigrationOutcome } from '../domain/migration';
import { previewWithdrawal } from '../domain/consent';
import { treeOrder } from '../domain/purposes';
import { FALLBACK_RULE, ruleForRegion } from '../domain/rules';
import { outcomeText } from '../domain/text';
import type { Action } from '../state/store';
import type { OpLogEntry } from '../App';

interface Props {
  state: DomainState;
  selectedUserId: ID | null;
  onSelectUser: (id: ID) => void;
  dispatch: (a: Action) => void;
  log: OpLogEntry[];
  onLog: (text: string) => void;
}

const OUTCOME_BADGE: Record<MigrationOutcome, string> = {
  inherited: 'badge-inherited',
  defaulted: 'badge-defaulted',
  'reconfirm-required': 'badge-reconfirm',
  invalidated: 'badge-invalidated',
  'already-exists': 'badge-skip',
  blocked: 'badge-blocked',
};

export function RehearsalPanel({ state, selectedUserId, onSelectUser, dispatch, log, onLog }: Props) {
  const targets = state.versions.filter(
    (v) => v.baseVersionId && state.versions.some((b) => b.id === v.baseVersionId),
  );
  const [targetId, setTargetId] = useState<ID | null>(null);
  const [withdrawPid, setWithdrawPid] = useState<ID | null>(null);

  const target = targets.find((t) => t.id === targetId) ?? targets[0] ?? null;
  const base = target ? state.versions.find((v) => v.id === target.baseVersionId) : undefined;
  const user = state.users.find((u) => u.id === selectedUserId) ?? state.users[0] ?? null;
  const rule = user ? ruleForRegion(state.rules, user.region) : undefined;

  // 实时预览：旧同意如何映射到新版本
  const decisions = useMemo(() => {
    if (!user || !target || !base) return null;
    return planMigration({
      user,
      fromVersion: base,
      toVersion: target,
      records: state.records,
      rule,
    });
  }, [user, target, base, state.records, rule]);

  const counts = useMemo(() => {
    const c = new Map<MigrationOutcome, number>();
    for (const d of decisions ?? []) c.set(d.outcome, (c.get(d.outcome) ?? 0) + 1);
    return c;
  }, [decisions]);

  const purposeName = (pid: ID) =>
    target?.purposes.find((p) => p.id === pid)?.name ?? pid;

  const withdrawTarget = withdrawPid ?? target?.purposes[0]?.id ?? null;
  const withdrawAffected = useMemo(() => {
    if (!target || !withdrawTarget) return [];
    return previewWithdrawal(target, withdrawTarget, rule ?? FALLBACK_RULE);
  }, [target, withdrawTarget, rule]);

  const pendingPurposes = useMemo(() => {
    if (!user || !target) return [];
    return target.purposes.filter(
      (p) => !findConsent(state.records, user.id, target.id, p.id),
    );
  }, [state.records, user, target]);

  if (!user) return <div className="card">请先在「用户与同意」页添加用户。</div>;

  const summarize = () =>
    (['inherited', 'defaulted', 'reconfirm-required', 'invalidated', 'already-exists', 'blocked'] as const)
      .map((k) => `${outcomeText(k)} ${counts.get(k) ?? 0}`)
      .join(' · ');

  return (
    <div className="rehearsal">
      <div className="card">
        <h2>迁移演练</h2>
        <div className="toolbar">
          <label>
            用户：
            <select className="select" value={user.id} onChange={(e) => onSelectUser(e.target.value)}>
              {state.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.region}）
                </option>
              ))}
            </select>
          </label>
          <label>
            目标版本：
            <select
              className="select"
              value={target?.id ?? ''}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.status === 'draft' ? '（草稿）' : ''}
                </option>
              ))}
            </select>
          </label>
          {target && base && (
            <span className="muted">
              {base.label} → {target.label}
              {rule ? ` · 适用规则：${rule.region}` : ` · 地区「${user.region}」无规则`}
            </span>
          )}
        </div>

        {decisions && target && (
          <>
            <div className="chips">
              {(['inherited', 'defaulted', 'reconfirm-required', 'invalidated', 'already-exists', 'blocked'] as const).map(
                (k) =>
                  (counts.get(k) ?? 0) > 0 && (
                    <span key={k} className={`badge ${OUTCOME_BADGE[k]}`}>
                      {outcomeText(k)} × {counts.get(k)}
                    </span>
                  ),
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>用途</th>
                  <th>结果</th>
                  <th>旧同意来源</th>
                  <th>说明（为何继承 / 失效 / 需重新确认）</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.purposeId}>
                    <td>{d.purposeName}</td>
                    <td>
                      <span className={`badge ${OUTCOME_BADGE[d.outcome]}`}>
                        {outcomeText(d.outcome)}
                        {d.status && (d.outcome === 'inherited' || d.outcome === 'defaulted')
                          ? `·${d.status === 'granted' ? '同意' : '拒绝'}`
                          : ''}
                      </span>
                    </td>
                    <td className="muted small">
                      {d.sources.length > 0
                        ? d.sources
                            .map(
                              (s) =>
                                `「${s.name}」${s.status ? `=${s.status === 'granted' ? '同意' : '拒绝'}` : '=无记录'}`,
                            )
                            .join('、')
                        : '—'}
                    </td>
                    <td className="reason">{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar">
              <button
                className="btn primary"
                disabled={!rule}
                title={rule ? '把可继承/默认的结果写入同意记录' : '地区无规则，无法迁移'}
                onClick={() => {
                  dispatch({ type: 'migration/apply', userId: user.id, toVersionId: target.id });
                  onLog(`迁移 ${user.name} → ${target.label}：${summarize()}`);
                }}
              >
                应用迁移（{user.name}）
              </button>
              <button
                className="btn"
                onClick={() => {
                  dispatch({ type: 'migration/applyAll', toVersionId: target.id });
                  onLog(`批量迁移全部 ${state.users.length} 名用户 → ${target.label}`);
                }}
              >
                应用迁移（全部用户）
              </button>
              <span className="muted small">重复应用是幂等的：已有记录的用途会被跳过。</span>
            </div>
          </>
        )}
      </div>

      <div className="cols-2">
        <div className="card">
          <h2>撤回演练</h2>
          {target && (
            <>
              <div className="toolbar">
                <label>
                  用途：
                  <select
                    className="select"
                    value={withdrawTarget ?? ''}
                    onChange={(e) => setWithdrawPid(e.target.value)}
                  >
                    {treeOrder(target.purposes).map(({ purpose: p, depth }) => (
                      <option key={p.id} value={p.id}>
                        {'　'.repeat(depth)}
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (!withdrawTarget) return;
                    dispatch({
                      type: 'consent/withdraw',
                      userId: user.id,
                      versionId: target.id,
                      purposeId: withdrawTarget,
                    });
                    const downstream = withdrawAffected.slice(1).map(purposeName);
                    onLog(
                      `撤回 ${user.name} 对「${purposeName(withdrawTarget)}」的同意（${target.label}）` +
                        (downstream.length > 0
                          ? `，级联影响下游用途：${downstream.join('、')}`
                          : '，无下游用途受影响'),
                    );
                  }}
                >
                  执行撤回
                </button>
              </div>
              <p className="muted">
                将影响：
                {withdrawAffected.map((pid, i) => (
                  <span key={pid} className={`chip ${i === 0 ? 'chip-self' : 'chip-downstream'}`}>
                    {purposeName(pid)}
                    {i === 0 ? '（自身）' : '（下游）'}
                  </span>
                ))}
                {(rule ?? FALLBACK_RULE).cascadeWithdraw
                  ? ' —— 该地区规则开启撤回级联。'
                  : ' —— 该地区规则未开启级联，仅影响自身。'}
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2>重新确认</h2>
          {!target && <p className="muted">请选择目标版本。</p>}
          {target && pendingPurposes.length === 0 && (
            <p className="muted">该用户在「{target.label}」的全部用途均已有明确记录。</p>
          )}
          {target &&
            pendingPurposes.map((p) => (
              <div key={p.id} className="confirm-row">
                <span>{p.name}</span>
                <span className="badge badge-unset">待确认</span>
                <button
                  className="btn"
                  onClick={() => {
                    dispatch({
                      type: 'consent/set',
                      userId: user.id,
                      versionId: target.id,
                      purposeId: p.id,
                      status: 'granted',
                    });
                    onLog(`${user.name} 重新确认「${p.name}」= 同意（${target.label}）`);
                  }}
                >
                  确认同意
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    dispatch({
                      type: 'consent/set',
                      userId: user.id,
                      versionId: target.id,
                      purposeId: p.id,
                      status: 'denied',
                    });
                    onLog(`${user.name} 重新确认「${p.name}」= 拒绝（${target.label}）`);
                  }}
                >
                  确认拒绝
                </button>
              </div>
            ))}
        </div>
      </div>

      <div className="card">
        <h2>操作日志</h2>
        {log.length === 0 && <p className="muted">暂无操作。执行迁移、撤回或重新确认后会在此记录说明。</p>}
        <ul className="log-list">
          {log.map((entry) => (
            <li key={entry.id}>
              <span className="muted mono">{entry.time}</span> {entry.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
