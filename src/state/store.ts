import type {
  ConsentStatus,
  DomainState,
  ID,
  Purpose,
  RegionRule,
  ScenarioSnapshot,
  UserProfile,
} from '../types';
import { applyWithdrawal, previewWithdrawal, upsertConsent } from '../domain/consent';
import { applyMigrationDecisions, planMigration } from '../domain/migration';
import { FALLBACK_RULE, ruleForRegion } from '../domain/rules';
import { seedState } from './seed';

export interface AppState {
  present: DomainState;
  past: DomainState[];
  future: DomainState[];
}

export type Action =
  | { type: 'version/createDraft'; id: ID; baseId: ID }
  | { type: 'version/rename'; id: ID; label: string }
  | { type: 'version/publish'; id: ID }
  | { type: 'version/deleteDraft'; id: ID }
  | { type: 'purpose/add'; versionId: ID }
  | {
      type: 'purpose/update';
      versionId: ID;
      purposeId: ID;
      patch: Partial<Pick<Purpose, 'name' | 'key' | 'parentId' | 'derivedFrom' | 'description'>>;
    }
  | { type: 'purpose/remove'; versionId: ID; purposeId: ID }
  | { type: 'rule/add' }
  | { type: 'rule/update'; index: number; patch: Partial<RegionRule> }
  | { type: 'rule/remove'; index: number }
  | { type: 'user/add'; id: ID; name: string; region: string }
  | { type: 'user/update'; id: ID; patch: Partial<Pick<UserProfile, 'name' | 'region'>> }
  | { type: 'user/remove'; id: ID }
  | { type: 'consent/set'; userId: ID; versionId: ID; purposeId: ID; status: ConsentStatus }
  | { type: 'consent/withdraw'; userId: ID; versionId: ID; purposeId: ID }
  | { type: 'migration/apply'; userId: ID; toVersionId: ID }
  | { type: 'migration/applyAll'; toVersionId: ID }
  | { type: 'snapshot/save'; name: string }
  | { type: 'snapshot/restore'; id: ID }
  | { type: 'snapshot/delete'; id: ID }
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'reset' };

