export type ID = string;

/** 用途（数据目的），以 parentId 组成层级树 */
export interface Purpose {
  id: ID;
  key: string;
  name: string;
  parentId: ID | null;
  /** 指向基线版本用途 id 的数组：0 个=新增，1 个=继承/更名/拆分，多个=合并 */
  derivedFrom: ID[];
  description?: string;
}

export type VersionStatus = 'draft' | 'published';

/** 隐私说明版本。发布后不可变。 */
export interface PolicyVersion {
  id: ID;
  label: string;
  status: VersionStatus;
  baseVersionId: ID | null;
  purposes: Purpose[];
  createdAt: number;
  publishedAt: number | null;
}

export type ConsentModel = 'opt-in' | 'opt-out';
export type MergeStrategy = 'all' | 'any';

/** 地区同意规则：迁移、撤回都按用户所在地区判定 */
export interface RegionRule {
  region: string;
  /** opt-in 默认拒绝；opt-out 默认同意 */
  model: ConsentModel;
  /** 新增用途是否需要显式同意 */
  requireExplicitForNew: boolean;
  /** 旧用途拆分后，继承的用途是否需要重新确认 */
  splitRequiresReconfirm: boolean;
  /** 多来源合并时：all=全部同意才继承；any=任一同意即继承 */
  mergeStrategy: MergeStrategy;
  /** 撤回父用途时是否级联撤回下游（子）用途 */
  cascadeWithdraw: boolean;
}

export type ConsentStatus = 'granted' | 'denied';
export type ConsentSource = 'user' | 'migration' | 'default';

/** 同意记录：只记录明确的决定；“未确认”= 没有记录 */
export interface ConsentRecord {
  userId: ID;
  versionId: ID;
  purposeId: ID;
  status: ConsentStatus;
  source: ConsentSource;
  updatedAt: number;
}

export interface UserProfile {
  id: ID;
  name: string;
  region: string;
}

/** 可撤销/可持久化的领域数据 */
export interface DomainData {
  versions: PolicyVersion[];
  rules: RegionRule[];
  users: UserProfile[];
  records: ConsentRecord[];
}

/** 情景快照：冻结某一时刻的领域数据 */
export interface ScenarioSnapshot {
  id: ID;
  name: string;
  createdAt: number;
  data: DomainData;
}

export interface DomainState extends DomainData {
  snapshots: ScenarioSnapshot[];
}
