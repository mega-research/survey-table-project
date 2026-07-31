/**
 * 테이블 셀(라디오/체크박스/드롭다운) 옵션 라벨의 응답 인용 치환 회귀 테스트.
 *
 * Task 7 fix round 1 — 리뷰가 지적한 대칭성 문제: 질문 레벨 라디오/체크박스/드롭다운(question-input.tsx)에는
 * 이미 치환이 붙어 있었지만, 표 셀 버전(cells/radio-cell.tsx, checkbox-cell.tsx, select-cell.tsx)에는
 * 빠져 있었다 — "표 안 라디오는 인용이 안 붙네" 라는 혼란을 막기 위해 세 셀 모두에 동일하게 적용한다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckboxCell } from '@/components/survey-builder/cells/checkbox-cell';
import { RadioCell } from '@/components/survey-builder/cells/radio-cell';
import { SelectCell } from '@/components/survey-builder/cells/select-cell';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { TableCell } from '@/types/survey';

describe('테이블 셀 옵션 라벨 — 응답 인용 치환', () => {
  afterEach(cleanup);

  it('RadioCell 옵션 라벨의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'cell-radio',
      type: 'radio',
      radioOptions: [{ id: 'o1', label: '{{{이름}}}님 응답', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <RadioCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 응답')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 응답')).not.toBeInTheDocument();
  });

  it('CheckboxCell 옵션 라벨의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'cell-check',
      type: 'checkbox',
      checkboxOptions: [{ id: 'o1', label: '{{{이름}}}님 항목', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <CheckboxCell cell={cell} cellResponse={[]} onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText('홍길동님 항목')).toBeInTheDocument();
    expect(screen.queryByText('{{{이름}}}님 항목')).not.toBeInTheDocument();
  });

  it('SelectCell 옵션 라벨의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'cell-select',
      type: 'select',
      selectOptions: [{ id: 'o1', label: '{{{이름}}}님 선택', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 이름: '홍길동' }}>
        <SelectCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByRole('option', { name: '홍길동님 선택' })).toBeInTheDocument();
  });

  it('Provider 없이 렌더돼도(빌더 미리보기 등) 원본 라벨을 그대로 두지 않고 빈 문자열로 안전 폴백한다', () => {
    const cell = {
      id: 'cell-radio-2',
      type: 'radio',
      radioOptions: [{ id: 'o1', label: '{{{이름}}}님 응답', value: '1' }],
    } as unknown as TableCell;

    render(<RadioCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />);

    // useAnswerQuotes()/useContactAttrs() 는 Provider 밖에서 {} 를 반환 — 미해결 토큰은 빈 문자열
    expect(screen.getByText('님 응답')).toBeInTheDocument();
  });
});
