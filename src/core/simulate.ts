import type {
  Conflict,
  ConsentRecord,
  ConsentValue,
  PurposeId,
  ScenarioEvent,
  WorkbenchData,
} from './types';
import { downstreamClosure, leafPurposes } from './graph';
import { effectiveState, expandToLeaves, findRegion } from './consent';
import { latestRecord, planMigration } from './migrate';
import { nowIso, uid } from './id';

export interface SimulationInput {
  data: WorkbenchData;
  userId: string;
  versionId: string;
  /** 该用户在此版本上当前的原始勾选（演练态，不一定要落库） */
  choices: Record<PurposeId, ConsentValue>;
  /** 迁移后等待用户重新确认、暂不生效的用途（即便有上游授权） */
  unconfirmed?: PurposeId[];
}

export interface ApplyResult {
  /** 操作后的原始勾选（显式选择集合） */
  choices: Record<PurposeId, ConsentValue>;
  /** 操作后仍待确认的用途（用户一旦显式选择即从该集合移除） */
  unconfirmed: PurposeId[];
  /** 操作后的有效状态 */
  state: Record<PurposeId, ConsentValue>;
  /** 本次撤回/操作影响到的下游用途 */
  affected: PurposeId[];
  event: ScenarioEvent;
}

function versionOf(data: WorkbenchData, versionId: string) {
  const v = data.versions.find((x) => x.id === versionId);
  if (!v) throw new Error(`版本不存在：${versionId}`);
  return v;
}

function userRegion(data: WorkbenchData, userId: string, versionId: string) {
  const code =
    data.users.find((u) => u.id === userId)?.region ??
    latestRecord(data, userId, versionId)?.region ??
    '';
  return { code, rule: findRegion(data.regions, code) };
}

function recompute(input: SimulationInput, choices: Record<PurposeId, ConsentValue>) {
  const { code, rule } = userRegion(input.data, input.userId, input.versionId);
  const version = versionOf(input.data, input.versionId);
  const eff = effectiveState(
    version,
    choices,
    rule,
    code,
    new Set(input.unconfirmed ?? []),
  );
  return { eff, version, code };
}

/**
 * （部分）撤回：把目标用途（组展开为其叶子）显式置为 denied。
 * 下游用途不写显式拒绝——它们随重算自然失效；这样上游重新授予后下游可自动恢复。
 * 重复撤回是幂等的：第二次撤回不产生新的状态变化，事件里会注明。
 */
export function applyWithdraw(
  input: SimulationInput,
  targetPurposeId: PurposeId,
): ApplyResult {
  const { data, userId, versionId } = input;
  const version = versionOf(data, versionId);
  const leaves = leafSet(version.purposes);
  const targets = new Set(
    expandTarget(version.purposes, targetPurposeId).filter((id) => leaves.has(id)),
  );

  const before = recompute(input, input.choices);
  const choices = { ...input.choices };
  const conflicts: Conflict[] = [];

  // 必要用途拦截：不允许写入拒绝（effectiveState 也会兜底）
  const { rule, code } = userRegion(data, userId, versionId);
  for (const id of targets) {
    if (rule?.requiredPurposeIds?.includes(id)) {
      conflicts.push({
        code: 'required_withdrawn',
        message: `「${purposeName(version.purposes, id)}」是地区「${code}」的必要用途，不能撤回。`,
        location: { versionId, purposeId: id, userId, region: code },
      });
      targets.delete(id);
    }
  }
  for (const id of targets) choices[id] = 'denied';

  const after = recompute(input, choices);
  conflicts.push(...after.eff.conflicts);

  // 用户已对目标做出显式选择，不再处于待确认暂停态
  const unconfirmed = (input.unconfirmed ?? []).filter((id) => !targets.has(id));

  // 级联影响：撤回前 granted、撤回后 denied 的目标及其全部下游。
  // 撤回用途组时，要按组内每个叶子分别求下游闭包再合并（没有用途会直接 dependsOn 组 id）。
  const downstreamIds = new Set<PurposeId>();
  for (const t of targets) {
    for (const d of downstreamClosure(version.purposes, t)) {
      if (leaves.has(d.id)) downstreamIds.add(d.id);
    }
  }
  const candidateIds = new Set<PurposeId>([...targets, ...downstreamIds]);
  const affected = [...candidateIds].filter(
    (id) =>
      before.eff.values[id] === 'granted' && after.eff.values[id] === 'denied',
  );
  const cascadeOnly = affected.filter((id) => !targets.has(id));
  const idempotent = affected.length === 0;
  const detail = idempotent
    ? `重复撤回「${purposeName(
        version.purposes,
        targetPurposeId,
      )}」：该用途及下游均已处于失效状态，操作幂等，未产生新变化。`
    : `撤回「${purposeName(version.purposes, targetPurposeId)}」。${
        cascadeOnly.length
          ? `下游用途 ${cascadeOnly
              .map((id) => `「${purposeName(version.purposes, id)}」`)
              .join('、')} 失去上游授权而一并失效；`
          : ''
      }目标用途被显式拒绝（优先级最高）；下游随依赖重算而失效，重新授予上游后可恢复。`;

  return {
    choices,
    unconfirmed,
    state: after.eff.values,
    affected,
    event: {
      id: uid('evt'),
      at: nowIso(),
      type: 'withdraw',
      userId,
      versionId,
      purposeIds: [...targets],
      detail,
      resultingState: after.eff.values,
      conflicts,
    },
  };
}

