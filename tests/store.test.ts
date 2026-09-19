import { describe, expect, it } from 'vitest';
import { appReducer, type AppState } from '../src/state/store';
import { seedState } from '../src/state/seed';

const fresh = (): AppState => ({ present: seedState(), past: [], future: [] });

describe('撤销 / 重做', () => {
  it('编辑可撤销、可重做', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, {
      type: 'purpose/update',
      versionId: 'v2',
      purposeId: 'analytics',
      patch: { name: '分析（改）' },
    });
    expect(s1.present.versions.find((v) => v.id === 'v2')!.purposes.find((p) => p.id === 'analytics')!.name).toBe(
      '分析（改）',
    );
    expect(s1.past).toHaveLength(1);

    const s2 = appReducer(s1, { type: 'history/undo' });
    expect(s2.present).toEqual(s0.present);
    expect(s2.future).toHaveLength(1);

    const s3 = appReducer(s2, { type: 'history/redo' });
    expect(s3.present).toEqual(s1.present);
  });

  it('无变化的操作不入历史', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, { type: 'purpose/update', versionId: 'v1', purposeId: 'exp', patch: { name: 'x' } });
    expect(s1).toBe(s0);
  });
});

describe('发布版本不可变', () => {
  it('已发布版本拒绝任何用途修改', () => {
    const s0 = fresh();
    expect(appReducer(s0, { type: 'purpose/add', versionId: 'v1' })).toBe(s0);
    expect(
      appReducer(s0, { type: 'purpose/remove', versionId: 'v1', purposeId: 'exp' }),
    ).toBe(s0);
    expect(appReducer(s0, { type: 'version/rename', id: 'v1', label: 'x' })).toBe(s0);
  });

  it('草稿可编辑，发布后冻结', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, { type: 'purpose/add', versionId: 'v2' });
    expect(s1.present.versions.find((v) => v.id === 'v2')!.purposes).toHaveLength(6);

    const s2 = appReducer(s1, { type: 'version/publish', id: 'v2' });
    const v2 = s2.present.versions.find((v) => v.id === 'v2')!;
    expect(v2.status).toBe('published');
    expect(v2.publishedAt).not.toBeNull();

    const s3 = appReducer(s2, { type: 'purpose/remove', versionId: 'v2', purposeId: 'usage' });
    expect(s3.present).toBe(s2.present);
  });

  it('已发布版本不能删除；被引用的草稿也不能删除', () => {
    const s0 = fresh();
    expect(appReducer(s0, { type: 'version/deleteDraft', id: 'v1' })).toBe(s0);
    // v2 是草稿，但没有后继 → 可删除
    const s1 = appReducer(s0, { type: 'version/deleteDraft', id: 'v2' });
    expect(s1.present.versions.find((v) => v.id === 'v2')).toBeUndefined();
  });
});

describe('迁移与撤回（经 store）', () => {
  it('migration/apply 写入记录且幂等', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, { type: 'migration/apply', userId: 'u1', toVersionId: 'v2' });
    const written = s1.present.records.filter((r) => r.versionId === 'v2' && r.userId === 'u1');
    expect(written).toHaveLength(4); // analytics/crash/essential/personalization；usage 待确认
    const s2 = appReducer(s1, { type: 'migration/apply', userId: 'u1', toVersionId: 'v2' });
    expect(s2.present).toBe(s1.present);
  });

  it('地区无规则的用户迁移不写入任何记录', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, { type: 'migration/apply', userId: 'u5', toVersionId: 'v2' });
    expect(s1).toBe(s0);
  });

  it('consent/withdraw 级联下游且重复执行无变化', () => {
    let s = appReducer(fresh(), { type: 'migration/apply', userId: 'u1', toVersionId: 'v2' });
    s = appReducer(s, { type: 'consent/set', userId: 'u1', versionId: 'v2', purposeId: 'usage', status: 'granted' });
    s = appReducer(s, { type: 'consent/withdraw', userId: 'u1', versionId: 'v2', purposeId: 'analytics' });
    const denied = s.present.records
      .filter((r) => r.versionId === 'v2' && r.userId === 'u1' && r.status === 'denied')
      .map((r) => r.purposeId)
      .sort();
    expect(denied).toEqual(['analytics', 'crash', 'usage']);
    const after = appReducer(s, { type: 'consent/withdraw', userId: 'u1', versionId: 'v2', purposeId: 'analytics' });
    expect(after.present).toBe(s.present);
  });

  it('migration/applyAll 覆盖全部用户', () => {
    const s0 = fresh();
    const s1 = appReducer(s0, { type: 'migration/applyAll', toVersionId: 'v2' });
    // u1/u2/u3/u4 有规则可写入；u5 无规则被跳过
    const users = new Set(s1.present.records.filter((r) => r.versionId === 'v2').map((r) => r.userId));
    expect(users.has('u1')).toBe(true);
    expect(users.has('u2')).toBe(true);
    expect(users.has('u5')).toBe(false);
  });
});

describe('情景快照与刷新恢复', () => {
  it('保存后可恢复，快照列表在恢复后保留', () => {
    let s = fresh();
    s = appReducer(s, { type: 'snapshot/save', name: '演练前' });
    expect(s.present.snapshots).toHaveLength(1);
    const snapId = s.present.snapshots[0].id;

    s = appReducer(s, { type: 'user/add', id: 'ux', name: '临时用户', region: 'CN' });
    expect(s.present.users.some((u) => u.id === 'ux')).toBe(true);

    s = appReducer(s, { type: 'snapshot/restore', id: snapId });
    expect(s.present.users.some((u) => u.id === 'ux')).toBe(false);
    expect(s.present.snapshots).toHaveLength(1);
  });

  it('恢复快照本身可撤销', () => {
    let s = fresh();
    s = appReducer(s, { type: 'snapshot/save', name: 'A' });
    const snapId = s.present.snapshots[0].id;
    s = appReducer(s, { type: 'user/add', id: 'ux', name: 'X', region: 'CN' });
    s = appReducer(s, { type: 'snapshot/restore', id: snapId });
    s = appReducer(s, { type: 'history/undo' });
    expect(s.present.users.some((u) => u.id === 'ux')).toBe(true);
  });

  it('reset 恢复示例数据（可撤销）', () => {
    let s = fresh();
    s = appReducer(s, { type: 'user/add', id: 'ux', name: 'X', region: 'CN' });
    s = appReducer(s, { type: 'reset' });
    expect(s.present).toEqual(seedState());
    s = appReducer(s, { type: 'history/undo' });
    expect(s.present.users.some((u) => u.id === 'ux')).toBe(true);
  });
});
