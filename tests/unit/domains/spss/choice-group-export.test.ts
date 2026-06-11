import { describe, expect, it } from 'vitest';

import { buildDataRows, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { generateMrsetsSyntax } from '@/lib/spss/mrsets-syntax';
import { buildValueLabels } from '@/lib/spss/sav-builder';
import { buildLabel, resolveMeasure, resolveVarType } from '@/lib/spss/variable-meta';
import type { Question, SurveySubmission } from '@/types/survey';
import { VariableMeasure, VariableType } from 'sav-writer';

// radio choiceGroups 가 있는 질문 픽스처
const grouped = {
  id: 'q1',
  type: 'radio',
  title: 'TV 질문',
  required: false,
  order: 1,
  questionCode: 'Q5',
  choiceGroups: [
    { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' },
    { id: 'g2', groupKey: 'rad2', type: 'radio', label: '구매의향' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 1 },
        { id: 'cellB', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 2 },
        { id: 'cellC', content: '있음', type: 'choice_opt', choiceGroupId: 'g2', spssNumericCode: 1 },
        { id: 'cellD', content: '기타', type: 'choice_opt' },
      ],
    },
  ],
} as unknown as Question;

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

describe('radio 옵션 그룹 export — generateSPSSColumns', () => {
  it('그룹별 1변수를 질문코드_groupKey로 생성하고 default 그룹은 질문코드 그대로다', () => {
    const cols = generateSPSSColumns([grouped]);
    const names = cols.map((c) => c.spssVarName);
    expect(names).toContain('Q5_rad1');
    expect(names).toContain('Q5_rad2');
    expect(names).toContain('Q5');
  });

  it('그룹 변수는 cellValueMap으로 멤버 셀 응답값을 매핑한다', () => {
    const cols = generateSPSSColumns([grouped]);
    const rad1 = cols.find((c) => c.spssVarName === 'Q5_rad1');
    expect(rad1?.type).toBe('choice-group');
    expect(rad1?.choiceGroupCellValueMap).toEqual({ cellA: 1, cellB: 2 });
  });

  it('value labels는 멤버 셀 라벨을 담는다', () => {
    const cols = generateSPSSColumns([grouped]);
    const rad1 = cols.find((c) => c.spssVarName === 'Q5_rad1');
    expect(rad1?.choiceGroupValueLabels).toEqual([
      { value: 1, label: 'UHD' },
      { value: 2, label: 'FHD' },
    ]);
  });

  it('그룹 라벨이 변수 라벨 후보(optionLabel)로 전달된다', () => {
    const cols = generateSPSSColumns([grouped]);
    const rad1 = cols.find((c) => c.spssVarName === 'Q5_rad1');
    expect(rad1?.optionLabel).toContain('TV보유');
  });

  it('choiceGroups 없는 radio 질문은 기존 single 1변수 그대로다 — 하위호환', () => {
    const plain = { ...grouped, choiceGroups: undefined, id: 'q2', questionCode: 'Q6' } as unknown as Question;
    const cols = generateSPSSColumns([plain]);
    expect(cols.filter((c) => c.questionId === 'q2').map((c) => c.type)).toEqual(['single']);
  });

});

