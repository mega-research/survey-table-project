import type { Question } from '@/types/survey';

/** 필수 미응답 안내 기본 문구 — 빌더 input placeholder 와 응답 화면 폴백의 SSOT. */
export const DEFAULT_REQUIRED_MESSAGE = '필수 질문에 답변해주세요.';

/** 필수 응답 셀 미응답 기본 문구 — 셀 모달 placeholder 와 숫자 검증 이슈 메시지의 SSOT. */
export const DEFAULT_REQUIRED_CELL_MESSAGE = '필수 응답이 비어있습니다';

/** 질문의 필수 안내 문구 — 사용자 지정이 공백뿐이면 기본 문구로 폴백. */
export function resolveRequiredMessage(
  question: Pick<Question, 'requiredMessage'>,
): string {
  const custom = question.requiredMessage?.trim();
  return custom || DEFAULT_REQUIRED_MESSAGE;
}
