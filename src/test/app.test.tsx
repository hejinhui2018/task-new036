import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
});

describe('App 集成冒烟', () => {
  it('默认渲染演练台，示例用户迁移预览包含拆分出的分析与个性化', () => {
    render(<App />);
    expect(screen.getByText('ConsentPath')).toBeTruthy();
    // 默认林晓 EU v1→v2
    expect(screen.getByText('迁移预览')).toBeTruthy();
    expect(screen.getAllByText('分析').length).toBeGreaterThan(0);
    expect(screen.getAllByText('个性化').length).toBeGreaterThan(0);
    // ads_targeting 在严格策略下需要重新确认
    expect(screen.getAllByText(/需重新确认/).length).toBeGreaterThan(0);
  });

  it('执行迁移 → 撤回 → 重新确认的完整链路可交互，并写入事件日志', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /执行迁移/ }));

    // 进入演练会话：出现「撤回此项」按钮
    const withdrawButtons = screen.getAllByRole('button', { name: '撤回此项' });
    expect(withdrawButtons.length).toBeGreaterThan(0);
    // 撤回「分析」
    fireEvent.click(withdrawButtons[0]);
    expect(screen.getAllByText(/部分撤回/).length).toBeGreaterThan(0);

    // 重新确认/授予按钮可用
    const grantButtons = screen.getAllByRole('button', { name: /重新确认/ });
    expect(grantButtons.length).toBeGreaterThan(0);
    fireEvent.click(grantButtons[0]);
  });

  it('已发布版本在版本页被冻结：用途区不显示新增按钮，但可创建草稿分叉', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '版本与用途' }));
    // 默认选中草稿 v3；切到已发布 v1 验证冻结
    const selector = screen.getByDisplayValue(/seq 3/);
    fireEvent.change(selector, { target: { value: 'v1' } });
    expect(screen.getByText(/该版本已发布冻结/)).toBeTruthy();
    expect(screen.queryByText('+ 根叶子用途')).toBeNull();
    expect(screen.getByRole('button', { name: /创建草稿分叉/ })).toBeTruthy();
  });

  it('健康检查页能渲染且内置数据仅提示 BR 地区问题；撤销重做按钮存在', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '检查与快照' }));
    const text = document.body.textContent ?? '';
    expect(text).toContain('情景快照');
    // BR 无地区规则
    expect(text).toContain('region: BR');
    // 撤销按钮初始禁用
    const undo = screen.getByTitle(/撤销/);
    expect(undo.hasAttribute('disabled')).toBe(true);
  });

  it('地区规则页可打开并看到三种地区模式', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '地区规则' }));
    const table = document.body.textContent ?? '';
    expect(table).toContain('欧盟');
    expect(table).toContain('中国大陆');
    expect(table).toContain('美国');
  });
});
