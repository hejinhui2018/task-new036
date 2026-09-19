import type {
  ConsentRecord,
  DemoUser,
  PrivacyVersion,
  Purpose,
  PurposeMapping,
  RegionRule,
  ScenarioEvent,
  Snapshot,
  WorkbenchData,
} from '../core/types';
import { seedData } from '../core/seed';
import { nowIso, uid } from '../core/id';

/** 演练会话：某位用户在某版本上的进行中勾选（不落正式记录） */
export interface SimSession {
  userId: string;
  versionId: string;
  choices: Record<string, 'granted' | 'denied'>;
  /** 严格迁移后等待重新确认的用途（暂停生效） */
  unconfirmed?: string[];
}

export interface AppState {
  data: WorkbenchData;
  events: ScenarioEvent[];
  sessions: Record<string, SimSession>;
  snapshots: Snapshot[];
  /** 最近一次非法操作提示（如修改已发布版本） */
  notice: string | null;
}

interface HistoryState {
  present: AppState;
  past: AppState[];
  future: AppState[];
}

// ---------- Actions ---------- //

export type Action =
  | { type: 'version/add'; version: PrivacyVersion }
  | { type: 'version/update'; versionId: string; patch: Partial<PrivacyVersion> }
  | { type: 'version/delete'; versionId: string }
  | { type: 'version/publish'; versionId: string }
  | { type: 'version/fork'; versionId: string; newVersion: PrivacyVersion; carriedMappings: PurposeMapping[] }
  | { type: 'purpose/add'; versionId: string; purpose: Purpose }
  | { type: 'purpose/update'; versionId: string; purposeId: string; patch: Partial<Purpose> }
  | { type: 'purpose/delete'; versionId: string; purposeId: string }
  | { type: 'mapping/upsert'; mapping: PurposeMapping }
  | { type: 'mapping/delete'; mappingId: string }
  | { type: 'region/upsert'; region: RegionRule }
  | { type: 'region/delete'; code: string }
  | { type: 'user/upsert'; user: DemoUser }
  | { type: 'user/delete'; id: string }
  | { type: 'record/upsert'; record: ConsentRecord }
  | { type: 'record/delete'; id: string }
  | { type: 'sim/event'; event: ScenarioEvent; sessionKey: string; session: SimSession }
  | { type: 'sim/clearSession'; sessionKey: string }
  | { type: 'sim/clearEvents' }
  | { type: 'snapshot/create'; name: string; note?: string }
  | { type: 'snapshot/restore'; id: string }
  | { type: 'snapshot/delete'; id: string }
  | { type: 'state/replace'; state: AppState }
  | { type: 'state/reset' }
  | { type: 'notice/clear' }
  | { type: 'undo' }
  | { type: 'redo' };

const STORAGE_KEY = 'consentpath:state:v1';
const SNAPSHOT_KEY = 'consentpath:snapshots:v1';
const HISTORY_LIMIT = 100;

export function sessionKey(userId: string, versionId: string): string {
  return `${userId}::${versionId}`;
}

export function initialState(): AppState {
  return {
    data: seedData(),
    events: [],
    sessions: {},
    snapshots: [],
    notice: null,
  };
}

/** 从 localStorage 恢复草稿与快照；解析失败回退到示例数据。 */
export function loadPersisted(): AppState {
  const base = initialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      return {
        data: parsed.data ?? base.data,
        events: parsed.events ?? [],
        sessions: parsed.sessions ?? {},
        snapshots: loadSnapshots(),
        notice: null,
      };
    }
  } catch (err) {
    // 数据损坏时不阻断使用
    console.warn('ConsentPath：无法读取本地草稿，已回退到示例数据。', err);
  }
  base.snapshots = loadSnapshots();
  return base;
}

function loadSnapshots(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '[]') as Snapshot[];
  } catch {
    return [];
  }
}

export function persistState(state: AppState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        data: state.data,
        events: state.events,
        sessions: state.sessions,
      }),
    );
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state.snapshots));
  } catch (err) {
    console.warn('ConsentPath：写入本地存储失败。', err);
  }
}

function isPublishedVersion(data: WorkbenchData, versionId: string): boolean {
  return data.versions.find((v) => v.id === versionId)?.status === 'published';
}

