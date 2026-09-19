/** 生成本地稳定 id（不依赖外部服务）。 */
export function uid(prefix = 'id'): string {
  // crypto.randomUUID 在现代浏览器与 Node 19+ 均可用
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
