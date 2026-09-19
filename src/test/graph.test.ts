import { describe, it, expect } from 'vitest';
import {
  ancestorChain,
  downstreamClosure,
  findMappingCycle,
  findPurposeCycle,
  leafPurposes,
} from '../core/graph';
import { mapping, purpose, version } from './fixtures';

describe('用途图', () => {
  it('识别叶子用途（组本身不持有同意）', () => {
    const v = version('v1', [
      purpose('g', { isGroup: true }),
      purpose('a', { parentId: 'g' }),
      purpose('b', { parentId: 'g' }),
      purpose('c'),
    ]);
    expect(leafPurposes(v.purposes).map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('检测 dependsOn 自环', () => {
    const v = version('v1', [purpose('a', { dependsOn: ['a'] })]);
    expect(findPurposeCycle(v.purposes)).toEqual(['a', 'a']);
  });

  it('检测多节点依赖环', () => {
    const v = version('v1', [
      purpose('a', { dependsOn: ['b'] }),
      purpose('b', { dependsOn: ['c'] }),
      purpose('c', { dependsOn: ['a'] }),
    ]);
    const cycle = findPurposeCycle(v.purposes);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });

  it('无环时返回 null', () => {
    const v = version('v1', [
      purpose('a'),
      purpose('b', { dependsOn: ['a'] }),
      purpose('c', { dependsOn: ['b'] }),
    ]);
    expect(findPurposeCycle(v.purposes)).toBeNull();
  });

  it('下游传递闭包用于撤回影响分析', () => {
    const v = version('v1', [
      purpose('a'),
      purpose('b', { dependsOn: ['a'] }),
      purpose('c', { dependsOn: ['b'] }),
      purpose('other'),
    ]);
    const closure = downstreamClosure(v.purposes, 'a').map((d) => d.id);
    expect(closure).toEqual(['b', 'c']);
  });

  it('祖先链面包屑', () => {
    const v = version('v1', [
      purpose('g', { isGroup: true }),
      purpose('sg', { isGroup: true, parentId: 'g' }),
      purpose('a', { parentId: 'sg' }),
    ]);
    expect(ancestorChain(v.purposes, 'a').map((p) => p.id)).toEqual(['g', 'sg']);
  });
});

describe('跨版本映射图', () => {
  it('无环返回 null', () => {
    const cyc = findMappingCycle([
      mapping('v1', 'v2', 'a', 'x'),
      mapping('v2', 'v3', 'x', 'y'),
    ]);
    expect(cyc).toBeNull();
  });

  it('检测跨版本映射环并定位涉及的映射', () => {
    const cyc = findMappingCycle([
      mapping('v1', 'v2', 'a', 'b', 'map_fwd'),
      mapping('v2', 'v1', 'b', 'a', 'map_back'),
    ]);
    expect(cyc).not.toBeNull();
    expect(cyc!.mappingIds).toContain('map_fwd');
    expect(cyc!.mappingIds).toContain('map_back');
  });
});
