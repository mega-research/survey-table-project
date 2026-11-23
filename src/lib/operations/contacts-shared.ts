/**
 * 컨택 도메인의 클라/서버 공용 helper.
 *
 * - 결과코드 tone → CSS class 매핑 (회차 이력 표시용)
 * - 공유 DateTimeFormat 인스턴스 (불필요한 중복 인스턴스화 방지)
 *
 * pure module — DB / 'server-only' import 없음.
 */

import type { ContactResultCode } from '@/shared/contracts/contacts';

// ─────────────────────────────────────────────────────────────────────────────
// 결과코드 tone → CSS
// ─────────────────────────────────────────────────────────────────────────────

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

