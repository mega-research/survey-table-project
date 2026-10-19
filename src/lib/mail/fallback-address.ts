import { type PickedSendAddress, type SendAddressCell, pickSendAddress } from './send-address';
import { splitEmailAddresses } from './split-email-addresses';

/**
 * 대체 발송(실패·반송 뒤 다음 순위 주소로 자동 재발송)이 고를 다음 주소 — 순수 판정.
 *
 * 후보는 발송 주소 칸들(`SendAddressCell`, 발송 주소 순서대로)이다. 방금 실패·반송된 수신자가 쓴 열의
 * **다음** 열부터 발송과 같은 규칙(`pickSendAddress`)으로 고른다 — 제외하는 것은
 *  - 대체 발송 사슬에서 이미 보낸 주소
 *  - 이 설문에서 반송된 것으로 확정된 칸·주소(`isBouncedAddress`)
 * 비교는 칸이 아니라 주소 하나하나로도 한다 — 한 칸에 「a / b」처럼 여럿 적힌 명단에서 칸 단위로만 보면
 * 반송된 a 나 이미 보낸 a 가 다음 칸에 섞여 다시 나간다(2026-10-16 리뷰). 칸째 반송된 칸(여러 주소 한 통의
 * 반송)은 칸 안 주소가 멀쩡해 보여도 건너뛴다 — 단체 발송과 같다(2026-10-19).
 * 쓴 열을 모르면(0135 이전 수신자) 주소 값이 같은 열을 쓴 열로 보고, 그것도 없으면 처음부터 본다 —
 * 이미 보낸 주소는 위 규칙으로 빠지므로 처음부터 봐도 같은 주소로 다시 가지 않는다.
 */
function lowerSet(values: Iterable<string>): Set<string> {
  return new Set([...values].map((v) => v.trim().toLowerCase()));
}

export function pickFallbackAddress(args: {
  candidates: readonly SendAddressCell[];
  usedColumnKey: string | null;
  usedEmail: string | null;
  /** 대체 발송 사슬에서 이미 보낸 발송 스냅샷들(출처 수신자 포함) */
  triedEmails: readonly string[];
  /** 이 설문에서 반송된 칸 값·주소인가 — 호출부가 blind index 로 판정한다 */
  isBouncedAddress: (address: string) => boolean;
}): PickedSendAddress | null {
  const { candidates, usedColumnKey, usedEmail, triedEmails, isBouncedAddress } = args;
  let start = usedColumnKey ? candidates.findIndex((c) => c.columnKey === usedColumnKey) : -1;
  if (start < 0 && usedEmail) {
    const used = usedEmail.trim();
    start = candidates.findIndex((c) => c.value?.trim() === used);
  }
  const tried = new Set<string>();
  for (const snapshot of triedEmails) {
    const split = splitEmailAddresses(snapshot);
    for (const a of lowerSet(split.length > 0 ? split : [snapshot])) tried.add(a);
  }
  return pickSendAddress(
    candidates.slice(start + 1),
    (value) => tried.has(value.trim().toLowerCase()) || isBouncedAddress(value),
  );
}

/** 대체 회차 제목 — 원래 제목 뒤에 「· 대체 발송」, 대체의 대체는 「· 대체 발송 2차」… */
export function fallbackCampaignTitle(parentTitle: string, parentIsFallback: boolean): string {
  const match = parentTitle.match(/^(.*) · 대체 발송(?: (\d+)차)?$/);
  if (!parentIsFallback || !match) return `${parentTitle} · 대체 발송`;
  const level = (match[2] ? Number(match[2]) : 1) + 1;
  return `${match[1]} · 대체 발송 ${level}차`;
}
