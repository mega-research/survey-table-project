/**
 * 보기-소스 표 안의 선택형 셀(radio/checkbox/select).
 *
 * 이 표를 그리는 문항은 `table` 이 아니라 `radio`/`checkbox` 라, 렌더러가 `choice_opt` 와
 * `input` 셀만 인터랙티브로 만들고 나머지는 정적 미리보기로 흘려보냈다. 화면엔 라디오가
 * 보이는데 클릭해도 아무 데도 저장되지 않았고, 「필수 응답 셀」로 지정해도 제출이 막히지
 * 않았다 — 실사 중이던 AQ1 병역특례 여부가 그렇게 응답을 한 건도 못 받았다.
 *
 * 값은 단답형 셀과 같은 `__optTexts__` 사이드카에 셀 id 로 넣는다.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';
import { collectNumericIssues } from '@/lib/survey/numeric-validation';
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

const QID = 'q-aq1';
const RADIO_CELL = 'cell-veteran';

/** AQ1 축소판 — 보기 행 하나 + 그 아래 선택형 셀 행. */
function question(required = true): Question {
  return {
    id: QID,
    type: 'radio',
    title: '현재 상태',
    required: false,
    order: 0,
    choiceGroups: [{ id: 'g1', groupKey: 'rad1', label: '현재', type: 'radio' }],
    tableColumns: [
      { id: 'c0', label: '항목', width: 200 },
      { id: 'c1', label: '현재', width: 200 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'r1c0', type: 'text', content: '⑨ 군복무' },
          { id: 'r1c1', type: 'choice_opt', content: '', choiceGroupId: 'g1' },
        ],
      },
      {
        id: 'r2',
        cells: [
          { id: 'r2c0', type: 'text', content: '병역특례 여부' },
          {
            id: RADIO_CELL,
            type: 'radio',
            content: '',
            required,
            radioOptions: [
              { id: 'opt-yes', value: '1', label: '① 있음' },
              { id: 'opt-no', value: '2', label: '② 없음' },
            ],
          },
        ],
      },
    ],
  } as unknown as Question;
}

describe('보기-소스 표 안의 선택형 셀', () => {
  it('클릭하면 사이드카에 셀 id 로 보기 값이 저장된다', async () => {
    const user = userEvent.setup();
    render(<ChoiceTableResponse question={question()} value={null} onChange={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /① 있음/ }));

    expect(useSurveyResponseStore.getState().optionTexts[QID]?.[RADIO_CELL]).toBe('1');
  });

  it('다시 고르면 값이 바뀐다', async () => {
    const user = userEvent.setup();
    render(<ChoiceTableResponse question={question()} value={null} onChange={() => {}} />);

    await user.click(screen.getByRole('radio', { name: /① 있음/ }));
    await user.click(screen.getByRole('radio', { name: /② 없음/ }));

    expect(useSurveyResponseStore.getState().optionTexts[QID]?.[RADIO_CELL]).toBe('2');
  });

});

describe('선택형 셀의 필수 응답', () => {
  const ctx = (texts: Record<string, string>) => ({
    allResponses: {},
    allQuestions: [],
    optionTexts: texts,
  });

  it('필수인데 비어 있으면 차단 이슈를 낸다', () => {
    const issues = collectNumericIssues(question(true), { rad1: 'r1c1' }, ctx({}));
    expect(issues.map((i) => i.kind)).toContain('required-detail');
  });

  it('고르면 통과한다', () => {
    const issues = collectNumericIssues(
      question(true),
      { rad1: 'r1c1' },
      ctx({ [RADIO_CELL]: '2' }),
    );
    expect(issues).toEqual([]);
  });

  it('필수가 아니면 비어 있어도 통과한다', () => {
    const issues = collectNumericIssues(question(false), { rad1: 'r1c1' }, ctx({}));
    expect(issues).toEqual([]);
  });
});
