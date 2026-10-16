import { splitEmailAddresses } from './split-email-addresses';

/**
 * 대체 발송(실패·반송 뒤 다음 순위 주소로 자동 재발송)이 고를 다음 주소 — 순수 판정.
 *
 * 후보는 발송 주소 순서(컬럼 설정 mailOrder, 미지정이면 column_key 오름차순)대로 정렬된, 값이 있는
 * 이메일 열들이다. 방금 실패·반송된 수신자가 쓴 열의 **다음** 열부터 보고, 다음은 건너뛴다:
 *  - 대체 발송 사슬에서 이미 보낸 주소만 담긴 열(같은 주소를 두 열에 적은 명단)
 *  - 이 설문에서 반송된 적 있는 주소의 열(blind index 대조)
 * 쓴 열을 모르면(0135 이전 수신자) 주소 값이 같은 열을 쓴 열로 보고, 그것도 없으면 처음부터 본다 —
 * 이미 보낸 주소는 위 규칙으로 빠지므로 처음부터 봐도 같은 주소로 다시 가지 않는다.
 */
export interface FallbackEmailCandidate {
  /** contact_pii.column_key */
  columnKey: string;
  /** 복호화한 값(공백 아님) */
  email: string;
  /** contact_pii.blind_index — 형식이 안 맞으면 빈 문자열 */
  blindIndex: string;
}

function addressSet(value: string): Set<string> {
  const split = splitEmailAddresses(value);
  const list = split.length > 0 ? split : [value.trim()];
  return new Set(list.map((a) => a.toLowerCase()));
}

export function pickFallbackAddress(args: {
  candidates: readonly FallbackEmailCandidate[];
  usedColumnKey: string | null;
  usedEmail: string | null;
  /** 대체 발송 사슬에서 이미 보낸 주소들(출처 수신자 포함) */
  triedEmails: readonly string[];
  bouncedBlindIndexes: ReadonlySet<string>;
}): FallbackEmailCandidate | null {
  const { candidates, usedColumnKey, usedEmail, triedEmails, bouncedBlindIndexes } = args;
  let start = usedColumnKey ? candidates.findIndex((c) => c.columnKey === usedColumnKey) : -1;
  if (start < 0 && usedEmail) {
    const used = usedEmail.trim();
    start = candidates.findIndex((c) => c.email.trim() === used);
  }
  const tried = new Set<string>();
  for (const email of triedEmails) for (const a of addressSet(email)) tried.add(a);

  for (const candidate of candidates.slice(start + 1)) {
    if (candidate.blindIndex && bouncedBlindIndexes.has(candidate.blindIndex)) continue;
    const addresses = addressSet(candidate.email);
    if ([...addresses].every((a) => tried.has(a))) continue;
    return candidate;
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