describe('radio 옵션 그룹 export — allowTextInput 사이드카 텍스트 변수', () => {
  // allowTextInput 이 있는 셀을 포함하는 픽스처
  const groupedWithText = {
    id: 'q_txt',
    type: 'radio',
    title: 'TV 텍스트 질문',
    required: false,
    order: 1,
    questionCode: 'QT',
    choiceGroups: [
      { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [
          { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 1, allowTextInput: true },
          { id: 'cellB', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 2 },
        ],
      },
    ],
  } as unknown as Question;

  it('allowTextInput 멤버 셀마다 option-text 사이드카 변수를 생성한다', () => {
    const cols = generateSPSSColumns([groupedWithText]);
    const names = cols.map((c) => c.spssVarName);
    // 그룹 주변수
    expect(names).toContain('QT_rad1');
    // cellA 에 allowTextInput=true → 사이드카 변수
    expect(names).toContain('QT_rad1_1_text');
    // cellB 는 allowTextInput 없음 → 사이드카 없음
    expect(names).not.toContain('QT_rad1_2_text');
  });

  it('사이드카 컬럼은 type=option-text 이고 optionId=cell.id 이다', () => {
    const cols = generateSPSSColumns([groupedWithText]);
    const sidecar = cols.find((c) => c.spssVarName === 'QT_rad1_1_text');
    expect(sidecar?.type).toBe('option-text');
    expect(sidecar?.optionId).toBe('cellA');
  });

  it('buildDataRows 에서 사이드카 옵션텍스트를 __optTexts__ 경로로 추출한다', () => {
    const cols = generateSPSSColumns([groupedWithText]);
    const sub = makeSubmission({
      q_txt: { rad1: 'cellA' },
      __optTexts__: { q_txt: { cellA: '직접입력' } },
    });
    const rows = buildDataRows(cols, [groupedWithText], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const sidecarIdx = cols.findIndex((c) => c.spssVarName === 'QT_rad1_1_text');
    expect(row[sidecarIdx]).toBe('직접입력');
  });

  it('멤버 0인 phantom 그룹에 대한 choice-group 변수는 생성되지 않는다', () => {
    // rad2 그룹은 선언됐지만 소속 셀이 없는 phantom
    const withPhantom = {
      ...grouped,
      id: 'q_phantom',
      questionCode: 'QP',
      choiceGroups: [
        { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' },
        { id: 'g_phantom', groupKey: 'rad2', type: 'radio', label: '팬텀' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            // cellA/cellB 는 g1 소속, g_phantom 에는 아무 셀도 없음
            { id: 'cellA', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 1 },
            { id: 'cellB', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 2 },
          ],
        },
      ],
    } as unknown as Question;
    const cols = generateSPSSColumns([withPhantom]);
    const names = cols.filter((c) => c.questionId === 'q_phantom').map((c) => c.spssVarName);
    // rad1 변수만 생성. rad2(phantom)는 없어야 한다.
    expect(names).toContain('QP_rad1');
    expect(names).not.toContain('QP_rad2');
  });
});

describe('radio 옵션 그룹 export — buildDataRows 응답값 변환', () => {
  it('그룹별 응답 맵에서 각 그룹 변수 값을 정확히 추출한다', () => {
    const cols = generateSPSSColumns([grouped]);
    // rad1=cellA(1), rad2 미선택, default=cellD
    const sub = makeSubmission({ q1: { rad1: 'cellA', default: 'cellD' } });
    const rows = buildDataRows(cols, [grouped], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const rad1Col = cols.findIndex((c) => c.spssVarName === 'Q5_rad1');
    const rad2Col = cols.findIndex((c) => c.spssVarName === 'Q5_rad2');
    const defCol = cols.findIndex((c) => c.spssVarName === 'Q5');

    expect(row[rad1Col]).toBe(1);    // cellA → spssNumericCode 1
    expect(row[rad2Col]).toBeNull(); // 미선택
    // default 그룹 내 cellD는 spssNumericCode 없음 → 그룹 내 1-based 순서(1)
    expect(row[defCol]).toBe(1);
  });

  it('응답 없음(null) → null 반환', () => {
    const cols = generateSPSSColumns([grouped]);
    const sub = makeSubmission({ q1: null });
    const rows = buildDataRows(cols, [grouped], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const rad1Col = cols.findIndex((c) => c.spssVarName === 'Q5_rad1');
    expect(row[rad1Col]).toBeNull();
  });

  it('레거시 문자열 응답(그룹 맵 아님) → null 안전 처리', () => {
    const cols = generateSPSSColumns([grouped]);
    const sub = makeSubmission({ q1: 'cellA' }); // 문자열은 그룹 응답 맵이 아님
    const rows = buildDataRows(cols, [grouped], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const rad1Col = cols.findIndex((c) => c.spssVarName === 'Q5_rad1');
    expect(row[rad1Col]).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// checkbox 그룹 픽스처
// ────────────────────────────────────────────────────────────

// rad1(radio) + cb1(checkbox) 혼재 질문: Q7
const mixedGroupsQuestion = {
  id: 'q7',
  type: 'radio',
  title: '구매처',
  required: false,
  order: 1,
  questionCode: 'Q7',
  choiceGroups: [
    { id: 'gr1', groupKey: 'rad1', type: 'radio', label: '보유여부' },
    { id: 'gc1', groupKey: 'cb1', type: 'checkbox', label: '구매처' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        // rad1 그룹 멤버 (radio)
        { id: 'cellR', content: '있음', type: 'choice_opt', choiceGroupId: 'gr1', spssNumericCode: 1 },
        // cb1 그룹 멤버 (checkbox)
        { id: 'cellE', content: '보기E', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 5 },
        { id: 'cellF', content: '보기F', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 7 },
      ],
    },
  ],
} as unknown as Question;

// checkbox 질문: 명시 그룹 cb1 + default 미소속 셀
const checkboxGroupQuestion = {
  id: 'q8',
  type: 'checkbox',
  title: '이용경험',
  required: false,
  order: 2,
  questionCode: 'Q8',
  choiceGroups: [
    { id: 'gc2', groupKey: 'cb2', type: 'checkbox', label: '채널' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        // gc2 소속
        { id: 'cellG', content: '온라인', type: 'choice_opt', choiceGroupId: 'gc2', spssNumericCode: 1 },
        { id: 'cellH', content: '오프라인', type: 'choice_opt', choiceGroupId: 'gc2', spssNumericCode: 2 },
        // 미소속 → default 그룹
        { id: 'cellI', content: '기타', type: 'choice_opt' },
      ],
    },
  ],
} as unknown as Question;

// 그룹 없는 순수 checkbox 질문: 하위호환 확인용
const plainCheckboxQuestion = {
  id: 'q9',
  type: 'checkbox',
  title: '매체',
  required: false,
  order: 3,
  questionCode: 'Q9',
  options: [
    { id: 'o1', label: 'TV', value: 'o1', optionCode: '1', spssNumericCode: 1 },
    { id: 'o2', label: '라디오', value: 'o2', optionCode: '2', spssNumericCode: 2 },
  ],
} as unknown as Question;

// ────────────────────────────────────────────────────────────
// Task 4 — checkbox 그룹 generateSPSSColumns
// ────────────────────────────────────────────────────────────

describe('checkbox 그룹 export — generateSPSSColumns', () => {
  it('cb1 그룹은 멤버 셀별 choice-group-item 변수를 생성한다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const cbCols = cols.filter((c) => c.type === 'choice-group-item' && c.choiceGroupKey === 'cb1');
    expect(cbCols.length).toBe(2);
    expect(cbCols.map((c) => c.spssVarName)).toEqual(['Q7_cb1_1', 'Q7_cb1_2']);
  });

  it('cb1 변수 counted 코드는 spssNumericCode를 따른다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const cbCols = cols.filter((c) => c.type === 'choice-group-item' && c.choiceGroupKey === 'cb1');
    expect(cbCols[0]?.choiceGroupMemberCode).toBe(5); // cellE
    expect(cbCols[1]?.choiceGroupMemberCode).toBe(7); // cellF
  });

  it('cb1 변수 optionLabel은 "그룹라벨 - 보기라벨" 형식이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col0 = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    expect(col0?.optionLabel).toBe('구매처 - 보기E');
  });

  it('rad1+cb1 혼재 질문에서 choice-group(radio) 과 choice-group-item(checkbox) 이 공존한다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const cgCols = cols.filter((c) => c.type === 'choice-group');
    const cgiCols = cols.filter((c) => c.type === 'choice-group-item');
    expect(cgCols.length).toBe(1);   // rad1
    expect(cgiCols.length).toBe(2);  // cb1 멤버
  });

  it('choiceGroupMemberCellId 는 해당 보기의 cellId이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col0 = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    const col1 = cols.find((c) => c.spssVarName === 'Q7_cb1_2');
    expect(col0?.choiceGroupMemberCellId).toBe('cellE');
    expect(col1?.choiceGroupMemberCellId).toBe('cellF');
  });

  it('optionIndex 는 그룹 내 0-based 순서이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col0 = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    const col1 = cols.find((c) => c.spssVarName === 'Q7_cb1_2');
    expect(col0?.optionIndex).toBe(0);
    expect(col1?.optionIndex).toBe(1);
  });

  it('checkbox 질문의 default 그룹 변수명은 buildCheckboxItemVarName(questionCode, undefined, i) 규칙을 따른다', () => {
    // checkboxGroupQuestion: cellI 는 미소속 → default 그룹 내 i=0 → Q8_1
    const cols = generateSPSSColumns([checkboxGroupQuestion]);
    const defCols = cols.filter((c) => c.type === 'choice-group-item' && c.choiceGroupKey === 'default');
    expect(defCols.length).toBe(1);
    // buildCheckboxItemVarName(Q8, undefined, 0) = Q8_1
    expect(defCols[0]?.spssVarName).toBe('Q8_1');
  });

  it('그룹 없는 checkbox 질문은 기존 checkbox-item 경로를 그대로 사용한다 — 하위호환', () => {
    const cols = generateSPSSColumns([plainCheckboxQuestion]);
    const types = cols.filter((c) => c.questionId === 'q9').map((c) => c.type);
    expect(types).toEqual(['checkbox-item', 'checkbox-item']);
    expect(cols.filter((c) => c.questionId === 'q9').map((c) => c.spssVarName)).toEqual(['Q9_1', 'Q9_2']);
  });
});

