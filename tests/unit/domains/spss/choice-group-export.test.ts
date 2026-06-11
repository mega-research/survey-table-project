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

  it('grouped checkbox 질문 존재 시 질문 단위 $Q7 세트가 생성되지 않는다 — 배타성', () => {
    const questions = [mixedGroupsQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // 그룹 없는 checkbox-item 변수가 없으므로 $Q7 질문 단위 세트 미생성
    expect(syntax).not.toMatch(/NAME=\$Q7[^_]/);
  });

  it('default cb 그룹은 그룹 도입 전과 동일한 $질문코드 이름으로 MCGROUP을 생성한다', () => {
    // checkboxGroupQuestion: gc2(cb2) + default(미소속 cellI)
    const questions = [checkboxGroupQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // 변수명(Q8_1...)과 마찬가지로 세트명도 하위호환 — 내부 예약어 default 미노출
    expect(syntax).toContain('/MCGROUP NAME=$Q8 ');
    expect(syntax).not.toContain('$Q8_default');
  });
});

// ────────────────────────────────────────────────────────────
// Task 6 — ranking 그룹 export
// ────────────────────────────────────────────────────────────

// ranking 그룹이 있는 질문 픽스처:
//   rnk1 그룹: cellA(spssNumericCode=5), cellB — _etc 없음
//   rnk2 그룹: cellC, cellD(isOtherRankingCell=true) — _etc 있음
//   미소속: cellE → default 그룹
// 질문코드: Q9, positions: 3, optionsSource: 'table'
const rankingGroupQuestion = {
  id: 'qrnk',
  type: 'ranking',
  title: '보유 장비',
  required: false,
  order: 1,
  questionCode: 'Q9',
  rankingConfig: { positions: 3, optionsSource: 'table' },
  choiceGroups: [
    { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '보유 장비' },
    { id: 'rg2', groupKey: 'rnk2', type: 'ranking', label: '' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: '노트북', type: 'ranking_opt', choiceGroupId: 'rg1', spssNumericCode: 5 },
        { id: 'cellB', content: '데스크탑', type: 'ranking_opt', choiceGroupId: 'rg1' },
        { id: 'cellC', content: '태블릿', type: 'ranking_opt', choiceGroupId: 'rg2' },
        { id: 'cellD', content: '기타', type: 'ranking_opt', choiceGroupId: 'rg2', isOtherRankingCell: true },
        { id: 'cellE', content: '스마트폰', type: 'ranking_opt' },
      ],
    },
  ],
} as unknown as Question;

// 그룹 1개짜리 픽스처 (legacy flat 폴백 테스트용)
const rankingSoleGroupQuestion = {
  id: 'qsole',
  type: 'ranking',
  title: '기기',
  required: false,
  order: 1,
  questionCode: 'Q',
  rankingConfig: { positions: 3, optionsSource: 'table' },
  choiceGroups: [
    { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '기기' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: 'TV', type: 'ranking_opt', choiceGroupId: 'rg1', spssNumericCode: 5 },
        { id: 'cellB', content: '라디오', type: 'ranking_opt', choiceGroupId: 'rg1', spssNumericCode: 3 },
      ],
    },
  ],
} as unknown as Question;

// 그룹 2개짜리 픽스처 (legacy flat 폴백 차단 테스트용)
const rankingTwoGroupQuestion = {
  id: 'qtwo',
  type: 'ranking',
  title: '기기2',
  required: false,
  order: 1,
  questionCode: 'QQ',
  rankingConfig: { positions: 2, optionsSource: 'table' },
  choiceGroups: [
    { id: 'rg1', groupKey: 'rnk1', type: 'ranking', label: '그룹1' },
    { id: 'rg2', groupKey: 'rnk2', type: 'ranking', label: '그룹2' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '행1',
      cells: [
        { id: 'cellA', content: 'A', type: 'ranking_opt', choiceGroupId: 'rg1', spssNumericCode: 1 },
        { id: 'cellB', content: 'B', type: 'ranking_opt', choiceGroupId: 'rg2', spssNumericCode: 2 },
      ],
    },
  ],
} as unknown as Question;

