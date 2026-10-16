import { splitEmailAddresses } from './split-email-addresses';

/**
 * 대체 발송(실패·반송 뒤 다음 순위 주소로 자동 재발송)이 고를 다음 주소 — 순수 판정.
 *
 * 후보는 발송 주소 순서(컬럼 설정 mailOrder, 미지정이면 column_key 오름차순)대로 정렬된, 값이 있는
 * 이메일 열들이다. 방금 실패·반송된 수신자가 쓴 열의 **다음** 열부터 본다.
 *
 * 비교는 칸이 아니라 **주소 하나하나**로 한다 — 한 칸에 「a / b」처럼 여럿 적힌 명단에서 칸 단위로 보면
 * 반송된 a 나 이미 보낸 a 가 다음 칸에 섞여 다시 나간다(2026-10-16 리뷰). 열의 주소 중
 *  - 대체 발송 사슬에서 이미 보낸 주소
 *  - 이 설문에서 반송된 것으로 확정된 주소(`isBouncedAddress`)
 * 를 빼고 남은 주소만 보낸다. 남는 주소가 없으면 그 열은 건너뛴다.
 * 주소 모양을 하나도 못 건지는 칸은 칸 전체 값으로 같은 판정을 한다(보내면 메일 서비스가 거부해 실패로 남는다).
 * 쓴 열을 모르면(0135 이전 수신자) 주소 값이 같은 열을 쓴 열로 보고, 그것도 없으면 처음부터 본다 —
 * 이미 보낸 주소는 위 규칙으로 빠지므로 처음부터 봐도 같은 주소로 다시 가지 않는다.
 */
export interface FallbackEmailCandidate {
  /** contact_pii.column_key */
  columnKey: string;
  /** 복호화한 값(공백 아님) */
  email: string;
}

export interface PickedFallbackAddress {
  columnKey: string;
  /** 발송 스냅샷 — 남은 주소만(여럿이면 쉼표로 잇는다. 발송기가 다시 나눈다) */
  email: string;
}

function lowerSet(values: Iterable<string>): Set<string> {
  return new Set([...values].map((v) => v.trim().toLowerCase()));
}

/**
 * 칸 하나에서 보낼 주소 — 제외할 주소를 뺀 나머지. 주소 모양이 없는 칸은 칸 값 하나로 판정한다.
 * 아무것도 빠지지 않았으면 원래 칸 값을 그대로 돌려줘 스냅샷이 명단 값과 같게 남는다(옛 수신자 값 대조용).
 */
export function remainingSendValue(
  cell: string,
  isExcluded: (address: string) => boolean,
): string | null {
  const addresses = splitEmailAddresses(cell);
  if (addresses.length === 0) return isExcluded(cell.trim()) ? null : cell;
  const remaining = addresses.filter((a) => !isExcluded(a));
  if (remaining.length === 0) return null;
  return remaining.length === addresses.length ? cell : remaining.join(', ');
}

export function pickFallbackAddress(args: {
  candidates: readonly FallbackEmailCandidate[];
  usedColumnKey: string | null;
  usedEmail: string | null;
  /** 대체 발송 사슬에서 이미 보낸 발송 스냅샷들(출처 수신자 포함) */
  triedEmails: readonly string[];
  /** 이 설문에서 반송된 것으로 확정된 주소인가 — 호출부가 blind index 로 판정한다 */
  isBouncedAddress: (address: string) => boolean;
}): PickedFallbackAddress | null {
  const { candidates, usedColumnKey, usedEmail, triedEmails, isBouncedAddress } = args;
  let start = usedColumnKey ? candidates.findIndex((c) => c.columnKey === usedColumnKey) : -1;
  if (start < 0 && usedEmail) {
    const used = usedEmail.trim();
    start = candidates.findIndex((c) => c.email.trim() === used);
  }
  const tried = new Set<string>();
  for (const snapshot of triedEmails) {
    const split = splitEmailAddresses(snapshot);
    for (const a of lowerSet(split.length > 0 ? split : [snapshot])) tried.add(a);
  }
  const isExcluded = (address: string) =>
    tried.has(address.trim().toLowerCase()) || isBouncedAddress(address);

  for (const candidate of candidates.slice(start + 1)) {
    const email = remainingSendValue(candidate.email, isExcluded);
    if (email !== null) return { columnKey: candidate.columnKey, email };
  }
  return null;
}

/** 대체 회차 제목 — 원래 제목 뒤에 「· 대체 발송」, 대체의 대체는 「· 대체 발송 2차」… */
export function fallbackCampaignTitle(parentTitle: string, parentIsFallback: boolean): string {
  const match = parentTitle.match(/^(.*) · 대체 발송(?: (\d+)차)?$/);
  if (!parentIsFallback || !match) return `${parentTitle} · 대체 발송`;
  const level = (match[2] ? Number(match[2]) : 1) + 1;
  return `${match[1]} · 대체 발송 ${level}차`;
}
