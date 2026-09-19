import { describe, it, expect, beforeEach } from 'vitest';
import {
  historyReducer,
  initialState,
  loadPersisted,
  persistState,
  type AppState,
} from '../state/store';
import type { PrivacyVersion, Purpose, RegionRule } from '../core/types';

function hist(present?: AppState) {
  return { past: [] as AppState[], present: present ?? initialState(), future: [] as AppState[] };
}

beforeEach(() => {
  localStorage.clear();
});

describe('发布版本冻结', () => {
  it('已发布版本不能改用途：操作被拒绝并给出提示', () => {
    let h = hist();
    const purpose: Purpose = {
      id: 'new_p',
      name: '新用途',
      versionId: 'v1',
    };
    h = historyReducer(h, { type: 'purpose/add', versionId: 'v1', purpose });
    expect(h.present.data.versions.find((v) => v.id === 'v1')!.purposes).toHaveLength(4);
    expect(h.present.notice).toContain('冻结');
  });

  it('草稿版本可以编辑；发布后再次编辑被拒', () => {
    let h = hist();
    // v3 是种子里的草稿
    const purpose: Purpose = { id: 'p_draft', name: '草稿用途', versionId: 'v3' };
    h = historyReducer(h, { type: 'purpose/add', versionId: 'v3', purpose });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes.some((p) => p.id === 'p_draft')).toBe(true);

    h = historyReducer(h, { type: 'version/publish', versionId: 'v3' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.status).toBe('published');

    const beforeCount = h.present.data.versions.find((v) => v.id === 'v3')!.purposes.length;
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'p_after', name: 'x', versionId: 'v3' },
    });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes).toHaveLength(beforeCount);
    expect(h.present.notice).toContain('冻结');
  });

  it('发布是单向的：不能通过 update 改回 draft', () => {
    let h = hist();
    h = historyReducer(h, { type: 'version/publish', versionId: 'v3' });
    h = historyReducer(h, {
      type: 'version/update',
      versionId: 'v3',
      patch: { status: 'draft' as PrivacyVersion['status'] },
    });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.status).toBe('published');
  });
});

describe('撤销 / 重做', () => {
  it('编辑可撤销、可重做，且重做栈在新操作后清空', () => {
    let h = hist();
    const originalPurposes = h.present.data.versions.find((v) => v.id === 'v3')!.purposes.length;

    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'p1', name: 'p1', versionId: 'v3' },
    });
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'p2', name: 'p2', versionId: 'v3' },
    });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes).toHaveLength(originalPurposes + 2);

    h = historyReducer(h, { type: 'undo' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes).toHaveLength(originalPurposes + 1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes).toHaveLength(originalPurposes);

    h = historyReducer(h, { type: 'redo' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes).toHaveLength(originalPurposes + 1);

    // 新操作清空 redo
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'p3', name: 'p3', versionId: 'v3' },
    });
    expect(h.future).toHaveLength(0);
  });

  it('被冻结拦截的无效操作不入撤销栈', () => {
    let h = hist();
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v1',
      purpose: { id: 'x', name: 'x', versionId: 'v1' },
    });
    expect(h.past).toHaveLength(0);
  });

  it('撤销可以跨过快照恢复', () => {
    let h = hist();
    h = historyReducer(h, { type: 'snapshot/create', name: 's1' });
    expect(h.present.snapshots).toHaveLength(1);
    const snapId = h.present.snapshots[0].id;

    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'after', name: 'after', versionId: 'v3' },
    });
    h = historyReducer(h, { type: 'snapshot/restore', id: snapId });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes.some((p) => p.id === 'after')).toBe(false);

    h = historyReducer(h, { type: 'undo' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes.some((p) => p.id === 'after')).toBe(true);
  });
});

describe('本地持久化与刷新恢复', () => {
  it('persist 后 loadPersisted 能还原 data/events/sessions', () => {
    let h = hist();
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'persisted_p', name: '持久化用途', versionId: 'v3' },
    });
    persistState(h.present);

    const restored = loadPersisted();
    expect(restored.data.versions.find((v) => v.id === 'v3')!.purposes.some((p) => p.id === 'persisted_p')).toBe(true);
  });

  it('快照独立持久化，刷新后仍在', () => {
    let h = hist();
    h = historyReducer(h, { type: 'snapshot/create', name: '保留快照' });
    persistState(h.present);
    const restored = loadPersisted();
    expect(restored.snapshots.map((s) => s.name)).toContain('保留快照');
  });

  it('localStorage 损坏时回退到示例数据而不抛错', () => {
    localStorage.setItem('consentpath:state:v1', '{不是合法 JSON');
    const restored = loadPersisted();
    expect(restored.data.versions.length).toBeGreaterThan(0);
  });
});

describe('地区与记录编辑', () => {
  it('upsert 新地区后可以在状态中读到，再删除消失', () => {
    let h = hist();
    const r: RegionRule = { code: 'JP', name: '日本', mode: 'opt-in', migrationPolicy: 'strict' };
    h = historyReducer(h, { type: 'region/upsert', region: r });
    expect(h.present.data.regions.some((x) => x.code === 'JP')).toBe(true);
    h = historyReducer(h, { type: 'region/delete', code: 'JP' });
    expect(h.present.data.regions.some((x) => x.code === 'JP')).toBe(false);
  });

  it('重置回示例数据', () => {
    let h = hist();
    h = historyReducer(h, {
      type: 'purpose/add',
      versionId: 'v3',
      purpose: { id: 'tmp', name: 'tmp', versionId: 'v3' },
    });
    h = historyReducer(h, { type: 'state/reset' });
    expect(h.present.data.versions.find((v) => v.id === 'v3')!.purposes.some((p) => p.id === 'tmp')).toBe(false);
  });
});
