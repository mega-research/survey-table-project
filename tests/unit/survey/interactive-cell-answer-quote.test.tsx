/**
 * 테이블 셀(라디오/체크박스/드롭다운) 옵션 라벨의 응답 인용 치환 회귀 테스트.
 *
 * Task 7 fix round 1 — 리뷰가 지적한 대칭성 문제: 질문 레벨 라디오/체크박스/드롭다운(question-input.tsx)에는
 * 이미 치환이 붙어 있었지만, 표 셀 버전(cells/radio-cell.tsx, checkbox-cell.tsx, select-cell.tsx)에는
 * 빠져 있었다 — "표 안 라디오는 인용이 안 붙네" 라는 혼란을 막기 위해 세 셀 모두에 동일하게 적용한다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CheckboxCell } from '@/components/survey-builder/cells/checkbox-cell';
import { InputCell } from '@/components/survey-builder/cells/input-cell';
import { RadioCell } from '@/components/survey-builder/cells/radio-cell';
import { RankingCell } from '@/components/survey-builder/cells/ranking-cell';
import { SelectCell } from '@/components/survey-builder/cells/select-cell';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { TableCell } from '@/types/survey';

// RankingCell 이 쓰는 useMobileView(useMediaQuery)가 jsdom 에 없는 matchMedia 를 부른다.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

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

/**
 * 최종 리뷰 C1 — 셀 자체 문구(cell.content)의 응답 인용 치환.
 *
 * 옵션 라벨만 치환되고 컨트롤 옆 프롬프트 라벨(cell.content)은 원문 그대로 노출되던 갭.
 * text 셀만 치환하고 input/select/radio/checkbox/ranking 셀은 CellContentLayout 에
 * cell.content 를 그대로 넘겨 토큰이 화면에 그대로 찍혔다.
 */
describe('테이블 셀 문구(cell.content) — 응답 인용 치환', () => {
  afterEach(cleanup);

  const quotes = { 이름: '홍길동' };
  const CONTENT = '{{{이름}}} 선택';
  const SUBSTITUTED = '홍길동 선택';

  it('RadioCell 셀 문구의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-radio',
      type: 'radio',
      content: CONTENT,
      radioOptions: [{ id: 'o1', label: '보기1', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={quotes}>
        <RadioCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText(SUBSTITUTED)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it('CheckboxCell 셀 문구의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-check',
      type: 'checkbox',
      content: CONTENT,
      checkboxOptions: [{ id: 'o1', label: '보기1', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={quotes}>
        <CheckboxCell cell={cell} cellResponse={[]} onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText(SUBSTITUTED)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it('InputCell 셀 문구의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-input',
      type: 'input',
      content: CONTENT,
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={quotes}>
        <InputCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText(SUBSTITUTED)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it('SelectCell 셀 문구의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-select',
      type: 'select',
      content: CONTENT,
      selectOptions: [{ id: 'o1', label: '보기1', value: '1' }],
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={quotes}>
        <SelectCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText(SUBSTITUTED)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });

  it('RankingCell 셀 문구의 인용 토큰을 치환한다', () => {
    const cell = {
      id: 'c-ranking',
      type: 'ranking',
      content: CONTENT,
      rankingOptions: [{ id: 'o1', label: '보기1', value: '1' }],
      rankingConfig: { positions: 1 },
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={quotes}>
        <RankingCell cell={cell} cellResponse={[]} onUpdateValue={vi.fn()} questionId="q1" />
      </ContactAttrsProvider>,
    );

    expect(screen.getByText(SUBSTITUTED)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
  });
});

/**
 * 최종 리뷰 I2 — 표 셀 prefill 은 인용값을 저장하지 않는다.
 *
 * defaultValueTemplate 치환 결과는 onUpdateValue 로 응답에 저장된다
 * (questionResponses → response_answers → 엑셀/SPSS export). 응답 인용은 저장되지 않는
 * 파생값이 불변식이고, piiEncrypted 는 질문 단위라 표 셀 답변은 암호화 대상이 아니다 —
 * 인용을 허용하면 암호화 단답형의 원문이 평문 셀 답변으로 새는 경로가 열린다.
 */
describe('표 input 셀 prefill — 인용 채널 제외', () => {
  afterEach(cleanup);

  it('prefill 템플릿의 인용 토큰은 치환되지 않고 응답에도 저장되지 않는다', () => {
    const onUpdateValue = vi.fn();
    const cell = {
      id: 'c-prefill-quote',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{{연락처}}}',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{}} quotes={{ 연락처: '010-1234-5678' }}>
        <InputCell
          cell={cell}
          cellResponse=""
          onUpdateValue={onUpdateValue}
          questionId="q1"
        />
      </ContactAttrsProvider>,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(onUpdateValue).not.toHaveBeenCalledWith('010-1234-5678');
  });

  it('근접 케이스: 컨택 attrs prefill 은 그대로 동작한다', () => {
    const onUpdateValue = vi.fn();
    const cell = {
      id: 'c-prefill-attrs',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{회사}}',
    } as unknown as TableCell;

    render(
      <ContactAttrsProvider attrs={{ 회사: '메가리서치' }} quotes={{ 연락처: '010-1234-5678' }}>
        <InputCell
          cell={cell}
          cellResponse=""
          onUpdateValue={onUpdateValue}
          questionId="q1"
        />
      </ContactAttrsProvider>,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('메가리서치');
    expect(onUpdateValue).toHaveBeenCalledWith('메가리서치');
  });
});