// ────────────────────────────────────────────────────────────
// Task 4 — checkbox 그룹 buildDataRows
// ────────────────────────────────────────────────────────────

describe('checkbox 그룹 export — buildDataRows 응답값 변환', () => {
  it('cb1 응답에 cellE 포함 시 Q7_cb1_1=5, cellF 미포함 시 Q7_cb1_2=null', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: { cb1: ['cellE'] } });
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx1 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_1');
    const idx2 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_2');
    expect(row[idx1]).toBe(5);
    expect(row[idx2]).toBeNull();
  });

  it('두 보기 모두 선택 시 양쪽 counted 코드 반환', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: { cb1: ['cellE', 'cellF'] } });
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx1 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_1');
    const idx2 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_2');
    expect(row[idx1]).toBe(5);
    expect(row[idx2]).toBe(7);
  });

  it('레거시 string 응답(그룹 맵 아님) → null 안전 처리', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: 'cellE' });
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx1 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_1');
    expect(row[idx1]).toBeNull();
  });

  it('응답 없음(null) → null', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: null });
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx1 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_1');
    expect(row[idx1]).toBeNull();
  });

  it('레거시 비객체 응답(배열이지만 그룹 맵 아님) → null 안전 처리', () => {
    // 기존 checkbox 응답 shape(문자열 배열)이 잘못 들어온 경우
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: ['cellE', 'cellF'] });
    // rawValue 가 배열이면 typeof === 'object' && Array.isArray 처리
    // choice-group-item case 는 Array 응답을 그룹 맵이 아니라고 판단해야 null
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx1 = cols.findIndex((c) => c.spssVarName === 'Q7_cb1_1');
    expect(row[idx1]).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────
