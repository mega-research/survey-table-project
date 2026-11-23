import type { HeaderFilterEntry } from '@/features/operations/filters/header-filter-url';
import { RECIPIENT_FILTER_SOURCE } from '@/lib/operations/filter-shared';

/**
 * 발송 회차 수신자 표가 받는 열 머리 조건 — 메모(반송·실패 사유)와 최근 결과코드의 체크박스(in) 조건뿐이다.
 *
 * 받지 못하는 조건은 버리되 **몇 개를 버렸는지 알린다**. 그룹 칸을 빼기 전(2026-11-23)에 저장해 둔 주소
 * (`hcol=recipient.group`)로 들어오면 그 조건이 빠져 명단이 넓어지는데, 말없이 넓히면 특정 그룹만 보던
 * 주소가 회차 전체를 보여 준다 — 화면이 이 수로 경고한다.
 */
export function splitRecipientHeaderEntries(entries: readonly HeaderFilterEntry[]): {
  accepted: HeaderFilterEntry[];
  droppedCount: number;
} {
  const accepted = entries.filter(
    (e) =>
      e.mode === 'in' &&
      (e.source === RECIPIENT_FILTER_SOURCE.ERROR || e.source === RECIPIENT_FILTER_SOURCE.RESULT),
  );
  return { accepted, droppedCount: entries.length - accepted.length };
}