let idCounter = 0;
export function genId(prefix: string): ID {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const now = () => Date.now();

const mapVersion = (state: DomainState, id: ID, fn: (v: DomainState['versions'][number]) => DomainState['versions'][number]): DomainState => ({
  ...state,
  versions: state.versions.map((v) => (v.id === id ? fn(v) : v)),
});

/** 领域 reducer：纯函数；非法操作（如修改已发布版本）原样返回 state */
export function domainReducer(state: DomainState, action: Action): DomainState {
  switch (action.type) {
    case 'version/createDraft': {
      const base = state.versions.find((v) => v.id === action.baseId);
      if (!base || state.versions.some((v) => v.id === action.id)) return state;
      const draft = {
        id: action.id,
        label: `基于「${base.label}」的草稿`,
        status: 'draft' as const,
        baseVersionId: base.id,
        purposes: base.purposes.map((p) => ({ ...p, derivedFrom: [p.id] })),
        createdAt: now(),
        publishedAt: null,
      };
      return { ...state, versions: [...state.versions, draft] };
    }

    case 'version/rename': {
      const v = state.versions.find((x) => x.id === action.id);
      if (!v || v.status !== 'draft' || !action.label.trim()) return state;
      return mapVersion(state, v.id, (x) => ({ ...x, label: action.label.trim() }));
    }

    case 'version/publish': {
      const v = state.versions.find((x) => x.id === action.id);
      if (!v || v.status !== 'draft') return state;
      return mapVersion(state, v.id, (x) => ({ ...x, status: 'published' as const, publishedAt: now() }));
    }

    case 'version/deleteDraft': {
      const v = state.versions.find((x) => x.id === action.id);
      if (!v || v.status !== 'draft') return state;
      if (state.versions.some((x) => x.baseVersionId === v.id)) return state; // 已有后继版本
      return { ...state, versions: state.versions.filter((x) => x.id !== v.id) };
    }

    case 'purpose/add': {
      const v = state.versions.find((x) => x.id === action.versionId);
      if (!v || v.status !== 'draft') return state;
      const purpose: Purpose = {
        id: genId('p'),
        key: `purpose-${v.purposes.length + 1}`,
        name: '新用途',
        parentId: null,
        derivedFrom: [],
      };
      return mapVersion(state, v.id, (x) => ({ ...x, purposes: [...x.purposes, purpose] }));
    }

    case 'purpose/update': {
      const v = state.versions.find((x) => x.id === action.versionId);
      if (!v || v.status !== 'draft') return state;
      return mapVersion(state, v.id, (x) => ({
        ...x,
        purposes: x.purposes.map((p) => (p.id === action.purposeId ? { ...p, ...action.patch } : p)),
      }));
    }

    case 'purpose/remove': {
      const v = state.versions.find((x) => x.id === action.versionId);
      if (!v || v.status !== 'draft') return state;
      if (!v.purposes.some((p) => p.id === action.purposeId)) return state;
      return mapVersion(state, v.id, (x) => ({
        ...x,
        purposes: x.purposes
          .filter((p) => p.id !== action.purposeId)
          .map((p) => (p.parentId === action.purposeId ? { ...p, parentId: null } : p)),
      }));
    }

    case 'rule/add': {
      const rule: RegionRule = {
        region: `REGION-${state.rules.length + 1}`,
        model: 'opt-in',
        requireExplicitForNew: true,
        splitRequiresReconfirm: true,
        mergeStrategy: 'all',
        cascadeWithdraw: true,
      };
      return { ...state, rules: [...state.rules, rule] };
    }

    case 'rule/update': {
      if (action.index < 0 || action.index >= state.rules.length) return state;
      const rules = state.rules.slice();
      rules[action.index] = { ...rules[action.index], ...action.patch };
      return { ...state, rules };
    }

    case 'rule/remove': {
      if (action.index < 0 || action.index >= state.rules.length) return state;
      return { ...state, rules: state.rules.filter((_, i) => i !== action.index) };
    }

    case 'user/add': {
      if (!action.name.trim() || !action.region.trim()) return state;
      if (state.users.some((u) => u.id === action.id)) return state;
      const user: UserProfile = { id: action.id, name: action.name.trim(), region: action.region.trim() };
      return { ...state, users: [...state.users, user] };
    }

    case 'user/update': {
      if (!state.users.some((u) => u.id === action.id)) return state;
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.id ? { ...u, ...action.patch } : u)),
      };
    }

    case 'user/remove': {
      if (!state.users.some((u) => u.id === action.id)) return state;
      return {
        ...state,
        users: state.users.filter((u) => u.id !== action.id),
        records: state.records.filter((r) => r.userId !== action.id),
      };
    }

    case 'consent/set': {
      const version = state.versions.find((v) => v.id === action.versionId);
      if (!version || !version.purposes.some((p) => p.id === action.purposeId)) return state;
      if (!state.users.some((u) => u.id === action.userId)) return state;
      const records = upsertConsent(
        state.records,
        action.userId,
        action.versionId,
        action.purposeId,
        action.status,
        'user',
        now(),
      );
      return records === state.records ? state : { ...state, records };
    }

    case 'consent/withdraw': {
      const version = state.versions.find((v) => v.id === action.versionId);
      const user = state.users.find((u) => u.id === action.userId);
      if (!version || !user || !version.purposes.some((p) => p.id === action.purposeId)) return state;
      const rule = ruleForRegion(state.rules, user.region) ?? FALLBACK_RULE;
      const affected = previewWithdrawal(version, action.purposeId, rule);
      const { records, changed } = applyWithdrawal(state.records, user.id, version.id, affected, now());
      return changed.length === 0 ? state : { ...state, records };
    }

    case 'migration/apply': {
      const toVersion = state.versions.find((v) => v.id === action.toVersionId);
      const user = state.users.find((u) => u.id === action.userId);
      const fromVersion = toVersion?.baseVersionId
        ? state.versions.find((v) => v.id === toVersion.baseVersionId)
        : undefined;
      if (!toVersion || !user || !fromVersion) return state;
      const decisions = planMigration({
        user,
        fromVersion,
        toVersion,
        records: state.records,
        rule: ruleForRegion(state.rules, user.region),
      });
      const records = applyMigrationDecisions(state.records, user.id, toVersion.id, decisions, now());
      return records === state.records ? state : { ...state, records };
    }

    case 'migration/applyAll': {
      const toVersion = state.versions.find((v) => v.id === action.toVersionId);
      const fromVersion = toVersion?.baseVersionId
        ? state.versions.find((v) => v.id === toVersion.baseVersionId)
        : undefined;
      if (!toVersion || !fromVersion) return state;
      let records = state.records;
      for (const user of state.users) {
        const decisions = planMigration({
          user,
          fromVersion,
          toVersion,
          records,
          rule: ruleForRegion(state.rules, user.region),
        });
        records = applyMigrationDecisions(records, user.id, toVersion.id, decisions, now());
      }
      return records === state.records ? state : { ...state, records };
    }

    case 'snapshot/save': {
      const name = action.name.trim();
      if (!name) return state;
      const snap: ScenarioSnapshot = {
        id: genId('s'),
        name,
        createdAt: now(),
        data: {
          versions: state.versions,
          rules: state.rules,
          users: state.users,
          records: state.records,
        },
      };
      return { ...state, snapshots: [...state.snapshots, snap] };
    }

    case 'snapshot/restore': {
      const snap = state.snapshots.find((s) => s.id === action.id);
      if (!snap) return state;
      return { ...state, ...snap.data, snapshots: state.snapshots };
    }

    case 'snapshot/delete': {
      return { ...state, snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    }

    default:
      return state;
  }
}

