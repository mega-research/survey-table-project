/**
 * 보기-소스 표(ChoiceTableResponse) 안의 단답형 셀.
 *
 * 이 렌더러는 여태 choice_opt 셀만 인터랙티브로 만들고 나머지는 정적 미리보기로 흘려보냈다.
 * 그래서 표 안에 놓은 input 셀이 보이기는 하는데 타이핑이 안 됐다.
 * 값은 새 저장소를 만들지 않고 기존 __optTexts__ 사이드카에 **셀 id** 를 키로 넣는다 —
 * 그 맵은 이미 그룹 보기 셀도 cell.id 로 저장하고, 같은 표 안에서 id 는 유일하다.
 *
 * 행 표시조건도 함께 본다. 데스크톱 경로는 tableRowsData 를 가공 없이 넘기고 있어
 * 행·열 조건이 통째로 무시됐다(조건 평가는 모바일 분기에서만 돌았다).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import { useSurveyResponseStore } from '@/stores/survey-response-store';
import type { Question } from '@/types/survey';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  useSurveyResponseStore.setState({ optionTexts: {} });
});

const ETC_NOW_CELL = 'r2c3';
const DETAIL_CELL = 'r3c1';

/** AQ1 축소판 — 두 보기 그룹 + 마지막에 상세기재 input 행. */
function questionWithDetailRow(rowCondition = true): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '상태',
    required: true,
    order: 0,
    choiceGroups: [
      { id: 'grpPast', type: 'radio', label: '2025년 12월 기준', groupKey: 'rad1' },
      { id: 'grpNow', type: 'radio', label: '현재', groupKey: 'rad2' },
    ],
    tableColumns: [
      { id: 'c1', label: '내용' },
      { id: 'c2', label: '2025년 12월 기준' },
      { id: 'c3', label: '현재' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'r1c1', type: 'text', content: '① 취업' },
          { id: 'r1c2', type: 'choice_opt', content: '', choiceGroupId: 'grpPast' },
          { id: 'r1c3', type: 'choice_opt', content: '', choiceGroupId: 'grpNow' },
        ],
      },
      {
        id: 'r2',
        label: '',
        cells: [
          { id: 'r2c1', type: 'text', content: '② 기타' },
          { id: 'r2c2', type: 'choice_opt', content: '', choiceGroupId: 'grpPast' },
          { id: ETC_NOW_CELL, type: 'choice_opt', content: '', choiceGroupId: 'grpNow' },
        ],
      },
      {
        id: 'r3',
        label: '',
        ...(rowCondition
          ? {
              displayCondition: {
                logicType: 'AND' as const,
                conditions: [
                  {
                    id: 'cond1',
                    name: '조건 1',
                    enabled: true,
                    logicType: 'AND' as const,
                    conditionType: 'value-match' as const,
                    requiredValues: [ETC_NOW_CELL],
                    sourceQuestionId: 'q1',
                  },
                ],
              },
            }
          : {}),
        cells: [
          {
            id: DETAIL_CELL,
            type: 'input',
            content: '',
            colspan: 3,
            inputType: 'text',
            placeholder: '상세기재',
          },
          { id: 'r3c2', type: 'input', content: '', isHidden: true },
          { id: 'r3c3', type: 'input', content: '', isHidden: true },
        ],
      },
    ],
  } as Question;
}

function renderTable(question: Question, value: unknown) {
  return render(
    <ChoiceTableResponse
      question={question}
      value={value}
      onChange={() => {}}
      allResponses={{ q1: value }}
      allQuestions={[question]}
    />,
  );
}

describe('보기-소스 표의 단답형 셀', () => {
  it('표 안의 input 셀이 편집 가능한 입력칸으로 그려진다', async () => {
    renderTable(questionWithDetailRow(false), { rad2: ETC_NOW_CELL });

    const input = screen.getByPlaceholderText('상세기재');
    await userEvent.type(input, '창업 준비 중');

    expect(input).toHaveValue('창업 준비 중');
  });

  it('입력값은 __optTexts__ 사이드카에 셀 id 로 저장된다', async () => {
    renderTable(questionWithDetailRow(false), { rad2: ETC_NOW_CELL });

    await userEvent.type(screen.getByPlaceholderText('상세기재'), '창업 준비');

    expect(useSurveyResponseStore.getState().optionTexts['q1']?.[DETAIL_CELL]).toBe('창업 준비');
  });

  it('숨겨진 셀은 입력칸을 만들지 않는다', () => {
    renderTable(questionWithDetailRow(false), { rad2: ETC_NOW_CELL });
    expect(screen.getAllByPlaceholderText('상세기재')).toHaveLength(1);
  });

  it('행 표시조건이 충족되면 그 행이 그려진다', () => {
    renderTable(questionWithDetailRow(), { rad2: ETC_NOW_CELL });
    expect(screen.queryByPlaceholderText('상세기재')).toBeInTheDocument();
  });

  it('행 표시조건이 충족되지 않으면 그 행이 데스크톱에서도 사라진다', () => {
    renderTable(questionWithDetailRow(), { rad2: 'r1c3' });
    expect(screen.queryByPlaceholderText('상세기재')).not.toBeInTheDocument();
  });
});

describe('보기-소스 표 단답형 셀의 폭', () => {
  it('입력칸이 셀 폭을 채운다', () => {
    renderTable(questionWithDetailRow(false), { rad2: ETC_NOW_CELL });
    const input = screen.getByPlaceholderText('상세기재');
    // 표 셀은 flex flex-col items-start 라 래퍼가 내용 폭으로 쪼그라든다.
    // 래퍼와 입력 둘 다 폭을 채워야 colspan 걸린 상세기재 행이 한 줄로 펴진다.
    expect(input.className).toContain('w-full');
    expect(input.parentElement?.className).toContain('w-full');
  });
});

describe('보기-소스 표의 단답형 셀 — 보기 옵션 선택 게이팅', () => {
  /** 기타 행에 ② 기타(현재) 보기가 선택되면 열리는 input 셀 — 행 조건 없이 셀 게이팅만. */
  function questionWithGatedCell(): Question {
    const q = questionWithDetailRow(false);
    const row3 = q.tableRowsData![2]!;
    row3.cells[0] = {
      ...row3.cells[0]!,
      enabledWhen: { kind: 'choice-selected', controllerCellId: ETC_NOW_CELL },
    };
    return q;
  }

  it('컨트롤러 보기가 선택되지 않으면 입력칸 대신 "-" 만 보인다', () => {
    renderTable(questionWithGatedCell(), { rad2: 'r1c3' });
    expect(screen.queryByPlaceholderText('상세기재')).toBeNull();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  it('컨트롤러 보기가 선택되면 입력칸이 보인다', () => {
    renderTable(questionWithGatedCell(), { rad2: ETC_NOW_CELL });
    expect(screen.getByPlaceholderText('상세기재')).toBeInTheDocument();
  });

  it('해제되면 남아 있던 값을 지운다', () => {
    useSurveyResponseStore.setState({ optionTexts: { q1: { [DETAIL_CELL]: '적은 내용' } } });
    renderTable(questionWithGatedCell(), { rad2: 'r1c3' });
    expect(useSurveyResponseStore.getState().optionTexts['q1']?.[DETAIL_CELL] ?? '').toBe('');
  });
});
