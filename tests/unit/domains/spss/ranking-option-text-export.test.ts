import { describe, expect, it } from 'vitest';

import { buildDataRows, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { buildLabel } from '@/lib/spss/variable-meta';
import { row2Label } from '@/lib/analytics/raw-workbook';
import type { Question, SurveySubmission } from '@/types/survey';

function makeSubmission(questionResponses: Record<string, unknown>): SurveySubmission {
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

// ────────────────────────────────────────────────────────────
// standalone(Case 1/2, 비그룹) ranking — allowTextInput 옵션 텍스트 변수
// ────────────────────────────────────────────────────────────

// Case 1: 수동 옵션 중 하나가 allowTextInput
const standaloneQuestion = {
  id: 'q1',
  type: 'ranking',
  title: '선호 브랜드',
  required: false,
  order: 1,
  questionCode: 'Q1',
  rankingConfig: { positions: 2, optionsSource: 'manual' },
  options: [
    { id: 'o1', label: '기타 브랜드', value: 'o1', spssNumericCode: 1, allowTextInput: true },
    { id: 'o2', label: '브랜드B', value: 'o2', spssNumericCode: 2 },
  ],
} as unknown as Question;

// allowTextInput 옵션이 없는 비교군
const standaloneNoTextQuestion = {
  ...standaloneQuestion,
  id: 'q1b',
  questionCode: 'Q1B',
  options: [
    { id: 'o1', label: '브랜드A', value: 'o1', spssNumericCode: 1 },
    { id: 'o2', label: '브랜드B', value: 'o2', spssNumericCode: 2 },
  ],
} as unknown as Question;

describe('standalone ranking — allowTextInput 옵션 텍스트 변수 생성', () => {
  it('resolved 옵션 중 allowTextInput 이 하나라도 있으면 순위 슬롯마다 _rk{k}_text 변수를 생성한다', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('Q1_rk1_text');
    expect(names).toContain('Q1_rk2_text');
  });

  it('새 변수의 type은 ranking-option-text, optionLabel은 "{k}순위 상세 기재"이다', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const col1 = cols.find((c) => c.spssVarName === 'Q1_rk1_text');
    expect(col1?.type).toBe('ranking-option-text');
    expect(col1?.optionLabel).toBe('1순위 상세 기재');
    expect(col1?.rankIndex).toBe(1);
  });

  it('allowTextInput 옵션이 없으면 _text 변수를 생성하지 않는다', () => {
    const cols = generateSPSSColumns([standaloneNoTextQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names.some((n) => n.endsWith('_text'))).toBe(false);
  });
});

describe('standalone ranking — buildDataRows 값 매핑', () => {
  it('해당 순위에 allowTextInput 옵션 선택 시 optionText를 추출한다', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const sub = makeSubmission({
      q1: [{ rank: 1, optionValue: 'o1', optionText: '나이키' }],
    });
    const rows = buildDataRows(cols, [standaloneQuestion], [sub]);
    const row = rows[0]!;
    const idx = cols.findIndex((c) => c.spssVarName === 'Q1_rk1_text');
    expect(row[idx]).toBe('나이키');
  });

  it('해당 순위에 응답이 없으면 null', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const sub = makeSubmission({ q1: [] });
    const rows = buildDataRows(cols, [standaloneQuestion], [sub]);
    const row = rows[0]!;
    const idx = cols.findIndex((c) => c.spssVarName === 'Q1_rk1_text');
    expect(row[idx]).toBeNull();
  });

  it('_etc(allowOtherOption) 컬럼과 독립적으로 공존한다', () => {
    const withBoth = {
      ...standaloneQuestion,
      id: 'q1c',
      questionCode: 'Q1C',
      allowOtherOption: true,
    } as unknown as Question;
    const cols = generateSPSSColumns([withBoth]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('Q1C_rk1_text');
    // allowOtherOption 은 기존 규칙에 따라 별도 옵션 코드로 _etc 변수를 만든다
    expect(names.some((n) => n.startsWith('Q1C_rk1_') && n.endsWith('_etc'))).toBe(true);

    const sub = makeSubmission({
      q1c: [{ rank: 1, optionValue: '__other__', otherText: '기타응답' }],
    });
    const rows = buildDataRows(cols, [withBoth], [sub]);
    const row = rows[0]!;
    const textIdx = cols.findIndex((c) => c.spssVarName === 'Q1C_rk1_text');
    const etcIdx = cols.findIndex((c) => c.spssVarName.startsWith('Q1C_rk1_') && c.spssVarName.endsWith('_etc'));
    // __other__ 선택이므로 option-text 는 null, other-text 는 값을 가진다
    expect(row[textIdx]).toBeNull();
    expect(row[etcIdx]).toBe('기타응답');
  });
});

