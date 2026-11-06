/**
 * `pnpm survey:render` 의 화면 → 글자 변환. CSS 를 계산하지 않으므로 무엇을 숨김으로 보는지가 계약이다.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isTailwindHidden, outlinePage } from '../../scripts/survey-ops/outline';

describe('isTailwindHidden', () => {
  it('hidden 은 모바일·데스크톱 모두 숨김, md:block 이 붙으면 데스크톱에서만 보인다', () => {
    expect(isTailwindHidden('hidden', true)).toBe(true);
    expect(isTailwindHidden('hidden md:block', true)).toBe(true);
    expect(isTailwindHidden('hidden md:block', false)).toBe(false);
  });

  it('md:hidden 은 데스크톱에서만 숨김, sr-only 는 늘 숨김', () => {
    expect(isTailwindHidden('flex md:hidden', true)).toBe(false);
    expect(isTailwindHidden('flex md:hidden', false)).toBe(true);
    expect(isTailwindHidden('sr-only', false)).toBe(true);
  });
});

describe('outlinePage', () => {
  it('숨은 요소를 빼고 입력값·선택 상태·표 칸을 글자로 낸다', () => {
    const { container } = render(
      <main>
        <h2>문1. 업체명</h2>
        <p hidden>숨은 안내</p>
        <p aria-hidden="true">장식</p>
        <p style={{ display: 'none' }}>인라인 숨김</p>
        <input defaultValue="메가리서치" readOnly />
        <label>
          <input type="radio" name="a" defaultChecked /> 예
        </label>
        <label>
          <input type="radio" name="a" /> 아니오
        </label>
        <div className="md:hidden">모바일 전용</div>
        <table>
          <tbody>
            <tr>
              <td>원유</td>
              <td>
                <input defaultValue="" />
              </td>
            </tr>
          </tbody>
        </table>
      </main>,
    );
    const text = outlinePage(container, { mobile: false });
    expect(text).toBe(
      [
        '문1. 업체명',
        '[입력 "메가리서치" 잠김]',
        '(●) 예',
        '( ) 아니오',
        '원유 | [입력 비어 있음]',
      ].join('\n'),
    );
    expect(outlinePage(container, { mobile: true })).toContain('모바일 전용');
  });
});
