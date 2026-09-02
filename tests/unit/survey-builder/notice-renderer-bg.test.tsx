// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeRenderer } from '@/components/survey-builder/notice-renderer';

/**
 * 공지 패널 배경색(noticeBgColor) 렌더 분기.
 * - 미지정: 기존 파란 패널 (기존 설문 외형 불변)
 * - 'none': 패널 제거 (무배경·무테두리·무패딩)
 * - '#rrggbb': 지정색 배경 + 파생 테두리
 */
describe('NoticeRenderer 배경색', () => {
  afterEach(cleanup);

  function panelOf(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[data-notice-panel]');
    if (!el) throw new Error('notice panel not found');
    return el as HTMLElement;
  }

  it('미지정이면 기존 파란 패널 클래스를 유지한다', () => {
    const { container } = render(<NoticeRenderer content="<p>안내</p>" />);
    const panel = panelOf(container);
    expect(panel.className).toContain('bg-blue-50/40');
    expect(panel.className).toContain('border-blue-100');
  });

  it("'none' 이면 패널 스타일이 제거된다", () => {
    const { container } = render(<NoticeRenderer content="<p>안내</p>" bgColor="none" />);
    const panel = panelOf(container);
    expect(panel.className).not.toContain('bg-blue-50/40');
    expect(panel.className).not.toContain('border-blue-100');
    expect(panel.className).not.toContain('p-6');
    expect(panel.style.backgroundColor).toBe('');
  });

  it('hex 지정 시 배경은 지정색, 테두리는 파생색으로 그린다', () => {
    const { container } = render(<NoticeRenderer content="<p>안내</p>" bgColor="#fff3e0" />);
    const panel = panelOf(container);
    expect(panel.className).not.toContain('bg-blue-50/40');
    expect(panel.style.backgroundColor).toBe('rgb(255, 243, 224)');
    // 파생 테두리 — 배경보다 어두운 색이 지정된다
    expect(panel.style.borderColor).not.toBe('');
    expect(panel.style.borderColor).not.toBe(panel.style.backgroundColor);
  });
});