// Task 4 — variable-meta (buildLabel, resolveVarType, resolveMeasure)
// ────────────────────────────────────────────────────────────

describe('checkbox 그룹 export — variable-meta', () => {
  it('choice-group-item 은 Numeric 타입이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    if (!col) throw new Error('컬럼 없음');
    expect(resolveVarType(col, mixedGroupsQuestion)).toBe(VariableType.Numeric);
  });

  it('choice-group-item 은 Nominal 측정수준이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    if (!col) throw new Error('컬럼 없음');
    expect(resolveMeasure(col, mixedGroupsQuestion)).toBe(VariableMeasure.Nominal);
  });

  it('choice-group-item buildLabel 은 optionLabel("그룹라벨 - 보기라벨") 을 그대로 반환한다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    if (!col) throw new Error('컬럼 없음');
    // optionLabel 이 "구매처 - 보기E" 이므로 buildLabel 은 그대로 반환
    expect(buildLabel(col)).toBe('구매처 - 보기E');
  });

  it('M1 fix: radio 그룹 라벨 미설정 시 buildLabel 이 "제목 - 제목" 이중화 안 됨', () => {
    // 그룹 라벨 없는 radio 그룹 — optionLabel === questionText 케이스
    const noLabelGroupQ = {
      ...mixedGroupsQuestion,
      id: 'q_m1',
      questionCode: 'QM1',
      choiceGroups: [
        { id: 'gm1', groupKey: 'rad1', type: 'radio', label: '' }, // 라벨 없음
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'cM1', content: '있음', type: 'choice_opt', choiceGroupId: 'gm1', spssNumericCode: 1 },
          ],
        },
      ],
    } as unknown as Question;
    const cols = generateSPSSColumns([noLabelGroupQ]);
    const col = cols.find((c) => c.type === 'choice-group');
    if (!col) throw new Error('컬럼 없음');
    // optionLabel 이 group.label || q.title → '' || '구매처' = '구매처'
    // buildLabel: choice-group → questionText - optionLabel 이면 "구매처 - 구매처" 이중화 발생
    // M1 fix: optionLabel === questionText 이면 questionText 한 번만 반환해야 한다
    const label = buildLabel(col);
    expect(label).not.toBe(`${noLabelGroupQ.title} - ${noLabelGroupQ.title}`);
    expect(label).toBe(noLabelGroupQ.title);
  });
});

