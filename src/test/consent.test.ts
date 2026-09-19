import { describe, it, expect } from 'vitest';
import { effectiveState } from '../core/consent';
import { purpose, region, version } from './fixtures';

function v1Like() {
  // 独立用途 a、b；下游 c 依赖 a 和 b
  return version('v1', [
    purpose('necessary_core'),
    purpose('a'),
    purpose('b'),
    purpose('c', { dependsOn: ['a', 'b'] }),
  ]);
}

describe('effectiveState：地区默认值', () => {
  it('opt-in：没有勾选时独立用途默认拒绝', () => {
    const eff = effectiveState(v1Like(), {}, region('EU'), 'EU');
    expect(eff.values.a).toBe('denied');
    expect(eff.values.b).toBe('denied');
    expect(eff.grantedBy.a).toEqual(['default']);
  });

  it('opt-out：没有勾选时独立用途默认允许', () => {
    const eff = effectiveState(v1Like(), {}, region('CN', { mode: 'opt-out' }), 'CN');
    expect(eff.values.a).toBe('granted');
    expect(eff.values.b).toBe('granted');
  });

  it('notice 模式：独立用途恒为允许', () => {
    const eff = effectiveState(v1Like(), { a: 'denied' }, region('US', { mode: 'notice' }), 'US');
    // 显式拒绝仍然成立
    expect(eff.values.a).toBe('denied');
    expect(eff.values.b).toBe('granted');
  });

  it('地区缺失：保守按 opt-in 处理并报地区不匹配冲突', () => {
    const eff = effectiveState(v1Like(), {}, null, 'BR');
    expect(eff.values.a).toBe('denied');
    expect(eff.conflicts.some((c) => c.code === 'region_mismatch')).toBe(true);
  });
});

describe('effectiveState：必要用途与地区禁止', () => {
  it('必要用途恒为同意，显式拒绝无效并报冲突', () => {
    const eff = effectiveState(
      v1Like(),
      { necessary_core: 'denied' },
      region('EU', { requiredPurposeIds: ['necessary_core'] }),
      'EU',
    );
    expect(eff.values.necessary_core).toBe('granted');
    expect(eff.conflicts.some((c) => c.code === 'required_withdrawn')).toBe(true);
  });

  it('被禁用途恒为拒绝，显式勾选也无效并报冲突', () => {
    const eff = effectiveState(
      v1Like(),
      { a: 'granted' },
      region('EU', { prohibitedPurposeIds: ['a'] }),
      'EU',
    );
    expect(eff.values.a).toBe('denied');
    expect(eff.conflicts.some((c) => c.code === 'region_mismatch')).toBe(true);
  });
});

describe('effectiveState：下游依赖与撤回级联', () => {
  it('opt-in 下授权上游会隐含授权下游', () => {
    const eff = effectiveState(v1Like(), { a: 'granted', b: 'granted' }, region('EU'), 'EU');
    expect(eff.values.c).toBe('granted');
    expect(eff.grantedBy.c).toContain('a');
    expect(eff.grantedBy.c).toContain('b');
  });

  it('显式拒绝下游优先级最高，即便上游全部授权', () => {
    const eff = effectiveState(
      v1Like(),
      { a: 'granted', b: 'granted', c: 'denied' },
      region('EU'),
      'EU',
    );
    expect(eff.values.c).toBe('denied');
  });

  it('opt-out 下撤回唯一上游后下游必须失效（默认值不能挽救）', () => {
    const optout = region('CN', { mode: 'opt-out' });
    const before = effectiveState(v1Like(), {}, optout, 'CN');
    expect(before.values.a).toBe('granted');
    expect(before.values.c).toBe('granted');

    // 用户撤回 a（显式拒绝）；b 仍默认允许，c 还有一个上游 b → c 应继续有效
    const afterWithdrawA = effectiveState(v1Like(), { a: 'denied' }, optout, 'CN');
    expect(afterWithdrawA.values.a).toBe('denied');
    expect(afterWithdrawA.values.c).toBe('granted');

    // 再撤回 b：c 失去全部上游 → 失效，即便地区默认允许
    const afterWithdrawB = effectiveState(v1Like(), { a: 'denied', b: 'denied' }, optout, 'CN');
    expect(afterWithdrawB.values.c).toBe('denied');
  });

  it('显式授予下游也不能绕过被撤回的上游', () => {
    const eff = effectiveState(
      v1Like(),
      { a: 'denied', b: 'denied', c: 'granted' },
      region('CN', { mode: 'opt-out' }),
      'CN',
    );
    expect(eff.values.c).toBe('denied');
  });

  it('suspended 待确认用途在重新确认前不按默认/上游放开；显式授予解除', () => {
    const r = region('CN', { mode: 'opt-out' });
    const suspended = effectiveState(v1Like(), { a: 'granted', b: 'granted' }, r, 'CN', new Set(['c']));
    expect(suspended.values.c).toBe('denied');

    const confirmed = effectiveState(
      v1Like(),
      { a: 'granted', b: 'granted', c: 'granted' },
      r,
      'CN',
      new Set(['c']),
    );
    expect(confirmed.values.c).toBe('granted');
  });
});
