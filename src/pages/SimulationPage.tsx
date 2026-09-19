import { useMemo, useState } from 'react';
import { useStore } from '../state/StoreContext';
import { planMigration } from '../core/migrate';
import {
  applyGrant,
  applyMigration,
  applyWithdraw,
  choicesToRecord,
} from '../core/simulate';
import {
  downstreamClosure,
  leafPurposes,
  purposeMap,
} from '../core/graph';
import { effectiveState, findRegion } from '../core/consent';
import type { ConsentValue, MigrationResult, PurposeId } from '../core/types';
import { sessionKey } from '../state/store';
import { ConflictList } from '../components/ConflictList';
import { MigrationStatusBadge, VersionStatusBadge } from '../components/Badges';
import { EventLog } from './EventLog';

export function SimulationPage() {
  const { state, dispatch } = useStore();
  const { data } = state;

  const [userId, setUserId] = useState(data.users[0]?.id ?? '');
  const [fromVersionId, setFromVersionId] = useState('v1');
  const [toVersionId, setToVersionId] = useState('v2');

  const user = data.users.find((u) => u.id === userId);
  const toVersion = data.versions.find((v) => v.id === toVersionId);
  const sKey = sessionKey(userId, toVersionId);
  const session = state.sessions[sKey];

  const migration = useMemo<MigrationResult | null>(() => {
    if (!userId || !fromVersionId || !toVersionId) return null;
    try {
      return planMigration(data, userId, fromVersionId, toVersionId);
    } catch {
      return null;
    }
  }, [data, userId, fromVersionId, toVersionId]);

  // 当前会话的有效状态（若已迁移则用会话勾选，否则预览迁移结果）
  const currentEff = useMemo(() => {
    if (!toVersion || !user) return null;
    const region = findRegion(data.regions, user.region);
    const choices = session?.choices ?? {};
    return effectiveState(
      toVersion,
      choices,
      region,
      user.region,
      new Set(session?.unconfirmed ?? []),
    );
  }, [toVersion, user, data.regions, session]);

  const runMigration = () => {
    if (!migration || !user) return;
    const { choices, unconfirmed, event } = applyMigration(data, userId, fromVersionId, toVersionId);
    dispatch({
      type: 'sim/event',
      event,
      sessionKey: sKey,
      session: { userId, versionId: toVersionId, choices, unconfirmed },
    });
  };

  const withdraw = (purposeId: PurposeId) => {
    if (!session || !toVersion) return;
    const res = applyWithdraw(
      {
        data,
        userId,
        versionId: toVersionId,
        choices: session.choices,
        unconfirmed: session.unconfirmed,
      },
      purposeId,
    );
    dispatch({
      type: 'sim/event',
      event: res.event,
      sessionKey: sKey,
      session: {
        userId,
        versionId: toVersionId,
        choices: res.choices,
        unconfirmed: res.unconfirmed,
      },
    });
  };

  const reconfirm = (purposeId: PurposeId) => {
    if (!session || !toVersion) return;
    const res = applyGrant(
      {
        data,
        userId,
        versionId: toVersionId,
        choices: session.choices,
        unconfirmed: session.unconfirmed,
      },
      purposeId,
      'reconfirm',
    );
    dispatch({
      type: 'sim/event',
      event: res.event,
      sessionKey: sKey,
      session: {
        userId,
        versionId: toVersionId,
        choices: res.choices,
        unconfirmed: res.unconfirmed,
      },
    });
  };

  const saveRecord = () => {
    if (!session || !toVersion) return;
    const record = choicesToRecord(data, userId, toVersionId, session.choices, '演练后保存的重新确认结果');
    dispatch({ type: 'record/upsert', record });
    dispatch({ type: 'sim/clearSession', sessionKey: sKey });
  };

  const resetSession = () => {
    dispatch({ type: 'sim/clearSession', sessionKey: sKey });
  };

  const leavesById = purposeMap(toVersion?.purposes ?? []);
  const leafIds = leafPurposes(toVersion?.purposes ?? []).map((p) => p.id);

  return (
    <div>
      <div className="card">
        <h2>迁移演练</h2>
        <p className="desc">
          选择示例用户与升级路径，先预览旧同意如何映射到新说明，再执行迁移、部分撤回与重新确认。
          所有计算只发生在浏览器本地。
        </p>
        <div className="field-row">
          <div className="field">
            <label>演练用户</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.id} · {u.region}
                  {findRegion(data.regions, u.region)
                    ? ` · ${modeLabel(findRegion(data.regions, u.region)!.mode)}`
                    : ' · 无地区规则'}
                  ）
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>旧版同意所在版本</label>
            <select value={fromVersionId} onChange={(e) => setFromVersionId(e.target.value)}>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>升级目标版本</label>
            <select value={toVersionId} onChange={(e) => setToVersionId(e.target.value)}>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label>&nbsp;</label>
            <button className="btn primary" onClick={runMigration} disabled={!migration}>
              执行迁移 →
            </button>
          </div>
        </div>
      </div>

      <div className="grid-3-2">
        <div>
          {migration && !session && (
            <div className="card">
              <div className="section-title">
                迁移预览
                <VersionStatusBadge status={toVersion?.status ?? 'draft'} />
                <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  从 {fromVersionId} 到 {toVersionId} · 适用地区 {user?.region}
                </span>
              </div>
              {migration.purposes.map((p) => {
                const purpose = leavesById.get(p.purposeId);
                return (
                  <div
                    key={p.purposeId}
                    className={`purpose-row purpose-${
                      p.status === 'reconfirm'
                        ? 'reconfirm'
                        : p.value === 'granted'
                          ? 'granted'
                          : 'denied'
                    }`}
                  >
                    <div className="purpose-head">
                      <span className="purpose-name">{purpose?.name ?? p.purposeId}</span>
                      <span className="purpose-id">{p.purposeId}</span>
                      <MigrationStatusBadge status={p.status} />
                      <span
                        className={`badge ${p.value === 'granted' ? 'granted' : 'denied'}`}
                      >
                        迁移后{p.value === 'granted' ? '有效' : '无效'}
                      </span>
                      {p.sources.length > 0 && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          来源：{p.sources.join('、')}
                        </span>
                      )}
                    </div>
                    <p className="purpose-reason">{p.reason}</p>
                  </div>
                );
              })}
              <h3>冲突与拦截（{migration.conflicts.length}）</h3>
              {migration.conflicts.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  本次迁移没有规则冲突。
                </p>
              ) : (
                <ConflictList conflicts={migration.conflicts} />
              )}
            </div>
          )}

          {session && toVersion && currentEff && (
            <div className="card">
              <div className="section-title">
                演练进行中：{toVersion.label}
                <span className="spacer" />
                <button className="btn sm" onClick={resetSession}>放弃本次会话</button>
                <button className="btn sm primary" onClick={saveRecord}>
                  保存为正式同意记录
                </button>
              </div>
              <p className="desc">
                对任一用途执行部分撤回；下游用途会失去上游授权。显式拒绝优先级最高，重复操作幂等。
              </p>
              {leafIds.map((id) => {
                const p = leavesById.get(id)!;
                const value: ConsentValue = currentEff.values[id];
                const explicit = session.choices[id];
                const downstream = downstreamClosure(toVersion.purposes, id).filter((d) =>
                  leafIds.includes(d.id),
                );
                return (
                  <div
                    key={id}
                    className={`purpose-row purpose-${value === 'granted' ? 'granted' : 'denied'}`}
                  >
                    <div className="purpose-head">
                      <span className="purpose-name">{p.name}</span>
                      <span className="purpose-id">{id}</span>
                      <span className={`badge ${value === 'granted' ? 'granted' : 'denied'}`}>
                        {value === 'granted' ? '当前有效' : '当前失效'}
                      </span>
                      {explicit && (
                        <span
                          className={`choice-pill ${explicit === 'granted' ? 'on' : 'off'}`}
                        >
                          用户显式{explicit === 'granted' ? '同意' : '拒绝'}
                        </span>
                      )}
                      {!explicit && (
                        <span className="choice-pill">未显式选择（按地区默认/上游继承）</span>
                      )}
                      {session.unconfirmed?.includes(id) && (
                        <span className="badge reconfirm">等待重新确认（暂停生效）</span>
                      )}
                    </div>
                    {p.dependsOn && p.dependsOn.length > 0 && (
                      <p className="purpose-reason">
                        依赖的上游：{p.dependsOn.join('、')}（上游全部失效时本用途连带失效）
                      </p>
                    )}
                    <div className="purpose-actions">
                      <button
                        className="btn sm danger"
                        disabled={value !== 'granted'}
                        onClick={() => withdraw(id)}
                      >
                        撤回此项
                      </button>
                      <button
                        className="btn sm"
                        disabled={value === 'granted'}
                        onClick={() => reconfirm(id)}
                      >
                        重新确认/授予
                      </button>
                      {downstream.length > 0 && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          撤回将级联影响：
                          {downstream
                            .map((d) => leavesById.get(d.id)?.name ?? d.id)
                            .join('、')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {currentEff.conflicts.length > 0 && (
                <>
                  <h3>操作中的规则冲突</h3>
                  <ConflictList conflicts={currentEff.conflicts} />
                </>
              )}
            </div>
          )}
        </div>

        <EventLog />
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode === 'opt-in' ? 'opt-in 严格同意' : mode === 'opt-out' ? 'opt-out 默认允许' : '仅通知';
}
