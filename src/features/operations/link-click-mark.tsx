import { linkClickLabel } from '@/lib/operations/filter-shared';
import type { LinkClickState } from '@/shared/contracts/mail-io';

/**
 * 「링크 클릭」 칸 — 조사 대상 목록과 단체 메일 위저드의 미리보기 표가 함께 쓴다(CONTEXT.md 「링크 클릭」).
 * 눌렀다는 것이지 응답했다는 것이 아니라 응답 상태 배지와 같은 모양을 쓰지 않는다 — 있음만 진하게,
 * 없음과 발송 이력 없음(—)은 흐리게. 색에만 기대지 않고 글자로 구분한다.
 */
export function LinkClickMark({ state }: { state: LinkClickState | null }) {
  const label = linkClickLabel(state);
  if (state === 'clicked') {
    return <span className="text-xs font-medium text-slate-900">{label}</span>;
  }
  // 「없음」은 필터로 고르는 값이라 읽혀야 한다(slate-500 — 흰 바탕 대비 4.5:1 이상). 값이 없는 칸의 — 만 흐리게.
  return state === 'not_clicked' ? (
    <span className="text-xs text-slate-500">{label}</span>
  ) : (
    <span className="text-xs text-slate-400">—</span>
  );
}