describe('standalone ranking — row2Label / buildLabel', () => {
  it('row2Label 은 optionLabel("1순위 상세 기재")을 반환한다', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const col1 = cols.find((c) => c.spssVarName === 'Q1_rk1_text');
    expect(col1).toBeDefined();
    expect(row2Label(col1!)).toBe('1순위 상세 기재');
  });

  it('buildLabel 은 "질문제목 - 1순위 상세 기재" 형식이다', () => {
    const cols = generateSPSSColumns([standaloneQuestion]);
    const col1 = cols.find((c) => c.spssVarName === 'Q1_rk1_text');
    expect(col1).toBeDefined();
    expect(buildLabel(col1!)).toBe('선호 브랜드 - 1순위 상세 기재');
  });
});

// ────────────────────────────────────────────────────────────
// grouped ranking — allowTextInput 옵션 텍스트 변수
// ────────────────────────────────────────────────────────────

const groupedQuestion = {
  id: 'qg',
  type: 'ranking',
  title: '보유 장비',
  required: false,
  order: 1,
  questionCode: 'Q9',
  rankingConfig: { positions: 2, optionsSource: 'table' },
  choiceGroups: [
    { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '보유 장비' },
    { id: 'rg2', groupKey: 'rnk2', type: 'ranking', label: '' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: '노트북', type: 'ranking_opt', choiceGroupId: 'rg1', spssNumericCode: 5, allowTextInput: true },
        { id: 'cellB', content: '데스크탑', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'cellC', content: '태블릿', type: 'ranking_opt', choiceGroupId: 'rg2' },
        { id: 'cellD', content: '스마트폰', type: 'ranking_opt', choiceGroupId: 'rg2' },
      ],
    },
  ],
} as unknown as Question;

describe('grouped ranking — allowTextInput 옵션 텍스트 변수 생성', () => {
  it('rnk1 그룹은 멤버 중 allowTextInput 이 있으므로 _rk{k}_text 를 생성한다', () => {
    const cols = generateSPSSColumns([groupedQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('Q9_rnk1_rk1_text');
    expect(names).toContain('Q9_rnk1_rk2_text');
  });

  it('rnk2 그룹은 allowTextInput 멤버가 없으므로 _text 를 생성하지 않는다', () => {
    const cols = generateSPSSColumns([groupedQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).not.toContain('Q9_rnk2_rk1_text');
    expect(names).not.toContain('Q9_rnk2_rk2_text');
  });

  it('그룹 라벨이 있으면 optionLabel은 "그룹라벨 - k순위 상세 기재"이다', () => {
    const cols = generateSPSSColumns([groupedQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1_text');
    expect(col?.optionLabel).toBe('보유 장비 - 1순위 상세 기재');
    expect(col?.type).toBe('ranking-option-text');
    expect(col?.choiceGroupKey).toBe('rnk1');
  });

  it('그룹 라벨이 없으면(빈 문자열) optionLabel에 접두가 붙지 않는다', () => {
    // rg2 는 allowTextInput 멤버가 없어 텍스트 변수가 없으므로, 별도 픽스처로 라벨 없는 텍스트 그룹을 만든다
    const noLabelTextGroup = {
      ...groupedQuestion,
      id: 'qg2',
      questionCode: 'Q10',
      choiceGroups: [
        { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'cellA', content: '노트북', type: 'ranking_opt', choiceGroupId: 'rg1', allowTextInput: true },
          ],
        },
      ],
    } as unknown as Question;
    const cols = generateSPSSColumns([noLabelTextGroup]);
    const col = cols.find((c) => c.spssVarName === 'Q10_rnk1_rk1_text');
    expect(col?.optionLabel).toBe('1순위 상세 기재');
  });
});

describe('grouped ranking — buildDataRows 값 매핑', () => {
  it('그룹별 응답 맵에서 해당 그룹/순위의 optionText를 추출한다', () => {
    const cols = generateSPSSColumns([groupedQuestion]);
    const sub = makeSubmission({
      qg: { rnk1: [{ rank: 1, optionValue: 'cellA', optionText: '삼성 노트북' }] },
    });
    const rows = buildDataRows(cols, [groupedQuestion], [sub]);
    const row = rows[0]!;
    const idx = cols.findIndex((c) => c.spssVarName === 'Q9_rnk1_rk1_text');
    expect(row[idx]).toBe('삼성 노트북');
  });
});

// ────────────────────────────────────────────────────────────
// 표 안 ranking 셀(Case 3) — allowTextInput 옵션 텍스트 변수
// ────────────────────────────────────────────────────────────

const tableRankingQuestion = {
  id: 'qt',
  type: 'table',
  title: '항목별 순위',
  required: false,
  order: 1,
  questionCode: 'QT',
  tableColumns: [{ id: 'c1', label: '열1', columnCode: 'col1' }],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      rowCode: 'row1',
      cells: [
        {
          id: 'cellR',
          type: 'ranking',
          cellCode: 'QT_row1_col1',
          rankingConfig: { positions: 2 },
          rankingOptions: [
            { id: 'ro1', value: 'ro1', label: '옵션1', spssNumericCode: 1, allowTextInput: true },
            { id: 'ro2', value: 'ro2', label: '옵션2', spssNumericCode: 2 },
          ],
        },
      ],
    },
  ],
} as unknown as Question;

const tableRankingNoTextQuestion = {
  ...tableRankingQuestion,
  id: 'qt2',
  questionCode: 'QT2',
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      rowCode: 'row1',
      cells: [
        {
          id: 'cellR',
          type: 'ranking',
          cellCode: 'QT2_row1_col1',
          rankingConfig: { positions: 2 },
          rankingOptions: [
            { id: 'ro1', value: 'ro1', label: '옵션1', spssNumericCode: 1 },
          ],
        },
      ],
    },
  ],
} as unknown as Question;

