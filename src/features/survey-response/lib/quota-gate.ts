import type { QuotaGate } from '@/shared/contracts/quota';

/**
 * 진행 중 마감(입장 뒤에 끊긴 응답자) 기본 문구 — 사과 톤. 서버가 돌려준 문구가 null 이면
 * (진행 중 마감 문구·마감 문구 둘 다 비어 있음) 이것을 쓴다. 입장 판정에서 막힌 응답자의
 * 기본 문구는 종전대로 already-responded-view 의 quota_closed body 다.
 * 편집 화면 미리보기(`features/operations/quota/quota-editor.tsx`)가 같은 값을 복제해 갖는다.
 */
export const QUOTA_MID_SURVEY_CLOSED_FALLBACK =
  '죄송합니다. 응답 중에 해당 조건의 모집이 완료되어 더 이상 진행하실 수 없습니다. 소중한 시간을 내어 참여해 주셔서 감사합니다.';

/** 입장 뒤에 막힌 응답자에게 보일 문구 — 서버 문구(폴백 적용 완료), 없으면 사과 톤 기본 문구. */
export function midSurveyClosedBody(serverMessage: string | null | undefined): string {
  return serverMessage && serverMessage.trim() ? serverMessage : QUOTA_MID_SURVEY_CLOSED_FALLBACK;
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 텍스트형 쿼터 차원의 대상 칸이 채워졌는가 — 필수 판정에 얹는 추가 조건.
 *
 * 쿼터 문항은 런타임 필수인데, 표 문항의 "답변됨"은 객체에 키가 하나라도 있으면 참이다. 대상
 * 칸에 셀 필수가 걸려 있지 않은 표에서는 다른 칸만 채우고 넘어갈 수 있고, 그러면 쿼터 확인은
 * 발동하지 않은 채(`shouldCheckQuota` = false) 미분류로 끝까지 완료된다 — 마감된 쿼터를 정상
 * 화면에서 우회하는 길이다. 발동 조건과 **같은 판정**을 필수 검증에도 걸어 그 틈을 막는다.
 * 게이트에 대상 칸이 등재되지 않은 문항은 언제나 true(관여하지 않는다).
 */
export function isQuotaTargetFilled(
  gate: QuotaGate | null | undefined,
  questionId: string,
  response: unknown,
): boolean {
  const cellIds = gate?.cellIdsByQuestion?.[questionId];
  if (!cellIds?.length) return true;
  return allQuotaQuestionsAnswered([questionId], { [questionId]: response }, { [questionId]: cellIds });
}

/**
 * 게이트 문항이 전부 답변됐는지. 빈 게이트는 false(발동 안 함).
 * 빈 문자열/빈 배열은 미답변으로 본다. `cellIdsByQuestion` 에 오른 문항(텍스트형 차원의 표)은
 * 대상 칸 중 하나라도 값이 있어야 답변이다 — 표 응답은 다른 칸만 채워도 객체가 생긴다.
 */
export function allQuotaQuestionsAnswered(
  questionIds: string[],
  answers: Record<string, unknown>,
  cellIdsByQuestion: Record<string, string[]> = {},
): boolean {
  if (questionIds.length === 0) return false;
  return questionIds.every((id) => {
    const v = answers[id];
    const cellIds = cellIdsByQuestion[id];
    if (!cellIds?.length) return hasValue(v);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const cells = v as Record<string, unknown>;
    return cellIds.some((cellId) => hasValue(cells[cellId]));
  });
}

/** 이번 「다음」에서 쿼터 확인을 발동할 것인가 — 문항 없는 플랜(속성형만)은 첫 전환에서 바로. */
export function shouldCheckQuota(
  gate: QuotaGate | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!gate) return false;
  if (gate.checkWithoutQuestions) return true;
  return allQuotaQuestionsAnswered(gate.questionIds, answers, gate.cellIdsByQuestion);
}
