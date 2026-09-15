import { describe, expect, it } from 'vitest';

import { buildDataRows, generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { QuestionVariant } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { generateMrsetsSyntax } from '@/lib/spss/mrsets-syntax';
import {
  collectUnfilledChoiceGroupCellIds,
  isQuestionAnswered,
  resolveGroupedRequiredMessage,
} from '@/features/survey-response/lib/answer-validation';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { stripHiddenQuestionValues } from '@/lib/survey/question-visibility';
import { applyStructuralSurvival } from '@/lib/survey-response/structural-survival';
import type { Question, SurveySubmission } from '@/types/survey';

/**
 * 레거시 골든 통과 테스트 — "표 문항이 보기 그룹을 품는다" 스펙의 레거시 불변 원칙(PRD 0절).
 *
 * 레거시 형태 네 벌(보기 그룹 radio · 보기 그룹 checkbox · 보기 소스 표 + `__optTexts__`
 * 사이드카 · 입력/계산/게이팅 셀이 있는 일반 table)을 네 경계에 넣어 **출력을 스냅샷으로
 * 고정**한다. 스냅샷은 스펙 착수 **전** 코드로 찍었다. 이후 티켓은 이 스냅샷을 갱신하지 않고
 * 통과해야 한다 — 갱신이 필요해지는 순간이 곧 원칙 위반이다.
 *
 * 네 경계: 구조 생존 판정 · 저장 strip 3단(숨은 문항 → 게이팅 → calc) · 필수 검증 ·
 * 내보내기 열 생성(+ 값 추출 + MRSET).
 *
 * 픽스처는 마에스트로 2026 의 그룹 checkbox 표와 반도체 활용 계획 표의 모양을 본떴다.
 */

// ── 픽스처 ─────────────────────────────────────────────────────────────

/** 보기 그룹 radio — 행마다 그룹 하나, 기타 상세기재 + choice-selected 게이팅 입력 셀 */
const groupedRadio = {
  id: 'q-grp-radio',
  type: 'radio',
  title: 'TV 보유와 구매 의향',
  required: true,
  order: 1,
  questionCode: 'Q1',
  choiceGroups: [
    { id: 'g1', groupKey: 'rad1', type: 'radio', label: 'TV보유' },
    { id: 'g2', groupKey: 'rad2', type: 'radio', label: '구매의향', required: false },
  ],
  tableColumns: [
    { id: 'c1', label: '구분' },
    { id: 'c2', label: '보기 1' },
    { id: 'c3', label: '보기 2' },
    { id: 'c4', label: '보기 3' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: 'TV보유',
      cells: [
        { id: 'r1-lbl', content: 'TV보유', type: 'text' },
        { id: 'r1-uhd', content: 'UHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 1 },
        { id: 'r1-fhd', content: 'FHD', type: 'choice_opt', choiceGroupId: 'g1', spssNumericCode: 2 },
        {
          id: 'r1-etc',
          content: '기타',
          type: 'choice_opt',
          choiceGroupId: 'g1',
          spssNumericCode: 3,
          allowTextInput: true,
        },
      ],
    },
    {
      id: 'r2',
      label: '구매의향',
      cells: [
        { id: 'r2-lbl', content: '구매의향', type: 'text' },
        { id: 'r2-yes', content: '있음', type: 'choice_opt', choiceGroupId: 'g2', spssNumericCode: 1 },
        { id: 'r2-no', content: '없음', type: 'choice_opt', choiceGroupId: 'g2', spssNumericCode: 2 },
        {
          id: 'r2-when',
          content: '',
          type: 'input',
          exportLabel: '구매 시기',
          enabledWhen: { kind: 'choice-selected', controllerCellId: 'r2-yes' },
        },
      ],
    },
  ],
} as unknown as Question;

/** 보기 그룹 checkbox — 그룹 하나, 보기 셋 */
const groupedCheckbox = {
  id: 'q-grp-cb',
  type: 'checkbox',
  title: '구매처',
  required: true,
  order: 2,
  questionCode: 'Q2',
  choiceGroups: [{ id: 'gc1', groupKey: 'cb1', type: 'checkbox', label: '구매처' }],
  tableColumns: [
    { id: 'c1', label: '보기 1' },
    { id: 'c2', label: '보기 2' },
    { id: 'c3', label: '보기 3' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '구매처',
      cells: [
        { id: 'cb-a', content: '온라인', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 1 },
        { id: 'cb-b', content: '대리점', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 2 },
        { id: 'cb-c', content: '양판점', type: 'choice_opt', choiceGroupId: 'gc1', spssNumericCode: 3 },
      ],
    },
  ],
} as unknown as Question;

/** 보기 소스 표 (그룹 없음) — 표 안 입력 셀은 사이드카에 산다 */
const choiceSourceRadio = {
  id: 'q-choice-src',
  type: 'radio',
  title: '주 사용 제품',
  required: true,
  order: 3,
  questionCode: 'Q3',
  tableColumns: [
    { id: 'c1', label: '제품' },
    { id: 'c2', label: '보기' },
    { id: 'c3', label: '수량' },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '제품',
      cells: [
        { id: 'src-lbl', content: '제품', type: 'text' },
        { id: 'src-a', content: 'DDI', type: 'choice_opt', spssNumericCode: 1 },
        { id: 'src-amount', content: '', type: 'input', inputType: 'number', exportLabel: '수량' },
      ],
    },
    {
      id: 'r2',
      label: '제품 2',
      cells: [
        { id: 'src-lbl2', content: '', type: 'text' },
        { id: 'src-b', content: 'AP', type: 'choice_opt', spssNumericCode: 2 },
        { id: 'src-note', content: '', type: 'text' },
      ],
    },
  ],
} as unknown as Question;

/** 일반 table — 숫자 입력 둘 + 계산 셀 + radio 셀이 여는 게이팅 입력 셀 */
const plainTable = {
  id: 'q-table',
  type: 'table',
  title: '생산 실적',
  required: true,
  order: 4,
  questionCode: 'Q4',
  tableColumns: [
    { id: 'c1', label: '구분' },
    { id: 'c2', label: '상반기' },
    { id: 'c3', label: '하반기' },
    { id: 'c4', label: '합계' },
  ],
  tableRowsData: [
    {
      id: 't-r1',
      label: '실적',
      cells: [
        { id: 't-r1-lbl', content: '실적', type: 'text' },
        { id: 't-r1-a', content: '', type: 'input', inputType: 'number' },
        { id: 't-r1-b', content: '', type: 'input', inputType: 'number' },
        {
          id: 't-r1-sum',
          content: '',
          type: 'calc',
          formula: {
            kind: 'group',
            op: '+',
            terms: [
              { kind: 'cell', cellId: 't-r1-a' },
              { kind: 'cell', cellId: 't-r1-b' },
            ],
          },
        },
      ],
    },
    {
      id: 't-r2',
      label: '수출',
      cells: [
        { id: 't-r2-lbl', content: '수출', type: 'text' },
        {
          id: 't-r2-mode',
          content: '',
          type: 'radio',
          radioOptions: [
            { id: 'yes', label: '함', value: 'yes' },
            { id: 'no', label: '안 함', value: 'no' },
          ],
        },
        {
          id: 't-r2-detail',
          content: '',
          type: 'input',
          enabledWhen: { kind: 'option', controllerCellId: 't-r2-mode', values: ['yes'] },
        },
        { id: 't-r2-blank', content: '', type: 'text' },
      ],
    },
  ],
} as unknown as Question;

/** 그룹 radio 의 선택으로 숨거나 보이는 단답형 둘 */
function conditionalText(id: string, code: string, requiredValues: string[]): Question {
  return {
    id,
    type: 'text',
    title: `${code} 조건부`,
    required: false,
    order: 5,
    questionCode: code,
    displayCondition: {
      logicType: 'AND',
      conditions: [
        {
          id: `${id}-cond`,
          name: '조건 1',
          enabled: true,
          logicType: 'AND',
          conditionType: 'value-match',
          requiredValues,
          sourceQuestionId: 'q-grp-radio',
        },
      ],
    },
  } as unknown as Question;
}

const hiddenText = conditionalText('q-hidden-text', 'Q5', ['r1-uhd']);
const shownText = conditionalText('q-shown-text', 'Q6', ['r1-etc']);

const questions: Question[] = [
  groupedRadio,
  groupedCheckbox,
  choiceSourceRadio,
  plainTable,
  hiddenText,
  shownText,
];

/** 제출 직전 응답 — 게이팅 미충족 잔존값·숨은 문항 값·계산 셀 구값을 일부러 담았다 */
const responses: Record<string, unknown> = {
  'q-grp-radio': { rad1: 'r1-etc', rad2: 'r2-no' },
  'q-grp-cb': { cb1: ['cb-a', 'cb-c'] },
  'q-choice-src': 'src-b',
  'q-table': {
    't-r1-a': '10',
    't-r1-b': '20',
    't-r1-sum': '999',
    't-r2-mode': 'no',
    't-r2-detail': '지워져야 한다',
  },
  'q-hidden-text': '숨은 답',
  'q-shown-text': '보이는 답',
  __optTexts__: {
    'q-grp-radio': { 'r1-etc': '벽걸이', 'r2-when': '지워져야 한다' },
    'q-choice-src': { 'src-amount': '12' },
  },
};

/** 재발행으로 구조가 줄어든 설문 — 그룹·보기·행이 하나씩 사라졌다 */
function shrunkQuestions(): Question[] {
  const radio = structuredClone(groupedRadio);
  radio.choiceGroups = radio.choiceGroups!.filter((g) => g.id !== 'g2');
  radio.tableRowsData = radio.tableRowsData!.filter((r) => r.id !== 'r2');
  const cb = structuredClone(groupedCheckbox);
  cb.tableRowsData![0]!.cells = cb.tableRowsData![0]!.cells.filter((c) => c.id !== 'cb-c');
  const src = structuredClone(choiceSourceRadio);
  src.tableRowsData = src.tableRowsData!.filter((r) => r.id !== 'r2');
  const table = structuredClone(plainTable);
  table.tableRowsData = table.tableRowsData!.filter((r) => r.id !== 't-r2');
  return [radio, cb, src, table, hiddenText, shownText];
}

function makeSubmission(questionResponses: Record<string, unknown>): SurveySubmission {
  return {
    id: 'sub-1',
    surveyId: 'sv-1',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:01:00Z'),
    isCompleted: true,
    questionResponses,
    updatedAt: new Date('2026-01-01T00:01:00Z'),
  };
}

// ── 경계 1: 구조 생존 판정 ────────────────────────────────────────────

describe('레거시 골든 — 구조 생존 판정', () => {
  it('같은 구조에서는 값이 그대로 산다', () => {
    expect(applyStructuralSurvival(responses, questions)).toMatchSnapshot();
  });

  it('그룹·보기·행이 사라진 구조에서의 판정 결과', () => {
    expect(applyStructuralSurvival(responses, shrunkQuestions())).toMatchSnapshot();
  });
});

// ── 경계 2: 저장 strip 3단 ────────────────────────────────────────────

describe('레거시 골든 — 저장 strip (숨은 문항 → 게이팅 → calc)', () => {
  it('제출 직전 응답을 세 단계로 정리한 결과', () => {
    const afterHidden = stripHiddenQuestionValues(questions, responses, []);
    const afterGating = stripDisabledCellValues(questions, afterHidden);
    const afterCalc = withCalcValues(afterGating, {
      questions,
      responses: afterGating,
      lookups: [],
      contactAttrs: {},
    });
    expect({ afterHidden, afterGating, afterCalc }).toMatchSnapshot();
  });
});

// ── 경계 3: 필수 검증 ─────────────────────────────────────────────────

describe('레거시 골든 — 필수 검증', () => {
  const cases: Record<string, unknown> = {
    채움: responses,
    빈응답: {},
    '그룹 하나만': { 'q-grp-radio': { rad1: 'r1-uhd' }, 'q-grp-cb': { cb1: [] } },
  };

  it('문항별 응답됨 · 미충족 그룹 셀 · 필수 문구', () => {
    const verdicts = Object.fromEntries(
      Object.entries(cases).map(([name, res]) => [
        name,
        Object.fromEntries(
          questions.map((q) => {
            const value = (res as Record<string, unknown>)[q.id];
            return [
              q.id,
              {
                answered: isQuestionAnswered(q, value),
                unfilledCells: [...collectUnfilledChoiceGroupCellIds(q, value)].sort(),
                message: resolveGroupedRequiredMessage(q, value),
              },
            ];
          }),
        ),
      ]),
    );
    expect(verdicts).toMatchSnapshot();
  });
});

// ── 경계 4: 내보내기 열 생성 ──────────────────────────────────────────

describe('레거시 골든 — 내보내기 열 · 값 · MRSET', () => {
  const hydrated = hydrateQuestionsForSpss(questions as unknown as QuestionVariant[]);
  const columns = generateSPSSColumns(hydrated);

  it('열 구성 (변수명 · 타입 · 셀/그룹 매핑)', () => {
    const shape = columns.map((c) => ({
      spssVarName: c.spssVarName,
      type: c.type,
      questionId: c.questionId,
      optionLabel: c.optionLabel,
      ...(c.tableCellId !== undefined ? { tableCellId: c.tableCellId } : {}),
      ...(c.optionIndex !== undefined ? { optionIndex: c.optionIndex } : {}),
      ...(c.optionValue !== undefined ? { optionValue: c.optionValue } : {}),
      ...(c.choiceGroupKey !== undefined ? { choiceGroupKey: c.choiceGroupKey } : {}),
      ...(c.choiceGroupCellValueMap !== undefined
        ? { choiceGroupCellValueMap: c.choiceGroupCellValueMap }
        : {}),
      ...(c.choiceGroupValueLabels !== undefined
        ? { choiceGroupValueLabels: c.choiceGroupValueLabels }
        : {}),
      ...(c.choiceGroupMemberCellId !== undefined
        ? { choiceGroupMemberCellId: c.choiceGroupMemberCellId }
        : {}),
    }));
    expect(shape).toMatchSnapshot();
  });

  it('제출 응답 한 건의 값 행', () => {
    const rows = buildDataRows(columns, hydrated, [makeSubmission(responses)]);
    const named = columns.map((c, i) => [c.spssVarName, rows[0]![i]]);
    expect(named).toMatchSnapshot();
  });

  it('MRSET 구문', () => {
    expect(generateMrsetsSyntax(columns, hydrated as unknown as Question[])).toMatchSnapshot();
  });
});