describe('표 안 ranking 셀 — allowTextInput 옵션 텍스트 변수 생성', () => {
  it('cell.rankingOptions 중 allowTextInput 이 있으면 {rankVarName}_text 를 생성한다', () => {
    const cols = generateSPSSColumns([tableRankingQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('QT_row1_col1_rk1_text');
    expect(names).toContain('QT_row1_col1_rk2_text');
  });

  it('새 변수의 type은 table-cell-ranking-option-text, optionLabel은 "{k}순위 상세 기재"이다', () => {
    const cols = generateSPSSColumns([tableRankingQuestion]);
    const col1 = cols.find((c) => c.spssVarName === 'QT_row1_col1_rk1_text');
    expect(col1?.type).toBe('table-cell-ranking-option-text');
    expect(col1?.optionLabel).toBe('1순위 상세 기재');
    expect(col1?.tableCellId).toBe('cellR');
    expect(col1?.rankIndex).toBe(1);
  });

  it('allowTextInput 옵션이 없으면 _text 변수를 생성하지 않는다', () => {
    const cols = generateSPSSColumns([tableRankingNoTextQuestion]);
    const names = cols.map((c) => c.spssVarName);
    expect(names.some((n) => n.endsWith('_text'))).toBe(false);
  });
});

describe('표 안 ranking 셀 — buildDataRows 값 매핑', () => {
  it('테이블 응답 객체에서 셀 id로 해당 순위의 optionText를 추출한다', () => {
    const cols = generateSPSSColumns([tableRankingQuestion]);
    const sub = makeSubmission({
      qt: { cellR: [{ rank: 1, optionValue: 'ro1', optionText: '상세내용' }] },
    });
    const rows = buildDataRows(cols, [tableRankingQuestion], [sub]);
    const row = rows[0]!;
    const idx = cols.findIndex((c) => c.spssVarName === 'QT_row1_col1_rk1_text');
    expect(row[idx]).toBe('상세내용');
  });

  it('응답 없음 → null', () => {
    const cols = generateSPSSColumns([tableRankingQuestion]);
    const sub = makeSubmission({ qt: null });
    const rows = buildDataRows(cols, [tableRankingQuestion], [sub]);
    const row = rows[0]!;
    const idx = cols.findIndex((c) => c.spssVarName === 'QT_row1_col1_rk1_text');
    expect(row[idx]).toBeNull();
  });
});