describe('ranking 그룹 export — generateSPSSColumns 변수명', () => {
  it('명시 그룹은 질문코드_groupKey_rk{k} 형식의 변수를 생성한다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const names = cols.map((c) => c.spssVarName);
    // rnk1 그룹: 멤버 2개 → cap 2 (positions=3이지만 멤버 2)
    expect(names).toContain('Q9_rnk1_rk1');
    expect(names).toContain('Q9_rnk1_rk2');
    expect(names).not.toContain('Q9_rnk1_rk3');
    // rnk2 그룹: 멤버 2개(기타 포함) → cap 2
    expect(names).toContain('Q9_rnk2_rk1');
    expect(names).toContain('Q9_rnk2_rk2');
    // default 그룹(cellE): 멤버 1개 → cap 1 → 질문코드_rk{k} 형식
    expect(names).toContain('Q9_rk1');
    expect(names).not.toContain('Q9_rk2');
  });

  it('_etc 변수는 isOtherRankingCell 소속 그룹에만 생성된다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const names = cols.map((c) => c.spssVarName);
    // rnk2 그룹에 기타 셀 → _etc 있음
    expect(names).toContain('Q9_rnk2_rk1_etc');
    expect(names).toContain('Q9_rnk2_rk2_etc');
    // rnk1 그룹에는 기타 셀 없음 → _etc 없음
    expect(names).not.toContain('Q9_rnk1_rk1_etc');
    expect(names).not.toContain('Q9_rnk1_rk2_etc');
    // default 그룹에도 기타 셀 없음
    expect(names).not.toContain('Q9_rk1_etc');
  });

  it('컬럼 타입은 ranking-rank, _etc는 ranking-other이다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1');
    const etc1 = cols.find((c) => c.spssVarName === 'Q9_rnk2_rk1_etc');
    expect(rk1?.type).toBe('ranking-rank');
    expect(etc1?.type).toBe('ranking-other');
  });

  it('ranking-rank 컬럼에 choiceGroupKey와 rankIndex가 올바르게 설정된다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1');
    expect(rk1?.choiceGroupKey).toBe('rnk1');
    expect(rk1?.rankIndex).toBe(1);
  });

  it('value labels용 cellOptions가 그룹 멤버로만 한정된다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1');
    // rnk1 멤버: cellA(5), cellB(그룹 내 2번째 → spssNumericCode 없으면 idx+1=2)
    // cellOptions는 그룹 멤버 전체를 담고, value label 필터링은 toSpssValueLabelPairs에서 수행된다
    const opts = rk1?.cellOptions ?? [];
    const optIds = opts.map((o) => o.id);
    expect(optIds).toContain('cellA');
    expect(optIds).toContain('cellB');
    expect(optIds).not.toContain('cellC');
    expect(optIds).not.toContain('cellE');
  });

  it('soleRankingGroup은 그룹이 1개일 때만 true이다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1');
    // rankingGroupQuestion: 그룹 3개(rnk1+rnk2+default) → false
    expect(rk1?.soleRankingGroup).toBe(false);

    const soleCols = generateSPSSColumns([rankingSoleGroupQuestion]);
    const soleRk1 = soleCols.find((c) => c.spssVarName === 'Q_rnk1_rk1');
    // soleGroupQuestion: 그룹 1개(rnk1) → true
    expect(soleRk1?.soleRankingGroup).toBe(true);
  });
});

