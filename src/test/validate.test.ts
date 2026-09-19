import { describe, it, expect } from 'vitest';
import { validateData } from '../core/validate';
import { seedData } from '../core/seed';
import { data, mapping, purpose, record, region, user, version } from './fixtures';

describe('validateData：静态规则校验', () => {
  it('正常数据没有结构冲突', () => {
    const d = data({
      versions: [
        version('v1', [purpose('a'), purpose('b', { dependsOn: ['a'] })]),
        version('v2', [purpose('a2')], { parentVersionId: 'v1', sequence: 2 }),
      ],
      mappings: [mapping('v1', 'v2', 'a', 'a2')],
      regions: [region('EU')],
      users: [user('u1', 'EU')],
      records: [record('u1', 'v1', 'EU', { a: 'granted' })],
    });
    expect(validateData(d)).toEqual([]);
  });

  it('检测用途依赖环并定位版本与路径', () => {
    const d = data({
      versions: [
        version('v1', [
          purpose('a', { dependsOn: ['b'] }),
          purpose('b', { dependsOn: ['a'] }),
        ]),
      ],
    });
    const conflicts = validateData(d);
    const c = conflicts.find((x) => x.code === 'purpose_cycle')!;
    expect(c).toBeDefined();
    expect(c.location.versionId).toBe('v1');
    expect(c.location.path?.length).toBeGreaterThan(1);
  });

  it('检测悬空 dependsOn 引用', () => {
    const d = data({
      versions: [version('v1', [purpose('a', { dependsOn: ['ghost'] })])],
    });
    expect(validateData(d).some((c) => c.code === 'purpose_cycle' && c.location.purposeId === 'a')).toBe(true);
  });

  it('检测映射环', () => {
    const d = data({
      versions: [version('v1', [purpose('a'), purpose('b')]), version('v2', [purpose('a2')], { sequence: 2 })],
      mappings: [
        mapping('v1', 'v2', 'a', 'a2', 'fwd'),
        mapping('v2', 'v1', 'a2', 'a', 'back'),
      ],
    });
    const c = validateData(d).find((x) => x.code === 'mapping_cycle');
    expect(c).toBeDefined();
    expect(c!.location.mappingId).toBeDefined();
  });

  it('检测映射引用的用途/版本缺失', () => {
    const d = data({
      versions: [version('v1', [purpose('a')]), version('v2', [purpose('x')], { sequence: 2, parentVersionId: 'v1' })],
      mappings: [mapping('v1', 'v2', 'a', 'ghost', 'm_missing')],
    });
    const c = validateData(d).find((x) => x.code === 'mapping_target_missing')!;
    expect(c.location.mappingId).toBe('m_missing');
    expect(c.location.purposeId).toBe('ghost');
  });

  it('检测地区规则引用了不存在的用途', () => {
    const d = data({
      versions: [version('v1', [purpose('a')])],
      regions: [region('EU', { prohibitedPurposeIds: ['ghost_purpose'] })],
    });
    expect(validateData(d).some((c) => c.code === 'region_mismatch' && c.location.purposeId === 'ghost_purpose')).toBe(true);
  });

  it('检测同意记录引用了不存在的地区', () => {
    const d = data({
      versions: [version('v1', [purpose('a')])],
      regions: [region('EU')],
      users: [user('u1', 'BR')],
      records: [record('u1', 'v1', 'BR', { a: 'granted' })],
    });
    expect(validateData(d).some((c) => c.code === 'region_mismatch' && c.location.region === 'BR')).toBe(true);
  });

  it('检测不存在的父版本声明', () => {
    const d = data({
      versions: [version('v2', [purpose('a')], { parentVersionId: 'v99', sequence: 2 })],
    });
    expect(validateData(d).some((c) => c.code === 'version_fork')).toBe(true);
  });
});

describe('内置示例数据', () => {
  it('结构上只有故意保留的 BR 无地区规则一处冲突，其余全部健康', () => {
    const conflicts = validateData(seedData());
    const nonRegion = conflicts.filter((c) => c.code !== 'region_mismatch');
    expect(nonRegion).toEqual([]);
    expect(conflicts.some((c) => c.location.region === 'BR')).toBe(true);
  });
});