// ────────────────────────────────────────────────────────────
// Task 4 — value labels (buildValueLabels + buildCodebookValueLabel)
// ────────────────────────────────────────────────────────────

describe('checkbox 그룹 export — value labels', () => {
  it('choice-group-item buildValueLabels 는 [{ value: code, label: "선택" }] 형식이다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q7_cb1_1');
    if (!col) throw new Error('컬럼 없음');
    const labels = buildValueLabels(col, mixedGroupsQuestion);
    expect(labels).toEqual([{ value: 5, label: '선택' }]);
  });

  it('choice-group-item buildValueLabels 는 2번째 보기도 자체 counted 코드를 갖는다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const col = cols.find((c) => c.spssVarName === 'Q7_cb1_2');
    if (!col) throw new Error('컬럼 없음');
    const labels = buildValueLabels(col, mixedGroupsQuestion);
    expect(labels).toEqual([{ value: 7, label: '선택' }]);
  });
});

// ────────────────────────────────────────────────────────────
// Task 4 — mrsets-syntax (choice-group-item MCGROUP)
// ────────────────────────────────────────────────────────────

describe('checkbox 그룹 export — mrsets-syntax', () => {
  it('cb1 그룹은 $Q7_cb1 이름으로 MCGROUP을 생성한다', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    expect(syntax).toContain('/MCGROUP NAME=$Q7_cb1');
  });

  it('cb1 MCGROUP 라벨은 그룹 라벨(구매처)을 사용한다', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    expect(syntax).toContain("LABEL='구매처'");
  });

  it('cb1 MCGROUP VARIABLES 에 멤버 변수명이 순서대로 포함된다', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    expect(syntax).toContain('VARIABLES=Q7_cb1_1 Q7_cb1_2');
  });

  it('rad1(radio) 그룹은 choice-group 이므로 MCGROUP 미생성, cb1 만 생성된다', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // rad1 에 대한 세트 없음
    expect(syntax).not.toContain('$Q7_rad1');
    // cb1 에 대한 세트 존재
    expect(syntax).toContain('$Q7_cb1');
  });

  it('grouepd checkbox 질문 존재 시 질문 단위 $Q7 세트가 생성되지 않는다 — 배타성', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // 그룹 없는 checkbox-item 변수가 없으므로 $Q7 질문 단위 세트 미생성
    expect(syntax).not.toMatch(/NAME=\$Q7[^_]/);
  });

  it('default cb 그룹은 $Q8_default 이름으로 MCGROUP을 생성한다', () => {
    // checkboxGroupQuestion: gc2(cb2) + default(미소속 cellI)
    const questions = [checkboxGroupQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // default 그룹 세트
    expect(syntax).toContain('/MCGROUP NAME=$Q8_default');
  });
});

// ────────────────────────────────────────────────────────────
// Task 4 — value-labels-coverage: choice-group-item 포함
// ────────────────────────────────────────────────────────────

describe('value-labels-coverage — choice-group-item 추가', () => {
  it('choice-group-item 컬럼은 CATEGORICAL_TYPES에 포함되어 value labels를 가진다', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const CATEGORICAL_TYPES = new Set([
      'single', 'checkbox-item', 'table-cell', 'choice-group', 'choice-group-item',
    ]);
    const cgiCols = cols.filter((c) => CATEGORICAL_TYPES.has(c.type) && c.tableCellType !== 'input');
    // cb1 두 보기 + rad1 choice-group 합 3개 이상
    expect(cgiCols.length).toBeGreaterThanOrEqual(3);
    for (const col of cgiCols) {
      const labels = buildValueLabels(col, questions.find((q) => q.id === col.questionId));
      expect(labels, `${col.spssVarName} value labels 누락`).toBeDefined();
      expect(labels!.length).toBeGreaterThan(0);
    }
  });
});
