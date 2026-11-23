/**
 * 컨택 도메인의 클라/서버 공용 helper.
 *
 * - 컬럼 스킴 → 그룹 값을 읽을 attrs 열 (조사 대상 추가·수정 화면)
 * - 결과코드 tone → CSS class 매핑 (회차 이력 표시용)
 * - 공유 DateTimeFormat 인스턴스 (불필요한 중복 인스턴스화 방지)
 *
 * pure module — DB / 'server-only' import 없음.
 */

import { attrsKeyOf } from './contacts-format';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import type { NormalizedContactColumnScheme } from '@/lib/operations/contacts-format';

// ─────────────────────────────────────────────────────────────────────────────
// 시스템 필드 추출
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemFieldKeys {
  group?: string;
}

/**
 * 조사 대상을 추가·수정할 때 그룹 값(group_value)을 읽어 올 attrs 열.
 *
 * 컬럼 설정의 분류 기준이 있으면 그 대분류 열이다 — 업로드가 그룹 값을 채우는 열과 같다.
 * 분류 기준이 없는 옛 설문만 종전대로 열 이름으로 찾는다(「전시회」·「단체 메일」이 든 첫 열).
 * 분류 기준이 있는데도 이름으로 찾으면, 대분류가 아닌 열(「전시회ID」 등)의 값이 저장할 때마다
 * 그룹 값을 덮는다(2026-11-23 국내전시회 설문 — 314명의 그룹이 전시회ID 숫자로 바뀌었다).
 * 못 찾으면 비운다 — 수정은 기존 그룹 값을 그대로 둔다.
 */
export function extractSystemFieldKeys(scheme: NormalizedContactColumnScheme): SystemFieldKeys {
  const top = resolveGroupCriteria(scheme)[0];
  if (top) return { group: top.key };

  const result: SystemFieldKeys = {};
  for (const c of scheme.columns) {
    const k = attrsKeyOf(c.source);
    if (!k) continue;
    if (!result.group && (k.includes('전시회') || k.includes('단체 메일'))) result.group = k;
  }
  return result;
}

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