describe('ranking 그룹 export — buildDataRows 응답값 변환', () => {
  it('그룹별 응답 맵에서 올바른 rank 값을 추출한다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    // rnk1 그룹에 cellA를 1순위로 선택
    const sub = makeSubmission({ qrnk: { rnk1: [{ rank: 1, optionValue: 'cellA' }] } });
    const rows = buildDataRows(cols, [rankingGroupQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx = (name: string) => cols.findIndex((c) => c.spssVarName === name);
    // rnk1 그룹의 cellA는 spssNumericCode=5 → 1순위에 5
    expect(row[idx('Q9_rnk1_rk1')]).toBe(5);
    // rnk1 rk2는 미선택 → null
    expect(row[idx('Q9_rnk1_rk2')]).toBeNull();
    // rnk2 그룹은 응답 없음 → null
    expect(row[idx('Q9_rnk2_rk1')]).toBeNull();
  });

  it('legacy flat 폴백: 그룹 1개 + 배열 응답 → 그룹 응답으로 해석한다', () => {
    const cols = generateSPSSColumns([rankingSoleGroupQuestion]);
    // 그룹 1개(rnk1) + flat 배열 응답
    const sub = makeSubmission({ qsole: [{ rank: 1, optionValue: 'cellA' }] });
    const rows = buildDataRows(cols, [rankingSoleGroupQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx = (name: string) => cols.findIndex((c) => c.spssVarName === name);
    // cellA spssNumericCode=5 → 1순위에 5
    expect(row[idx('Q_rnk1_rk1')]).toBe(5);
    // 2순위 미선택 → null
    expect(row[idx('Q_rnk1_rk2')]).toBeNull();
  });

  it('legacy flat 폴백: 그룹 2개 + 배열 응답 → 모두 null (모호하므로 차단)', () => {
    const cols = generateSPSSColumns([rankingTwoGroupQuestion]);
    const sub = makeSubmission({ qtwo: [{ rank: 1, optionValue: 'cellA' }] });
    const rows = buildDataRows(cols, [rankingTwoGroupQuestion], [sub]);
    const row = rows[0];
    if (row == null) throw new Error('row 없음');
    const idx = (name: string) => cols.findIndex((c) => c.spssVarName === name);
    expect(row[idx('QQ_rnk1_rk1')]).toBeNull();
    expect(row[idx('QQ_rnk2_rk1')]).toBeNull();
  });
});

describe('ranking 그룹 export — buildLabel (variable-meta)', () => {
  it('그룹 라벨 있으면 "질문제목 - 그룹라벨 - k순위" 형식이다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk1_rk1');
    if (!rk1) throw new Error('컬럼 없음');
    // rnk1 라벨 '보유 장비' → "보유 장비 - 1순위"
    expect(buildLabel(rk1)).toBe('보유 장비 - 보유 장비 - 1순위');
  });

  it('그룹 라벨 없는 경우(default 또는 라벨 빈 그룹) 기존 형식 "질문제목 (k순위)"이다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    // rnk2 그룹: label='' → optionLabel 기본형("1순위")과 같음 → 기존 형식
    const rnk2rk1 = cols.find((c) => c.spssVarName === 'Q9_rnk2_rk1');
    if (!rnk2rk1) throw new Error('컬럼 없음');
    expect(buildLabel(rnk2rk1)).toBe('보유 장비 (1순위)');
    // default 그룹(Q9_rk1)도 기존 형식
    const def = cols.find((c) => c.spssVarName === 'Q9_rk1');
    if (!def) throw new Error('컬럼 없음');
    expect(buildLabel(def)).toBe('보유 장비 (1순위)');
  });

  it('ranking-other: 라벨 빈 그룹은 "질문제목 - k순위 기타 입력" 기본형이다', () => {
    const cols = generateSPSSColumns([rankingGroupQuestion]);
    const etc = cols.find((c) => c.spssVarName === 'Q9_rnk2_rk1_etc');
    if (!etc) throw new Error('컬럼 없음');
    // rnk2 라벨 '' → optionLabel 기본형("1순위 기타 입력")과 같음 → 접두 미삽입
    expect(buildLabel(etc)).toBe('보유 장비 - 1순위 기타 입력');
  });

  it('ranking-other: 라벨 있는 그룹은 "질문제목 - 그룹라벨 - k순위 기타 입력" 형식이다', () => {
    // rnk1(label='보유 장비')에 isOtherRankingCell 셀을 포함한 별도 픽스처
    const rankingGroupWithEtc = {
      id: 'qrnk_etc',
      type: 'ranking',
      title: '보유 장비',
      required: false,
      order: 1,
      questionCode: 'QE',
      rankingConfig: { positions: 2, optionsSource: 'table' },
      choiceGroups: [
        { id: 'rge1', groupKey: 'rnk1', type: 'ranking', label: '보유 장비' },
      ],
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'cellA', content: '노트북', type: 'ranking_opt', choiceGroupId: 'rge1', spssNumericCode: 1 },
            { id: 'cellB', content: '기타', type: 'ranking_opt', choiceGroupId: 'rge1', isOtherRankingCell: true },
          ],
        },
      ],
    } as unknown as Question;
    const cols = generateSPSSColumns([rankingGroupWithEtc]);
    // rnk1(라벨='보유 장비') 1순위 기타 변수: QE_rnk1_rk1_etc
    const etc = cols.find((c) => c.spssVarName === 'QE_rnk1_rk1_etc');
    if (!etc) throw new Error('컬럼 없음');
    // 라벨 있음 → optionLabel = "보유 장비 - 1순위 기타 입력" → 접두 분기 실행
    expect(buildLabel(etc)).toBe('보유 장비 - 보유 장비 - 1순위 기타 입력');
  });

  it('비그룹 ranking-rank buildLabel은 기존 형식(질문제목 (k순위))이다 — 하위호환', () => {
    // choiceGroups 없는 순수 ranking 질문
    const plain = {
      id: 'qplain',
      type: 'ranking',
      title: '기존순위',
      required: false,
      order: 1,
      questionCode: 'QP',
      rankingConfig: { positions: 2, optionsSource: 'manual' },
      options: [
        { id: 'o1', label: '보기1', value: 'o1', spssNumericCode: 1 },
      ],
    } as unknown as Question;
    const cols = generateSPSSColumns([plain]);
    const rk1 = cols.find((c) => c.spssVarName === 'QP_rk1');
    if (!rk1) throw new Error('컬럼 없음');
    expect(buildLabel(rk1)).toBe('기존순위 (1순위)');
  });
});

