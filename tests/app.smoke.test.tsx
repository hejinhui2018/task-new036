import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../src/App';

describe('App 冒烟', () => {
  it('首屏渲染不崩溃，包含关键面板与示例数据', () => {
    const html = renderToString(<App />);
    expect(html).toContain('ConsentPath');
    expect(html).toContain('版本与用途');
    expect(html).toContain('地区规则');
    expect(html).toContain('用户与同意');
    expect(html).toContain('迁移演练');
    expect(html).toContain('冲突');
    // 示例数据：v1.0 已发布、v2.0 草稿在版本列表中，首屏展示 v1 的用途
    expect(html).toContain('v1.0');
    expect(html).toContain('v2.0');
    expect(html).toContain('体验优化');
    expect(html).toContain('必要服务');
  });
});