const HISTORY_LIMIT = 100;

/** 带撤销/重做的顶层 reducer；只有实际改变状态的操作才入历史 */
export function appReducer(app: AppState, action: Action): AppState {
  switch (action.type) {
    case 'history/undo': {
      if (app.past.length === 0) return app;
      const previous = app.past[app.past.length - 1];
      return {
        past: app.past.slice(0, -1),
        present: previous,
        future: [app.present, ...app.future],
      };
    }
    case 'history/redo': {
      if (app.future.length === 0) return app;
      const [next, ...rest] = app.future;
      return { past: [...app.past, app.present], present: next, future: rest };
    }
    case 'reset': {
      return { past: [...app.past, app.present], present: seedState(), future: [] };
    }
    default: {
      const next = domainReducer(app.present, action);
      if (next === app.present) return app;
      return {
        past: [...app.past.slice(-(HISTORY_LIMIT - 1)), app.present],
        present: next,
        future: [],
      };
    }
  }
}

const STORAGE_KEY = 'consentpath-state-v1';

/** 初始化：优先从 localStorage 恢复（刷新恢复），否则载入示例数据 */
export function initAppState(): AppState {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DomainState;
        if (
          parsed &&
          Array.isArray(parsed.versions) &&
          Array.isArray(parsed.rules) &&
          Array.isArray(parsed.users) &&
          Array.isArray(parsed.records)
        ) {
          return {
            present: { ...parsed, snapshots: parsed.snapshots ?? [] },
            past: [],
            future: [],
          };
        }
      }
    } catch {
      // 数据损坏时回退到示例数据
    }
  }
  return { present: seedState(), past: [], future: [] };
}

export function persistAppState(app: AppState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.present));
  } catch {
    // 存储已满等情况：忽略，不阻断操作
  }
}
