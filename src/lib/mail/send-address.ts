import { splitEmailAddresses } from './split-email-addresses';

/**
 * 발송 주소 — 조사 대상 한 명에게 메일을 어느 주소로 보내는가의 규칙(순수, DB·암호화 없음).
 *
 * 후보는 이메일로 암호화된 명단 열을 발송 주소 순서(컬럼 설정 mailOrder, 미지정이면 column_key 오름차순)로
 * 늘어놓은 칸들이다. 순서대로 훑어 **보낼 수 있는 첫 칸**을 쓴다. 보낼 수 없는 칸:
 *  - 복호화에 실패한 칸 · 빈 칸
 *  - 칸째 제외된 칸 — 「a / b」 한 통이 반송된 칸은 어느 주소가 반송인지 몰라 칸 값 통째로 막는다
 *  - 칸 안 주소가 전부 제외된 칸 — 주소 하나로 보낸 메일이 반송된 주소는 다른 칸에 섞여 있어도 뺀다
 * 제외 판정(반송 주소 · 대체 발송 사슬에서 이미 보낸 주소)은 호출부가 넘긴다.
 *
 * 발송(createCampaign) · 사전 점검 · 대체 발송 · 단건 선검증 · 표시가 모두 이 규칙을 탄다 — DB 쪽 얼굴은
 * `server/read-models/send-address.ts`.
 */

/** 발송 주소 후보 칸 하나 — 발송 주소 순서대로 넘긴다. */
export interface SendAddressCell {
  /** contact_pii.column_key */
  columnKey: string;
  /** 복호화한 칸 값. null = 복호화 실패 */
  value: string | null;
}

export interface PickedSendAddress {
  columnKey: string;
  /** 발송 스냅샷 — 빠진 주소가 없으면 칸 값 그대로, 있으면 남은 주소만 쉼표로 잇는다(발송기가 다시 나눈다) */
  email: string;
}

/** 칸 값 또는 칸 안 주소 하나를 받아 보내지 않을 것인지 판정한다. */
export type SendAddressExclusion = (valueOrAddress: string) => boolean;

const NOTHING_EXCLUDED: SendAddressExclusion = () => false;

/**
 * 칸 하나에서 보낼 주소 — 제외할 주소를 뺀 나머지. 주소 모양이 없는 칸은 칸 값 하나로 판정한다.
 * 아무것도 빠지지 않았으면 원래 칸 값을 그대로 돌려줘 스냅샷이 명단 값과 같게 남는다(옛 수신자 값 대조용).
 */
export function remainingSendValue(cell: string, isExcluded: SendAddressExclusion): string | null {
  const addresses = splitEmailAddresses(cell);
  if (addresses.length === 0) return isExcluded(cell.trim()) ? null : cell;
  const remaining = addresses.filter((a) => !isExcluded(a));
  if (remaining.length === 0) return null;
  return remaining.length === addresses.length ? cell : remaining.join(', ');
}

/** 칸 하나에서 보낼 값 — 빈 칸 · 칸째 제외면 null, 아니면 제외된 주소를 뺀 나머지. */
export function sendableValue(cell: string, isExcluded: SendAddressExclusion): string | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  if (isExcluded(trimmed)) return null;
  return remainingSendValue(cell, isExcluded);
}

/** 순서대로 보낼 수 있는 첫 칸. 없으면 null. */
export function pickSendAddress(
  cells: readonly SendAddressCell[],
  isExcluded: SendAddressExclusion = NOTHING_EXCLUDED,
): PickedSendAddress | null {
  for (const { columnKey, value } of cells) {
    if (value === null) continue;
    const email = sendableValue(value, isExcluded);
    if (email !== null) return { columnKey, email };
  }
  return null;
}

/**
 * 조사 대상 한 명의 발송 주소 해석.
 * - send — 보낼 주소
 * - bounced — 쓸 수 있는 칸은 있었으나 전부 반송이라 보낼 곳이 없다
 * - missing — 쓸 수 있는 칸이 없다(이메일 열이 없거나 전부 비었거나 복호화 실패)
 */
export type SendAddressResolution =
  ({ kind: 'send' } & PickedSendAddress) | { kind: 'bounced' } | { kind: 'missing' };

export function resolveSendAddress(
  cells: readonly SendAddressCell[],
  isBounced: SendAddressExclusion = NOTHING_EXCLUDED,
): SendAddressResolution {
  const picked = pickSendAddress(cells, isBounced);
  if (picked) return { kind: 'send', ...picked };
  return pickSendAddress(cells) ? { kind: 'bounced' } : { kind: 'missing' };
}
