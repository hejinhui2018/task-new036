import type { ConsentValue } from '../core/types';

export function ConsentBadge({ value }: { value: ConsentValue }) {
  return (
    <span className={`badge ${value === 'granted' ? 'granted' : 'denied'}`}>
      {value === 'granted' ? '✓ 同意' : '✕ 拒绝'}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  inherited: '继承旧同意',
  reconfirm: '需重新确认',
  default: '地区默认',
  prohibited: '地区禁止',
  required: '必要用途',
};

export function MigrationStatusBadge({
  status,
}: {
  status: 'inherited' | 'reconfirm' | 'default' | 'prohibited' | 'required';
}) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function VersionStatusBadge({ status }: { status: 'draft' | 'published' }) {
  return (
    <span className={`badge ${status === 'published' ? 'published' : 'draft'}`}>
      {status === 'published' ? '已发布·冻结' : '草稿'}
    </span>
  );
}