/** 已发布版本冻结保护：任何内容改动都被拒绝。 */
function guardPublished(
  draft: AppState,
  versionId: string,
): boolean {
  if (isPublishedVersion(draft.data, versionId)) {
    draft.notice = '该版本已发布并冻结，内容不可修改。请基于它创建新草稿版本（分叉）。';
    return true;
  }
  return false;
}

function updateData(draft: AppState, fn: (data: WorkbenchData) => WorkbenchData): void {
  draft.data = fn(draft.data);
}

function reducerImpl(state: AppState, action: Action): AppState {
  // 先做一份浅拷贝，data 在需要时再深拷贝（编辑器操作规模很小，结构化克隆足够）
  const draft: AppState = structuredClone(state);
  draft.notice = null;

  switch (action.type) {
    case 'version/add':
      draft.data.versions.push(action.version);
      return draft;

    case 'version/update': {
      if (isPublishedVersion(draft.data, action.versionId)) {
        draft.notice = '已发布版本不可修改（包括名称与状态）。';
        return draft;
      }
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.map((v) =>
          v.id === action.versionId ? { ...v, ...action.patch } : v,
        ),
      }));
      return draft;
    }

    case 'version/delete': {
      if (isPublishedVersion(draft.data, action.versionId)) {
        draft.notice = '已发布版本不可删除。';
        return draft;
      }
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.filter((v) => v.id !== action.versionId),
        mappings: d.mappings.filter(
          (m) => m.fromVersionId !== action.versionId && m.toVersionId !== action.versionId,
        ),
      }));
      return draft;
    }

    case 'version/publish': {
      if (isPublishedVersion(draft.data, action.versionId)) return state;
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.map((v) =>
          v.id === action.versionId
            ? { ...v, status: 'published', publishedAt: nowIso() }
            : v,
        ),
      }));
      draft.notice = `版本已发布，此后内容冻结。`;
      return draft;
    }

    case 'version/fork': {
      draft.data.versions.push(action.newVersion);
      draft.data.mappings.push(...action.carriedMappings);
      draft.notice = `已基于已发布版本创建草稿分叉「${action.newVersion.label}」。`;
      return draft;
    }

    case 'purpose/add':
      if (guardPublished(draft, action.versionId)) return draft;
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.map((v) =>
          v.id === action.versionId
            ? { ...v, purposes: [...v.purposes, action.purpose] }
            : v,
        ),
      }));
      return draft;

    case 'purpose/update':
      if (guardPublished(draft, action.versionId)) return draft;
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.map((v) =>
          v.id === action.versionId
            ? {
                ...v,
                purposes: v.purposes.map((p) =>
                  p.id === action.purposeId ? { ...p, ...action.patch } : p,
                ),
              }
            : v,
        ),
      }));
      return draft;

    case 'purpose/delete':
      if (guardPublished(draft, action.versionId)) return draft;
      updateData(draft, (d) => ({
        ...d,
        versions: d.versions.map((v) => {
          if (v.id !== action.versionId) return v;
          return {
            ...v,
            purposes: v.purposes
              .filter((p) => p.id !== action.purposeId)
              .map((p) => ({
                ...p,
                parentId: p.parentId === action.purposeId ? null : p.parentId,
                dependsOn: p.dependsOn?.filter((x) => x !== action.purposeId),
              })),
          };
        }),
        mappings: d.mappings.filter(
          (m) =>
            !(
              (m.fromVersionId === action.versionId && m.sourcePurposeId === action.purposeId) ||
              (m.toVersionId === action.versionId && m.targetPurposeId === action.purposeId)
            ),
        ),
      }));
      return draft;

    case 'mapping/upsert': {
      const exists = draft.data.mappings.some((m) => m.id === action.mapping.id);
      updateData(draft, (d) => ({
        ...d,
        mappings: exists
          ? d.mappings.map((m) => (m.id === action.mapping.id ? action.mapping : m))
          : [...d.mappings, action.mapping],
      }));
      return draft;
    }

    case 'mapping/delete':
      updateData(draft, (d) => ({
        ...d,
        mappings: d.mappings.filter((m) => m.id !== action.mappingId),
      }));
      return draft;

    case 'region/upsert': {
      const exists = draft.data.regions.some((r) => r.code === action.region.code);
      updateData(draft, (d) => ({
        ...d,
        regions: exists
          ? d.regions.map((r) => (r.code === action.region.code ? action.region : r))
          : [...d.regions, action.region],
      }));
      return draft;
    }

    case 'region/delete':
      updateData(draft, (d) => ({
        ...d,
        regions: d.regions.filter((r) => r.code !== action.code),
      }));
      return draft;

    case 'user/upsert': {
      const exists = draft.data.users.some((u) => u.id === action.user.id);
      updateData(draft, (d) => ({
        ...d,
        users: exists
          ? d.users.map((u) => (u.id === action.user.id ? action.user : u))
          : [...d.users, action.user],
      }));
      return draft;
    }

    case 'user/delete':
      updateData(draft, (d) => ({
        ...d,
        users: d.users.filter((u) => u.id !== action.id),
        records: d.records.filter((r) => r.userId !== action.id),
      }));
      return draft;

    case 'record/upsert': {
      const exists = draft.data.records.some((r) => r.id === action.record.id);
      updateData(draft, (d) => ({
        ...d,
        records: exists
          ? d.records.map((r) => (r.id === action.record.id ? action.record : r))
          : [...d.records, action.record],
      }));
      return draft;
    }

    case 'record/delete':
      updateData(draft, (d) => ({
        ...d,
        records: d.records.filter((r) => r.id !== action.id),
      }));
      return draft;

    case 'sim/event':
      draft.events.push(action.event);
      draft.sessions[action.sessionKey] = action.session;
      return draft;

    case 'sim/clearSession':
      delete draft.sessions[action.sessionKey];
      return draft;

    case 'sim/clearEvents':
      draft.events = [];
      draft.sessions = {};
      return draft;

    case 'snapshot/create': {
      const snap: Snapshot = {
        id: uid('snap'),
        name: action.name,
        createdAt: nowIso(),
        data: structuredClone(draft.data),
        events: structuredClone(draft.events),
        note: action.note,
      };
      draft.snapshots = [...draft.snapshots, snap];
      draft.notice = `快照「${action.name}」已保存。`;
      return draft;
    }

    case 'snapshot/restore': {
      const snap = draft.snapshots.find((s) => s.id === action.id);
      if (!snap) return state;
      draft.data = structuredClone(snap.data);
      draft.events = structuredClone(snap.events);
      draft.sessions = {};
      draft.notice = `已恢复到快照「${snap.name}」。`;
      return draft;
    }

    case 'snapshot/delete':
      draft.snapshots = draft.snapshots.filter((s) => s.id !== action.id);
      return draft;

    case 'state/replace':
      return { ...action.state, notice: null };

    case 'state/reset':
      return { ...initialState(), snapshots: draft.snapshots };

    case 'notice/clear':
      return state.notice ? { ...state, notice: null } : state;

    case 'undo':
    case 'redo':
      return state; // 由带历史的 reducer 处理
    default:
      return state;
  }
}

