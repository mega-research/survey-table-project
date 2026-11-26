/**
 * 결과코드 tone → 배지 색 class (회차 이력 표시용). 조사 대상 기능 하나만 쓰므로 그 묶음 안에 둔다
 * (`tests/repo/lib-residency.test.ts` — 부르는 곳이 features 뿐인 lib 파일은 없다).
 */

import type { ContactResultCode } from '@/shared/contracts/contacts';

export const RESULT_CODE_TONE_CLASS: Record<NonNullable<ContactResultCode['tone']>, string> = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
  blue: 'bg-blue-100 text-blue-700',
  slate: 'bg-slate-100 text-slate-700',
};

/** tone 이 화이트리스트 외 값이면 slate fallback. */
export function resultCodeToneClass(tone: ContactResultCode['tone']): string {
  return RESULT_CODE_TONE_CLASS[tone ?? 'slate'] ?? RESULT_CODE_TONE_CLASS.slate;
}