/** 重新确认 / 授予：把目标用途置为 granted（地区禁止的用途仍无效）。重复授予幂等。 */
export function applyGrant(
  input: SimulationInput,
  targetPurposeId: PurposeId,
  kind: 'reconfirm' | 'grant' = 'reconfirm',
): ApplyResult {
  const { data, userId, versionId } = input;
  const version = versionOf(data, versionId);
  const targets = new Set(expandTarget(version.purposes, targetPurposeId));

  const before = recompute(input, input.choices);
  const choices = { ...input.choices };
  for (const id of targets) choices[id] = 'granted';

  const after = recompute(input, choices);
  const unconfirmed = (input.unconfirmed ?? []).filter((id) => !targets.has(id));
  const restored = [...targets].filter(
    (id) =>
      before.eff.values[id] !== 'granted' && after.eff.values[id] === 'granted',
  );
  const stillBlocked = [...targets].filter(
    (id) => after.eff.values[id] !== 'granted',
  );

  const idempotent = restored.length === 0 && stillBlocked.length === 0;
  const label = purposeName(version.purposes, targetPurposeId);
  const detail =
    kind === 'reconfirm'
      ? idempotent
        ? `重复确认「${label}」：该用途已处于同意状态，操作幂等。`
        : `用户重新确认「${label}」，新的显式同意生效；${
            restored.length ? `恢复的用途：${restored.map((id) => `「${purposeName(version.purposes, id)}」`).join('、')}。` : ''
          }${
            stillBlocked.length
              ? `以下用途仍无法生效：${stillBlocked.map((id) => `「${purposeName(version.purposes, id)}」`).join('、')}（地区规则禁止）。`
              : ''
          }`
      : `授予「${label}」。`;

  return {
    choices,
    unconfirmed,
    state: after.eff.values,
    affected: restored,
    event: {
      id: uid('evt'),
      at: nowIso(),
      type: kind,
      userId,
      versionId,
      purposeIds: [...targets],
      detail: detail.trim(),
      resultingState: after.eff.values,
      conflicts: after.eff.conflicts,
    },
  };
}

/**
 * 执行迁移并生成迁移事件。
 * 迁移结果里显式继承的选择落为勾选；reconfirm 用途进入待确认集合（暂不生效）；
 * default/prohibited/required 不落任何勾选，完全由地区规则重算。
 */
export function applyMigration(
  data: WorkbenchData,
  userId: string,
  fromVersionId: string,
  toVersionId: string,
): {
  choices: Record<PurposeId, ConsentValue>;
  unconfirmed: PurposeId[];
  event: ScenarioEvent;
  result: ReturnType<typeof planMigration>;
} {
  const result = planMigration(data, userId, fromVersionId, toVersionId);
  const choices: Record<PurposeId, ConsentValue> = {};
  for (const p of result.purposes) {
    // 仅把用户在旧版显式表达过、且成功继承的选择落到新版勾选上；
    // 默认值/依赖继承/重确认项不落勾选，保证后续撤回级联能按新图重算。
    if (p.status === 'inherited' && p.explicit) {
      choices[p.purposeId] = p.value;
    }
  }
  const toVersion = versionOf(data, toVersionId);
  const inherited = result.purposes.filter((p) => p.status === 'inherited');
  const reconfirm = result.purposes.filter((p) => p.status === 'reconfirm');
  const byDefault = result.purposes.filter((p) => p.status === 'default');

  const detail = [
    `从「${versionOf(data, fromVersionId).label}」升级到「${toVersion.label}」。`,
    inherited.length
      ? `继承旧同意 ${inherited.length} 项：${inherited
          .map((p) => `「${purposeName(toVersion.purposes, p.purposeId)}」=${p.value === 'granted' ? '同意' : '拒绝'}`)
          .join('、')}。`
      : '',
    reconfirm.length
      ? `需重新确认 ${reconfirm.length} 项：${reconfirm
          .map((p) => `「${purposeName(toVersion.purposes, p.purposeId)}」`)
          .join('、')}。`
      : '',
    byDefault.length
      ? `无历史来源、按地区默认处理 ${byDefault.length} 项。`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const event: ScenarioEvent = {
    id: uid('evt'),
    at: nowIso(),
    type: 'migrate',
    userId,
    versionId: toVersionId,
    purposeIds: result.purposes.map((p) => p.purposeId),
    detail,
    resultingState: Object.fromEntries(result.purposes.map((p) => [p.purposeId, p.value])),
    conflicts: result.conflicts,
  };
  return {
    choices,
    unconfirmed: result.reconfirmPurposeIds,
    event,
    result,
  };
}

/** 把一次演练勾选落为正式同意记录。 */
export function choicesToRecord(
  data: WorkbenchData,
  userId: string,
  versionId: string,
  choices: Record<PurposeId, ConsentValue>,
  note?: string,
): ConsentRecord {
  const { code } = userRegion(data, userId, versionId);
  return {
    id: uid('rec'),
    userId,
    versionId,
    region: code,
    choices,
    at: nowIso(),
    note,
  };
}

// ---------- helpers ---------- //

function expandTarget(purposes: WorkbenchData['versions'][number]['purposes'], id: PurposeId): PurposeId[] {
  const node = purposes.find((p) => p.id === id);
  if (!node) return [id];
  if (!node.isGroup) return [id];
  // 用途组：展开为其下全部叶子
  return expandToLeaves(purposes, id);
}

function leafSet(purposes: WorkbenchData['versions'][number]['purposes']) {
  return new Set(leafPurposes(purposes).map((p) => p.id));
}

function purposeName(purposes: WorkbenchData['versions'][number]['purposes'], id: PurposeId) {
  return purposes.find((p) => p.id === id)?.name ?? id;
}