/** 带撤销/重做历史的 reducer。快照操作不入历史（它本身就是还原点）。 */
export function historyReducer(history: HistoryState, action: Action): HistoryState {
  if (action.type === 'undo') {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    };
  }
  if (action.type === 'redo') {
    if (history.future.length === 0) return history;
    const next = history.future[0];
    return {
      past: [...history.past, history.present].slice(-HISTORY_LIMIT),
      present: next,
      future: history.future.slice(1),
    };
  }

  const next = reducerImpl(history.present, action);
  if (next === history.present) return history;

  // 快照的创建/删除本身不是数据编辑，不进撤销栈；恢复快照可以撤销
  const skipHistory =
    action.type === 'snapshot/create' ||
    action.type === 'snapshot/delete' ||
    action.type === 'notice/clear';
  if (skipHistory || stateSliceEqual(next, history.present)) {
    return { ...history, present: next };
  }

  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

/** 判断撤销栈内容是否真的变化（structuredClone 后引用必然不同，故按内容比）。 */
function stateSliceEqual(a: AppState, b: AppState): boolean {
  return (
    JSON.stringify(a.data) === JSON.stringify(b.data) &&
    JSON.stringify(a.events) === JSON.stringify(b.events) &&
    JSON.stringify(a.sessions) === JSON.stringify(b.sessions) &&
    JSON.stringify(a.snapshots) === JSON.stringify(b.snapshots)
  );
}
