// ConsentPath 核心领域模型
// 所有数据均可 JSON 序列化，整个应用只在浏览器本地运行。

/** 稳定标识：用途 / 用途组，例如 `necessary`、`experience_optimization` */
export type PurposeId = string;
/** 说明版本标识，例如 `privacy-v1` */
export type VersionId = string;
/** 地区标识（ISO-3166-1 alpha-2 或自定义区域码），例如 `EU`、`CN`、`US` */
export type RegionCode = string;
/** 用户标识 */
export type UserId = string;

/** 用途（或用途组）节点 */
export interface Purpose {
  id: PurposeId;
  name: string;
  /** 所属版本 */
  versionId: VersionId;
  /** 是否为用途组（父节点）。叶子用途才直接持有同意。 */
  isGroup?: boolean;
  /** 父用途组 id；构成版本内的用途层级（树） */
  parentId?: PurposeId | null;
  /**
   * 依赖的下游用途 id（DAG 边）。
   * 语义：授权了本用途即隐含授权下游用途；撤回本用途时下游一并失效（除非另有独立来源）。
   */
  dependsOn?: PurposeId[];
  description?: string;
}

/** 地区同意模式 */
export type ConsentMode =
  | 'opt-in' // 必须显式同意，默认拒绝（GDPR 式）
  | 'opt-out' // 默认允许，可显式拒绝
  | 'notice'; // 仅告知，无需选择，恒为允许

/** 地区规则 */
export interface RegionRule {
  code: RegionCode;
  name: string;
  mode: ConsentMode;
  /** 不可拒绝的必要用途 id（即便 opt-in 也视为已同意且不可撤回） */
  requiredPurposeIds?: PurposeId[];
  /** 该地区完全不允许的用途 id（即便勾选也无效） */
  prohibitedPurposeIds?: PurposeId[];
  /**
   * 跨大版本迁移策略：
   * - strict：未被旧用途精确覆盖的新用途必须重新确认
   * - notice：未覆盖用途按通知模式处理（允许但留痕），不阻塞
   */
  migrationPolicy?: 'strict' | 'notice';
}

/** 说明版本 */
export interface PrivacyVersion {
  id: VersionId;
  label: string;
  /** 版本序号，越大越新（分叉时各自递增） */
  sequence: number;
  /** 由哪个版本演进而来（分叉链）。根版本为 null */
  parentVersionId?: VersionId | null;
  /** 草稿可编辑；发布后内容冻结，不可再改 */
  status: 'draft' | 'published';
  createdAt: string;
  publishedAt?: string;
  /** 该版本内定义的用途 */
  purposes: Purpose[];
}

/**
 * 版本间用途映射。
 * 一条规则表示：fromVersion 的 sourcePurposeId 演进为 toVersion 的 targetPurposeId。
 * 多条 source -> 同一个 target 即「用途合并」；一个 source 对多个 target 即「用途拆分」。
 */
export interface PurposeMapping {
  id: string;
  fromVersionId: VersionId;
  toVersionId: VersionId;
  sourcePurposeId: PurposeId;
  targetPurposeId: PurposeId;
}

export type ConsentValue = 'granted' | 'denied';

/** 一条同意记录（用户在某个说明版本上给出的选择） */
export interface ConsentRecord {
  id: string;
  userId: UserId;
  versionId: VersionId;
  /** 用户所在地区，决定适用的地区规则 */
  region: RegionCode;
  /** 叶子用途 id -> 选择 */
  choices: Record<PurposeId, ConsentValue>;
  /** 记录时间（ISO 字符串） */
  at: string;
  /** 备注，例如「首次弹窗」「重新确认」 */
  note?: string;
}

/** 示例用户 */
export interface DemoUser {
  id: UserId;
  name: string;
  region: RegionCode;
}

// ---------- 迁移与演练结果 -------- //

export type ConflictCode =
  | 'version_fork' // 目标版本不在旧版本的后继链上
  | 'mapping_cycle' // 版本间映射形成环
  | 'purpose_cycle' // 用途层级/依赖存在环
  | 'merge_conflict' // 多个旧用途合并为一个，但授权状态不一致
  | 'region_mismatch' // 用户地区缺少规则或用途在该地区被禁
  | 'unmapped_purpose' // 新用途没有任何旧来源，strict 下需重新确认
  | 'mapping_target_missing' // 映射指向的用途不存在
  | 'mapping_source_missing' // 映射引用的旧用途不存在
  | 'published_version_mutated' // 试图修改已发布版本
  | 'required_withdrawn'; // 试图撤回必要用途

export interface Conflict {
  code: ConflictCode;
  /** 人类可读说明 */
  message: string;
  /** 可定位的实体坐标 */
  location: {
    versionId?: VersionId;
    purposeId?: PurposeId;
    mappingId?: string;
    userId?: UserId;
    region?: RegionCode;
    /** 涉及的环路径（用途 id 序列），便于定位 */
    path?: PurposeId[];
  };
}

/** 单个新用途在迁移后的结论 */
export interface MigratedPurpose {
  purposeId: PurposeId;
  value: ConsentValue;
  status:
    | 'inherited' // 由旧同意继承，仍然有效
    | 'reconfirm' // 无法继承，必须重新确认
    | 'default' // 无旧同意，按地区默认值
    | 'prohibited' // 该地区禁止
    | 'required'; // 必要用途，恒为允许
  /** 继承自哪些旧用途（合并时可能多个） */
  sources: PurposeId[];
  /**
   * 迁移值是否来自用户在旧版上的显式勾选。
   * false 表示该值是地区默认/依赖继承的推算结果，不应冻结为新勾选，
   * 这样撤回上游后下游才能按新图重新计算而失效。
   */
  explicit?: boolean;
  /** 结论理由（给演练台展示「为何继承/失效」） */
  reason: string;
}

export interface MigrationResult {
  userId: UserId;
  region: RegionCode;
  fromVersionId: VersionId;
  toVersionId: VersionId;
  purposes: MigratedPurpose[];
  conflicts: Conflict[];
  /** 迁移后仍处于 granted 的叶子用途 */
  grantedPurposeIds: PurposeId[];
  /** 必须重新确认的叶子用途 */
  reconfirmPurposeIds: PurposeId[];
}

/** 演练事件类型 */
export type ScenarioEventType =
  | 'migrate'
  | 'withdraw'
  | 'reconfirm'
  | 'grant'
  | 'conflict';

export interface ScenarioEvent {
  id: string;
  at: string;
  type: ScenarioEventType;
  userId: UserId;
  versionId: VersionId;
  /** 本次涉及的用途 */
  purposeIds: PurposeId[];
  detail: string;
  /** 操作后该版本上各用途的有效状态（含级联） */
  resultingState: Record<PurposeId, ConsentValue>;
  conflicts: Conflict[];
}

/** 情景快照：保存整个工作台数据 + 演练事件 + 当前选择 */
export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  data: WorkbenchData;
  events: ScenarioEvent[];
  note?: string;
}

/** 工作台可编辑的全部数据（草稿态） */
export interface WorkbenchData {
  versions: PrivacyVersion[];
  mappings: PurposeMapping[];
  regions: RegionRule[];
  users: DemoUser[];
  records: ConsentRecord[];
}
