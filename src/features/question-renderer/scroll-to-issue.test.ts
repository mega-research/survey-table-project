// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollToValidationNotice } from './scroll-to-issue';

/**
 * 「다음」이 막히면 문항의 검증 안내(CONTEXT.md)로 간다 — 위반 셀·문항 카드로 뛰어들지 않는다.
 * 표 문항은 카드 가운데가 표 한복판이라 어디가 문제인지 보이지 않았다.
 */
function mount(html: string) {
  document.body.innerHTML = html;
  const calls: Array<{ el: Element; opts: unknown }> = [];
  Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) {
    calls.push({ el: this, opts });
  };
  return calls;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('scrollToValidationNotice', () => {
  it('검증 안내가 있으면 셀·문항 카드가 아니라 안내로 가고 첫 「위치로 이동」에 포커스한다', () => {
    const calls = mount(`
      <div data-question-id="q1">
        <div data-cell-id="c1"><input /></div>
        <div data-validation-notice="q1">
          <button type="button">위치로 이동</button>
          <button type="button">위치로 이동</button>
        </div>
      </div>`);
    scrollToValidationNotice('q1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.el).toBe(document.querySelector('[data-validation-notice="q1"]'));
    expect(calls[0]!.opts).toMatchObject({ block: 'center' });
    expect(document.activeElement).toBe(document.querySelector('button'));
  });

  it('버튼 없는 한 줄 안내면 스크롤만 하고 포커스는 옮기지 않는다', () => {
    const calls = mount(`
      <div data-question-id="q1">
        <input id="x" />
        <p data-validation-notice="q1">필수 질문에 답변해주세요.</p>
      </div>`);
    scrollToValidationNotice('q1');
    expect(calls[0]!.el).toBe(document.querySelector('p'));
    expect(document.activeElement).toBe(document.body);
  });

  it('안내가 없으면 문항 카드로 간다', () => {
    const calls = mount(`<div data-question-id="q1"><input /></div>`);
    scrollToValidationNotice('q1');
    expect(calls[0]!.el).toBe(document.querySelector('[data-question-id="q1"]'));
  });

  it('다른 문항의 안내는 고르지 않는다', () => {
    const calls = mount(`
      <p data-validation-notice="q0">다른 문항</p>
      <div data-question-id="q1"></div>`);
    scrollToValidationNotice('q1');
    expect(calls[0]!.el).toBe(document.querySelector('[data-question-id="q1"]'));
  });
});
