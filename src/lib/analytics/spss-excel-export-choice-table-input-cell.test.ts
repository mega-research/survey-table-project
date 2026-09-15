import { describe, expect, it } from 'vitest';

import { buildDataRows, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { Question, SurveySubmission } from '@/types/survey';

/**
 * 보기-소스 표(choice_opt)로 그려지는 radio 문항 안에 놓인 단답형 셀의 내보내기.
 *
 * 값은 __optTexts__ 사이드카에 셀 id 로 저장되므로 추출은 option-text 경로를 쓰지만,
 * 변수명·라벨은 표 문항의 셀 규약(cellCode / exportLabel)을 따른다 — `_text` 접미를
 * 붙이지 않는다. 담당자가 코딩북에 이미 적어 둔 변수명이 그것이기 때문이다.
 */
const question = {
  id: 'q1',
  type: 'radio',
  title: 'AQ1. 상태',
  required: true,
  order: 1,
  questionCode: 'AQ1',
  choiceGroups: [
    { id: 'gPast', groupKey: 'rad1', type: 'radio', label: '2025년 12월 기준' },
    { id: 'gNow', groupKey: 'rad2', type: 'radio', label: '현재' },
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
        { id: 'r1c1', type: 'text', content: '① 기타' },
        { id: 'r1c2', type: 'choice_opt', content: '', choiceGroupId: 'gPast', spssNumericCode: 1 },
        { id: 'r1c3', type: 'choice_opt', content: '', choiceGroupId: 'gNow', spssNumericCode: 1 },
      ],
    },
    {
      id: 'r2',
      label: '',
      cells: [
        {
          id: 'detail',
          type: 'input',
          content: '',
          colspan: 3,
          cellCode: 'AQ1_r11_c1',
          exportLabel: 'AQ1_기타_텍스트',
          inputType: 'text',
        },
        { id: 'detailHiddenA', type: 'input', content: '', isHidden: true },
        { id: 'detailHiddenB', type: 'input', content: '', isHidden: true },
      ],
    },
  ],
} as unknown as Question;

function submission(questionResponses: Record<string, unknown>): SurveySubmission {
  return {
    id: 'sub-1',
    surveyId: 'sv-1',
    startedAt: new Date('2025-01-01T00:00:00Z'),
    completedAt: new Date('2025-01-01T00:01:00Z'),
    isCompleted: true,
    currentGroupOrder: 0,
    questionResponses,
    updatedAt: new Date('2025-01-01T00:01:00Z'),
  } as unknown as SurveySubmission;
}

describe('보기-소스 표 안의 단답형 셀 export', () => {
  it('셀코드를 변수명으로 하는 변수가 생긴다 — _text 접미를 붙이지 않는다', () => {
    const cols = generateSPSSColumns([question]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('AQ1_r11_c1');
    expect(names.some((n) => n.endsWith('_text'))).toBe(false);
  });

  it('보기 그룹 변수는 그대로 남는다', () => {
    const names = generateSPSSColumns([question]).map((c) => c.spssVarName);
    expect(names).toContain('AQ1_rad1');
    expect(names).toContain('AQ1_rad2');
  });

  it('병합으로 가려진 셀은 변수를 만들지 않는다', () => {
    const cols = generateSPSSColumns([question]);
    expect(cols.filter((c) => c.questionId === 'q1' && c.type === 'option-text')).toHaveLength(1);
  });

  it('사이드카에 저장된 값을 그 변수로 내보낸다', () => {
    const cols = generateSPSSColumns([question]);
    const idx = cols.findIndex((c) => c.spssVarName === 'AQ1_r11_c1');
    const rows = buildDataRows(cols, [question], [
      submission({ q1: { rad2: 'r1c3' }, __optTexts__: { q1: { detail: '창업 준비 중' } } }),
    ]);
    expect(rows[0]![idx]).toBe('창업 준비 중');
  });
});
