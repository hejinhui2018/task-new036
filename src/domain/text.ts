import type { ConsentSource, ConsentStatus } from '../types';
import type { MappingKind } from './purposes';
import type { MigrationOutcome } from './migration';
import type { ConflictKind } from './conflicts';

export const statusText = (s: ConsentStatus): string => (s === 'granted' ? '同意' : '拒绝');

export const sourceText = (s: ConsentSource): string =>
  s === 'user' ? '用户操作' : s === 'migration' ? '迁移继承' : '规则默认';

export const mappingKindText = (k: MappingKind): string =>
  ({ carry: '继承', rename: '更名', split: '拆分', merge: '合并', new: '新增' })[k];

export const outcomeText = (o: MigrationOutcome): string =>
  ({
    inherited: '继承',
    defaulted: '按默认',
    'reconfirm-required': '待重新确认',
    invalidated: '失效',
    'already-exists': '已存在·跳过',
    blocked: '受阻',
  })[o];

export const conflictKindText = (k: ConflictKind): string =>
  ({
    'version-fork': '版本分叉',
    'purpose-merge': '用途合并冲突',
    'circular-ref': '循环引用',
    'region-mismatch': '地区不匹配',
  })[k];
