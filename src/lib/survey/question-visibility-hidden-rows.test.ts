import { describe, expect, it } from 'vitest';

import { OPT_TEXTS_KEY } from '@/lib/option-text-read';
import { CHOICE_GROUPS_KEY } from '@/lib/survey/choice-selection';
import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import type { Question, QuestionConditionGroup } from '@/types/survey';

// 표 행 표시조건 — 앞 문항을 바꿔 행이 숨으면 그 행의 답도 문항처럼 그 순간 지운다.

const showWhen = (source: string, values: string[]): QuestionConditionGroup => ({
  logicType: 'AND',
  conditions: [
    {
      id: `c-${source}-${values.join('-')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId: source,
      requiredValues: values,
    },
  ],
});

const source: Question = {
  id: 'b3',
  type: 'checkbox',
  title: '팀 전공 구성',
  required: true,
  order: 0,
  options: [
    { id: 'o1', label: '모두 ICT', value: '01' },
    { id: 'o2', label: '모두 해운물류', value: '02' },
  ],
};

const table: Question = {
  id: 't',
  type: 'table',
  title: '전공별 역량',
  required: false,
  order: 1,
  tableColumns: [
    { id: 'col-label', label: '항목' },
    { id: 'col-a', label: '①' },
    { id: 'col-b', label: '②' },
    { id: 'col-memo', label: '메모' },
  ],
  tableRowsData: [
    {
      id: 'r-ict',
      label: 'ICT',
      displayCondition: showWhen('b3', ['01']),
      cells: [
        { id: 'ict-label', type: 'text', content: 'ICT' },
        { id: 'ict-a', type: 'choice_opt', content: '①', choiceGroupId: 'g-ict' },
        { id: 'ict-b', type: 'choice_opt', content: '②', choiceGroupId: 'g-ict' },
        { id: 'ict-memo', type: 'input', content: '' },
      ],
    },
    {
      id: 'r-sea',
      label: '해운물류',
      displayCondition: showWhen('b3', ['02']),
      cells: [
        { id: 'sea-label', type: 'text', content: '해운물류' },
        { id: 'sea-a', type: 'choice_opt', content: '①', choiceGroupId: 'g-sea' },
        { id: 'sea-b', type: 'choice_opt', content: '②', choiceGroupId: 'g-sea' },
        { id: 'sea-memo', type: 'input', content: '' },
      ],
    },
    {
      id: 'r-always',
      label: '공통',
      cells: [
        { id: 'all-label', type: 'text', content: '공통' },
        { id: 'all-a', type: 'choice_opt', content: '①', choiceGroupId: 'g-all' },
        { id: 'all-b', type: 'choice_opt', content: '②', choiceGroupId: 'g-all' },
        { id: 'all-memo', type: 'input', content: '' },
      ],
    },
  ],
  choiceGroups: [
    { id: 'g-ict', type: 'radio', label: 'ICT', groupKey: 'rad1' },
    { id: 'g-sea', type: 'checkbox', label: '해운물류', groupKey: 'rad2' },
    { id: 'g-all', type: 'radio', label: '공통', groupKey: 'rad3' },
  ],
};

const tableAnswer = {
  'ict-memo': 'ICT 메모',
  'sea-memo': '해운 메모',
  'all-memo': '공통 메모',
  [CHOICE_GROUPS_KEY]: { rad1: 'ict-a', rad2: ['sea-a', 'sea-b'], rad3: 'all-b' },
};

describe('stripHiddenQuestionValues — 숨은 표 행', () => {
  it('숨은 행의 셀 값과 보기 그룹 선택을 지우고 보이는 행은 남긴다', () => {
    const out = stripHiddenQuestionValues([source, table], { b3: ['01'], t: tableAnswer });
    expect(out['t']).toEqual({
      'ict-memo': 'ICT 메모',
      'all-memo': '공통 메모',
      [CHOICE_GROUPS_KEY]: { rad1: 'ict-a', rad3: 'all-b' },
    });
  });

  it('지운 뒤 앞 문항을 되돌려도 값은 살아나지 않는다', () => {
    const hidden = stripHiddenQuestionValues([source, table], { b3: ['01'], t: tableAnswer });
    const back = stripHiddenQuestionValues([source, table], { ...hidden, b3: ['01', '02'] });
    expect(back['t']).toEqual(hidden['t']);
  });

  it('숨은 행의 기타 상세기재 사이드카도 지운다', () => {
    const out = stripHiddenQuestionValues([source, table], {
      b3: ['02'],
      t: tableAnswer,
      [OPT_TEXTS_KEY]: { t: { 'ict-b': 'ICT 상세', 'sea-a': '해운 상세' }, b3: { o1: 'x' } },
    });
    expect(out[OPT_TEXTS_KEY]).toEqual({ t: { 'sea-a': '해운 상세' }, b3: { o1: 'x' } });
  });

  it('숨은 행이 없으면 입력 참조를 그대로 돌려준다', () => {
    const responses = { b3: ['01', '02'], t: tableAnswer };
    expect(stripHiddenQuestionValues([source, table], responses)).toBe(responses);
  });

  it('숨은 행 값을 조건으로 쓰던 하류 문항도 연쇄로 지운다', () => {
    const downstream: Question = {
      id: 'follow',
      type: 'text',
      title: '해운 행에서 ② 를 고른 사람만',
      required: false,
      order: 2,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c-follow',
            enabled: true,
            logicType: 'AND',
            conditionType: 'value-match',
            sourceQuestionId: 't',
            requiredValues: ['sea-b'],
          },
        ],
      },
    };
    const out = stripHiddenQuestionValues([source, table, downstream], {
      b3: ['01'],
      t: tableAnswer,
      follow: '하류 답',
    });
    expect(out).not.toHaveProperty('follow');
  });
});
