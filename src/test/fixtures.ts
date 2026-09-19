import type {
  ConsentValue,
  DemoUser,
  PrivacyVersion,
  Purpose,
  PurposeId,
  PurposeMapping,
  RegionRule,
  WorkbenchData,
} from '../core/types';

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function purpose(
  id: string,
  props: Partial<Purpose> = {},
  versionId = 'v1',
): Purpose {
  return { id, name: props.name ?? id, versionId, ...props };
}

export function version(
  id: string,
  purposes: Purpose[],
  props: Partial<PrivacyVersion> = {},
): PrivacyVersion {
  return {
    id,
    label: props.label ?? id,
    sequence: props.sequence ?? 1,
    parentVersionId: props.parentVersionId ?? null,
    status: props.status ?? 'published',
    createdAt: props.createdAt ?? '2024-01-01T00:00:00.000Z',
    publishedAt: props.publishedAt ?? '2024-01-02T00:00:00.000Z',
    purposes: purposes.map((p) => ({ ...p, versionId: id })),
  };
}

export function mapping(
  fromVersionId: string,
  toVersionId: string,
  sourcePurposeId: string,
  targetPurposeId: string,
  id?: string,
): PurposeMapping {
  return {
    id: id ?? nextId('m'),
    fromVersionId,
    toVersionId,
    sourcePurposeId,
    targetPurposeId,
  };
}

export function region(
  code: string,
  props: Partial<RegionRule> = {},
): RegionRule {
  return {
    code,
    name: props.name ?? code,
    mode: props.mode ?? 'opt-in',
    requiredPurposeIds: props.requiredPurposeIds,
    prohibitedPurposeIds: props.prohibitedPurposeIds,
    migrationPolicy: props.migrationPolicy ?? 'strict',
  };
}

export function user(id: string, reg: string): DemoUser {
  return { id, name: id, region: reg };
}

export interface DataParts {
  versions: PrivacyVersion[];
  mappings?: PurposeMapping[];
  regions?: RegionRule[];
  users?: DemoUser[];
  records?: WorkbenchData['records'];
}

export function data(parts: DataParts): WorkbenchData {
  return {
    versions: parts.versions,
    mappings: parts.mappings ?? [],
    regions: parts.regions ?? [region('EU'), region('CN', { mode: 'opt-out' })],
    users: parts.users ?? [user('u1', 'EU')],
    records: parts.records ?? [],
  };
}

/** 快速造一份同意记录 */
export function record(
  userId: string,
  versionId: string,
  regionCode: string,
  choices: Record<PurposeId, ConsentValue>,
  at = '2024-05-01T00:00:00.000Z',
): WorkbenchData['records'][number] {
  return { id: nextId('r'), userId, versionId, region: regionCode, choices, at };
}
