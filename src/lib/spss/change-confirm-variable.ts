/**
 * 변동 확인(추적조사) 내보내기 변수 — CONTEXT.md > 추적조사 참조.
 *
 * 응답자가 문항마다 "지난 회차와 같음 / 달라짐"을 밝힌 결과를 문항 변수 옆에 별도
 * 변수로 내보낸다. "지난 회차와 같다고 답한 사람이 몇 명인가"는 추적조사의 핵심
 * 지표라, 응답 값만으로는 낼 수 없다 — "같음"은 지난 회차 값을 그대로 복사하므로
 * 값만 보면 확인한 사람과 확인하지 않은 사람이 구분되지 않는다.
 */

import {
  readChangeConfirmations,
  type ChangeConfirmation,
} from '@/lib/survey/change-confirmation';

/** 문항 변수명에 붙는 접미. 결과 변수명은 `{questionCode}_CHG`. */
export const CHANGE_CONFIRM_VAR_SUFFIX = '_CHG';

/** SPSS 숫자 코드. 값 라벨·코딩북·데이터 변환이 이 표 하나를 공유한다. */
const SPSS_CODES: Record<ChangeConfirmation, number> = { same: 1, changed: 2 };

/** 변수의 값 라벨. 작은 값부터(SPSS 변수보기 표시 순서). */
export const CHANGE_CONFIRM_VALUE_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: SPSS_CODES.same, label: '지난 회차와 같음' },
  { value: SPSS_CODES.changed, label: '달라짐' },
];

/** 변수 라벨 접미 — `{문항 제목} - 변동 확인`. */
export const CHANGE_CONFIRM_LABEL_SUFFIX = '변동 확인';

/** 코딩북 "값 라벨" 셀 문자열. 결측의 의미를 함께 적는다. */
export const CHANGE_CONFIRM_CODEBOOK_VALUE_LABEL = `${CHANGE_CONFIRM_VALUE_LABELS.map(
  (vl) => `${vl.value}=${vl.label}`,
).join(', ')}, 빈값=미확인`;

/** 문항 변수명에서 변동 확인 변수명을 파생한다. */
export function buildChangeConfirmVarName(questionCode: string): string {
  return `${questionCode}${CHANGE_CONFIRM_VAR_SUFFIX}`;
}

/**
 * 한 응답의 이 문항 변동 확인 값. 밝히지 않았거나 도달하지 못했으면 결측(null).
 * 형태가 깨진 사이드카는 읽기 경계에서 흡수된다.
 */
export function resolveChangeConfirmValue(
  questionResponses: Record<string, unknown> | null | undefined,
  questionId: string,
): number | null {
  const confirmation = readChangeConfirmations(questionResponses)[questionId];
  return confirmation ? SPSS_CODES[confirmation] : null;
}
