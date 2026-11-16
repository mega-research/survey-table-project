/**
 * 설문 구조 견본 — scripts/survey-ops 의 점검(check)·요약(summary) 테스트가 같이 쓴다.
 * 조립 산출물(out.json)·DB 행과 같은 필드 이름으로 최소 모양만 만든다.
 */
import type { RawQuestion } from '../../scripts/survey-ops/check-core';

export type Loose = Record<string, unknown>;

export const opt = (n: number, label: string, extra: Loose = {}): Loose => ({
  id: `o${n}-${label}`,
  label,
  value: String(n),
  spssNumericCode: n,
  ...extra,
});

export function question(partial: Loose & { id: string; type: string; order: number }): RawQuestion {
  return {
    surveyId: 'survey-1',
    title: `${partial.id} 제목`,
    required: true,
    questionCode: partial.id.toUpperCase(),
    ...partial,
  } as unknown as RawQuestion;
}

/** 응답자 유형 — 뒤 문항이 조건으로 본다 */
export const a2 = (extra: Loose = {}) =>
  question({
    id: 'a2',
    type: 'radio',
    order: 1,
    options: [opt(1, '공급'), opt(2, '활용'), opt(3, '겸업')],
    ...extra,
  });

export const when = (sourceQuestionId: string, requiredValues: string[], extra: Loose = {}): Loose => ({
  logicType: 'AND',
  conditions: [
    {
      id: `cond-${sourceQuestionId}-${requiredValues.join('')}`,
      enabled: true,
      logicType: 'AND',
      conditionType: 'value-match',
      sourceQuestionId,
      requiredValues,
      ...extra,
    },
  ],
});

export const text = (id: string, content: string, extra: Loose = {}): Loose => ({
  id,
  type: 'text',
  content,
  ...extra,
});
export const numberInput = (id: string, extra: Loose = {}): Loose => ({
  id,
  type: 'input',
  content: '명',
  inputType: 'number',
  ...extra,
});
export const col = (n: number, extra: Loose = {}): Loose => ({
  id: `col${n}${String(extra['tag'] ?? '')}`,
  label: `열 ${n}`,
  columnCode: `c${String(n).padStart(2, '0')}`,
  ...extra,
});
export const row = (n: number, cells: Loose[], extra: Loose = {}): Loose => ({
  id: `row${n}-${String(cells[0]?.['id'])}`,
  label: `행 ${n}`,
  rowCode: `r${String(n).padStart(2, '0')}`,
  cells,
  ...extra,
});

/** 숫자 표 — [이름 | 입력] 두 줄 */
export const numberTable = (id: string, order: number, extra: Loose = {}) =>
  question({
    id,
    type: 'table',
    order,
    tableColumns: [col(1, { tag: id }), col(2, { tag: id })],
    tableRowsData: [
      row(1, [text(`${id}-t1`, '전체'), numberInput(`${id}-i1`)]),
      row(2, [text(`${id}-t2`, '피지컬 AI'), numberInput(`${id}-i2`)]),
    ],
    ...extra,
  });

/** 열 방향 보기 그룹 표 — [항목 | 공급 □] 세 줄 */
export const choiceTable = (id: string, order: number, group: Loose = {}, extra: Loose = {}) => {
  const g = { id: `${id}-g1`, type: 'checkbox', label: '공급(S)', groupKey: 'chk01', ...group };
  const choice = (n: number): Loose => ({
    id: `${id}-c${n}`,
    type: 'choice_opt',
    content: '',
    choiceGroupId: g.id,
    choiceLabel: `항목 ${n}`,
    optionCode: `opt${String(n).padStart(2, '0')}`,
    spssNumericCode: n,
  });
  return question({
    id,
    type: 'table',
    order,
    required: false,
    choiceGroups: [g],
    tableColumns: [col(1, { tag: id }), col(2, { tag: id })],
    tableRowsData: [1, 2, 3].map((n) => row(n, [text(`${id}-t${n}`, `항목 ${n}`), choice(n)])),
    ...extra,
  });
};