describe('ranking 그룹 export — mrsets-syntax MCGROUP 미생성', () => {
  it('grouped ranking 질문에서 MCGROUP은 생성되지 않는다', () => {
    const questions = [rankingGroupQuestion];
    const cols = generateSPSSColumns(questions);
    const syntax = generateMrsetsSyntax(cols, questions);
    // ranking 질문 단독이므로 MCGROUP 없어야 함
    expect(syntax).toBeNull();
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

// ────────────────────────────────────────────────────────────
// 최종리뷰 보강 — 혼재 단일 응답 행 + 사이드카 변수명 하위호환
// ────────────────────────────────────────────────────────────

describe('혼재 그룹 단일 응답 행 — radio와 checkbox 그룹 동시 추출', () => {
  it('한 submission에서 rad1 1변수와 cb1 N변수가 동시에 정확히 추출된다', () => {
    const cols = generateSPSSColumns([mixedGroupsQuestion]);
    const sub = makeSubmission({ q7: { rad1: 'cellR', cb1: ['cellE'] } });
    const rows = buildDataRows(cols, [mixedGroupsQuestion], [sub]);
    const row = rows[0]!;
    const idx = (name: string) => cols.findIndex((c) => c.spssVarName === name);
    expect(row[idx('Q7_rad1')]).toBe(1);       // rad1 선택 cellR 코드
    expect(row[idx('Q7_cb1_1')]).toBe(5);      // cellE 선택 counted
    expect(row[idx('Q7_cb1_2')]).toBeNull();   // cellF 미선택 system-missing
  });
});

describe('checkbox 그룹 allowTextInput 사이드카 — 변수명 하위호환', () => {
  const withTextQuestion = {
    id: 'q10',
    type: 'checkbox',
    title: '경로',
    required: false,
    order: 4,
    questionCode: 'Q10',
    choiceGroups: [{ id: 'gt1', groupKey: 'cb1', type: 'checkbox', label: '경로' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '행1',
        cells: [
          { id: 'cellT', content: '보기T', type: 'choice_opt', choiceGroupId: 'gt1', spssNumericCode: 9, allowTextInput: true },
          // 미소속(default) + 텍스트 입력 — 기존 비그룹 checkbox 사이드카 규칙과 동일해야 함
          { id: 'cellU', content: '기타', type: 'choice_opt', allowTextInput: true },
        ],
      },
    ],
  } as unknown as Question;

  it('명시 그룹 사이드카는 질문코드_groupKey_순번_text, default는 질문코드_순번_text', () => {
    const cols = generateSPSSColumns([withTextQuestion]);
    const names = cols.filter((c) => c.type === 'option-text').map((c) => c.spssVarName);
    expect(names).toContain('Q10_cb1_1_text');
    expect(names).toContain('Q10_1_text');
    // 보기 인덱스가 base 변수명에 이중 포함되지 않는다
    expect(names).not.toContain('Q10_cb1_1_9_text');
  });
});
