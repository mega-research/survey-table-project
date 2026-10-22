import type { Question, QuestionConditionGroup } from '@/types/survey';

/**
 * 테스트 전용 — 명단 열과 같은 이름의 응답 인용값을 조건이 읽는 설문.
 *
 * 응답 화면은 조건을 `{ ...명단 값, ...응답 인용값 }` 으로 푼다(인용 우선). 명단은 `지역=서울` 이고
 * 첫 문항의 인용값이 `부산` 이면 화면에서는 `지역 == 부산` 조건이 참이라 그 열·행·문항이 보이고
 * 응답자가 입력한다. 응답 확정·Raw 내보내기가 명단 값만으로 풀면 거짓이 되어 그 답을 지운다.
 *
 *   q-src   : 보기 문항, 인용 이름 「지역」 — 「부산」 보기는 문구 `부산`, 「기타」는 상세 기재 `{{입력}}`
 *   q-tbl   : 표 — 「부산 전용」 열(c-col), 「부산 전용」 행(r-busan) 에 `지역 == 부산` 조건
 *   q-dep   : 문항 표시 조건 `지역 == 부산`
 */

export const QUOTE_CONTACT_ATTRS: Record<string, string> = { 지역: '서울' };

const regionIsBusan = (id: string): QuestionConditionGroup =>
  ({
    logicType: 'AND',
    conditions: [
      {
        id,
        enabled: true,
        logicType: 'AND',
        conditionType: 'expression',
        sourceQuestionId: '',
        expressionConfig: {
          clauses: [
            {
              kind: 'comparison',
              comparison: {
                op: '==',
                left: { kind: 'attr', attrsKey: '지역' },
                right: { kind: 'literal', value: '부산' },
              },
            },
          ],
          joinOps: [],
        },
      },
    ],
  }) as unknown as QuestionConditionGroup;

export const QUOTE_CONDITION_QUESTIONS: Question[] = [
  {
    id: 'q-src',
    type: 'radio',
    title: '지역',
    required: false,
    order: 0,
    answerQuoteEnabled: true,
    answerQuoteName: '지역',
    options: [
      { id: 'opt-busan', label: '부산', value: 'busan', answerQuoteText: '부산' },
      {
        id: 'opt-etc',
        label: '기타',
        value: 'etc',
        allowTextInput: true,
        answerQuoteText: '{{입력}}',
      },
    ],
  },
  {
    id: 'q-tbl',
    type: 'table',
    title: '지역별 표',
    required: false,
    order: 1,
    tableColumns: [
      { id: 'col-a', label: '공통' },
      { id: 'col-b', label: '부산 전용', displayCondition: regionIsBusan('col-b-c1') },
    ],
    tableRowsData: [
      {
        id: 'r-all',
        label: '공통 행',
        cells: [
          { id: 'c-all-a', content: '', type: 'input' },
          { id: 'c-col', content: '', type: 'input' },
        ],
      },
      {
        id: 'r-busan',
        label: '부산 전용 행',
        displayCondition: regionIsBusan('r-busan-c1'),
        cells: [
          { id: 'c-row-a', content: '', type: 'input' },
          { id: 'c-row-b', content: '', type: 'input' },
        ],
      },
    ],
  },
  {
    id: 'q-dep',
    type: 'text',
    title: '부산 전용 문항',
    required: false,
    order: 2,
    displayCondition: regionIsBusan('q-dep-c1'),
  },
] as unknown as Question[];

/** 보기 문구로 인용값 `부산` 이 나오는 응답 — 화면에서 보이고 입력한 칸 전부에 값이 있다. */
export function quoteFromOptionResponses(): Record<string, unknown> {
  return {
    'q-src': 'busan',
    'q-tbl': { 'c-all-a': '1', 'c-col': '2', 'c-row-a': '3', 'c-row-b': '4' },
    'q-dep': '부산 문항 답',
  };
}

/** 기타 상세 기재로 인용값 `부산` 이 나오는 응답 — 재료는 루트 `__optTexts__` 사이드카다. */
export function quoteFromOtherTextResponses(): Record<string, unknown> {
  return {
    'q-src': 'etc',
    'q-tbl': { 'c-all-a': '1', 'c-col': '2', 'c-row-a': '3', 'c-row-b': '4' },
    'q-dep': '부산 문항 답',
    __optTexts__: { 'q-src': { 'opt-etc': '부산' } },
  };
}
