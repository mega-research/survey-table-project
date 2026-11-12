/**
 * 답장 중계 규칙 (순수) — 담당자가 전달받은 메일에 한 답장을 응답자에게 넘길 때의 판정과 모양.
 *
 * 답장 주소를 무시하고 보낸 사람 주소로 답장하는 메일 시스템이 있다(회사 메일이 그렇다). 그래서 전달 메일의
 * 보낸 사람 주소에 「누구의 답장인가」를 서명과 함께 담아 두고(중계 주소), 회사 도메인에서 그 주소로 온 메일을
 * 그 응답자에게 넘긴다. DB 에는 아무것도 저장하지 않는다 — 주소가 스스로 말하고 서명이 그것을 보증한다.
 *
 * DB·네트워크·Node 를 모른다. 서명은 `RelaySigner` 로 받는다(`services/reply-relay-signer`).
 * 용어는 CONTEXT.md 「답장 중계」.
 */
import { MAX_RECIPIENTS_PER_MAIL } from '@/lib/mail/split-email-addresses';

import {
  REPLY_FORWARD_MARK_HEADER,
  composeForwardedMail,
  domainOf,
  formatForwardFrom,
  forwardReplyTo,
  type ForwardMail,
  type MailHeader,
  type OmitAttachmentsReason,
  type ReceivedReply,
} from './reply-forward';

/** 중계 메일에 붙이는 발송 태그 — 상태 알림(webhook)에서 답장 중계 메일을 가려내는 표식. */
export const REPLY_RELAY_TAG = { name: 'kind', value: 'reply-relay' } as const;

/**
 * 중계 메일에 붙이는 헤더 — 회신 전달과 같은 자체 표식 하나뿐이다.
 * `Auto-Submitted` 는 붙이지 않는다: 사람(담당자)이 쓴 답장이고, 붙이면 받는 쪽이 자동 메일로 다룬다.
 */
export const REPLY_RELAY_HEADERS: Readonly<Record<string, string>> = {
  [REPLY_FORWARD_MARK_HEADER]: '1',
};

/** 서명의 길이 — HMAC-SHA256 의 소문자 16진 앞 10자(40비트). */
export const RELAY_SIGNATURE_LENGTH = 10;
/** 주소의 `@` 앞 길이 상한(RFC 5321). 넘으면 중계 주소를 쓰지 않는다. */
export const RELAY_LOCAL_PART_MAX_LENGTH = 64;

/**
 * 중계 주소의 서명기. 구현은 `services/reply-relay-signer`(Node 의 HMAC) — 도메인은 Node 를 모른다.
 * 키를 바꾸면 이미 나간 전달 메일의 중계 주소가 전부 죽는다.
 */
export interface RelaySigner {
  /** 재료의 서명 — 소문자 16진 `RELAY_SIGNATURE_LENGTH` 자. */
  sign(material: string): string;
  /** 서명이 재료의 것인가. 비교는 상수 시간으로 한다. */
  matches(material: string, signature: string): boolean;
}

/**
 * 서명의 재료 — 용도 구분 접두 + 보낸이 계정 + 응답자 주소, 전부 소문자.
 * 접두는 같은 키로 만든 다른 서명(웹훅 서명)과 섞이지 않게 한다. 계정에는 `:` 가 올 수 없어 경계가 흔들리지 않는다.
 * 소문자로 만드는 까닭: 메일 시스템이 주소를 소문자로 바꿔도 서명이 맞아야 한다.
 */
function relaySignatureMaterial(senderAccount: string, respondentAddress: string): string {
  return `reply-relay:v1:${senderAccount.toLowerCase()}:${respondentAddress.toLowerCase()}`;
}

/**
 * 중계 주소로 옮길 수 있는 응답자 주소의 글자 — 따옴표 없이 `@` 앞에 올 수 있는 글자 가운데 흔한 것만.
 * 좁게 잡는다: 여기서 빠진 주소는 중계 주소 대신 안내 한 줄을 받는다(메일이 막히지 않는다).
 * `=` 과 `+` 는 구분자이기도 하지만 풀 때 오른쪽부터 끊고 계정은 첫 `+` 로 가르므로 `@` 앞에 있어도 된다.
 */
const RELAYABLE_LOCAL_PART = /^[A-Za-z0-9_+=-]+(?:\.[A-Za-z0-9_+=-]+)*$/;
const RELAYABLE_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const SIGNATURE_SHAPE = new RegExp(`^[0-9a-f]{${RELAY_SIGNATURE_LENGTH}}$`);

function splitAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return null;
  return { localPart: address.slice(0, at), domain: address.slice(at + 1) };
}

/**
 * 중계 주소의 `@` 앞 — `보낸이 계정+<응답자 주소의 @ 앞>=<응답자 도메인>=<서명>`.
 * 응답자 주소의 대소문자는 그대로 싣는다(서명은 소문자로 만든다).
 * 전체가 64자를 넘거나 응답자 주소에 옮길 수 없는 글자가 있으면 null — 호출부가 안내 한 줄로 물러난다.
 */
export function buildRelayLocalPart(input: {
  senderAccount: string;
  respondentAddress: string;
  signer: RelaySigner;
}): string | null {
  const parts = splitAddress(input.respondentAddress);
  if (!parts) return null;
  if (!RELAYABLE_LOCAL_PART.test(parts.localPart) || !RELAYABLE_DOMAIN.test(parts.domain)) return null;

  const account = input.senderAccount.toLowerCase();
  const signature = input.signer.sign(relaySignatureMaterial(account, input.respondentAddress));
  const localPart = `${account}+${parts.localPart}=${parts.domain}=${signature}`;
  return localPart.length > RELAY_LOCAL_PART_MAX_LENGTH ? null : localPart;
}

/** 서명이 맞는 중계 주소가 가리키는 것 — 어느 보낸이 계정으로, 어느 응답자에게. */
export interface RelayTarget {
  senderAccount: string;
  /** 주소에 실려 온 그대로(대소문자 포함). */
  respondentAddress: string;
}

/**
 * 중계 주소를 푼다 — **서명이 맞을 때만** 응답자 주소를 돌려준다.
 *
 * 오른쪽부터 끊는다: 마지막 `=` 뒤가 서명, 그 앞 `=` 뒤가 도메인, 나머지가 응답자 주소의 `@` 앞(여기에 `=` 가 있어도 된다).
 * 계정과 꼬리는 첫 `+` 로 가른다. 서명은 대소문자를 가리지 않는다.
 * 모양이 다르거나 서명이 틀리면 null — 그 주소는 보낸이 계정의 주소로만 다뤄진다(`extractSenderAccounts`).
 * 넘길 곳이 이 함수에서만 나와야 한다: 서명 없이 주소를 읽으면 누구나 우리 도메인으로 임의 주소에 메일을 보낸다.
 */
export function parseRelayAddress(
  address: string,
  sendDomain: string,
  signer: RelaySigner,
): RelayTarget | null {
  const parts = splitAddress(address.trim().replace(/^<|>$/g, ''));
  if (!parts || parts.domain.toLowerCase() !== sendDomain.trim().toLowerCase()) return null;

  const plus = parts.localPart.indexOf('+');
  if (plus <= 0) return null;
  const senderAccount = parts.localPart.slice(0, plus).toLowerCase();
  const tail = parts.localPart.slice(plus + 1);

  const signatureAt = tail.lastIndexOf('=');
  if (signatureAt < 0) return null;
  const signature = tail.slice(signatureAt + 1).toLowerCase();
  const rest = tail.slice(0, signatureAt);
  const domainAt = rest.lastIndexOf('=');
  if (domainAt <= 0) return null;
  const respondentLocalPart = rest.slice(0, domainAt);
  const respondentDomain = rest.slice(domainAt + 1);

  if (!SIGNATURE_SHAPE.test(signature)) return null;
  if (!RELAYABLE_LOCAL_PART.test(respondentLocalPart) || !RELAYABLE_DOMAIN.test(respondentDomain)) return null;

  const respondentAddress = `${respondentLocalPart}@${respondentDomain}`;
  if (!signer.matches(relaySignatureMaterial(senderAccount, respondentAddress), signature)) return null;
  return { senderAccount, respondentAddress };
}

/**
 * 받은 메일의 실제 수신 주소 가운데 서명이 맞는 중계 주소가 가리키는 응답자들.
 * 받은 순서를 지키고 같은 응답자는 한 번만(대소문자 무시). 한 통의 수신자 상한을 넘으면 앞에서부터 남긴다.
 * 응답자 주소가 발송 전용 도메인이면 뺀다 — 그리로 넘긴 메일은 다시 들어온다.
 */
export function extractRelayTargets(
  receivedFor: readonly string[],
  sendDomain: string,
  signer: RelaySigner,
): RelayTarget[] {
  const domain = sendDomain.trim().toLowerCase();
  const seen = new Set<string>();
  const targets: RelayTarget[] = [];
  for (const raw of receivedFor) {
    if (targets.length >= MAX_RECIPIENTS_PER_MAIL) break;
    const target = parseRelayAddress(raw, sendDomain, signer);
    if (!target || domainOf(target.respondentAddress) === domain) continue;
    const key = target.respondentAddress.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

/**
 * 전달 메일의 「답장」이 가야 할 응답자 주소 — 전달 메일의 답장 주소로 쓰는 바로 그 주소의 첫 번째
 * (받은 메일이 따로 지정한 답장 주소, 없으면 보낸 사람 주소). 중계 주소에 담는 것이 이것이다.
 */
export function relayTargetAddress(reply: Pick<ReceivedReply, 'senderAddress' | 'replyTo'>): string {
  return forwardReplyTo(reply)[0] ?? reply.senderAddress;
}

const AUTO_REPLY_MARKER_HEADERS: ReadonlySet<string> = new Set(['x-autoreply', 'x-autorespond']);
const AUTO_PRECEDENCE_VALUES: ReadonlySet<string> = new Set(['bulk', 'junk', 'auto_reply']);

/**
 * 자동으로 만들어진 메일인가 — 답장 중계는 사람이 쓴 답장만 넘긴다.
 *
 * 회사 메일함의 부재중 자동응답이 중계 주소로 돌아오면 그것이 응답자에게 가고, 응답자 쪽 자동응답이 다시 돌아와
 * 두 자동응답이 서로 주고받는다. `Auto-Submitted` 가 `no` 가 아닌 값(RFC 3834)이거나, 자동응답 표식 헤더
 * (`X-Autoreply`·`X-Autorespond`)나 `Precedence: bulk|junk|auto_reply` 가 있으면 자동 메일이다.
 *
 * 회신 전달(응답자 → 담당자)은 이 판정을 쓰지 않는다 — 응답자의 부재중 자동응답은 넘긴다.
 */
export function isAutoGeneratedMail(headers: readonly MailHeader[]): boolean {
  return headers.some((header) => {
    const key = header.key.trim().toLowerCase();
    if (AUTO_REPLY_MARKER_HEADERS.has(key)) return true;
    const value = header.value.split(';')[0]?.trim().toLowerCase() ?? '';
    if (key === 'auto-submitted') return value !== '' && value !== 'no';
    if (key === 'precedence') return AUTO_PRECEDENCE_VALUES.has(value);
    return false;
  });
}

/** 상태 알림에 실린 태그가 답장 중계 메일의 것인가. 알림의 객체 모양과 발송 요청의 목록 모양을 둘 다 알아본다. */
export function hasReplyRelayTag(tags: unknown): boolean {
  if (tags === null || typeof tags !== 'object') return false;
  if (Array.isArray(tags)) {
    return tags.some(
      (tag: unknown) =>
        tag !== null &&
        typeof tag === 'object' &&
        (tag as { name?: unknown }).name === REPLY_RELAY_TAG.name &&
        (tag as { value?: unknown }).value === REPLY_RELAY_TAG.value,
    );
  }
  return (tags as Record<string, unknown>)[REPLY_RELAY_TAG.name] === REPLY_RELAY_TAG.value;
}

export interface RelayMailInput {
  /** 담당자가 보낸 답장. `senderAddress`·`senderName` 은 담당자의 것이다. */
  reply: ReceivedReply;
  /** 보낸 사람 주소에 쓰는 보낸이 계정 — 중계 주소에 담겨 있던 계정. */
  senderAccount: string;
  sendDomain: string;
  /** 받는 사람 — 서명이 맞는 중계 주소가 가리킨 응답자 주소뿐이다. */
  respondentAddresses: readonly string[];
  /** 첨부를 싣지 않고 본문 맨 위에 안내를 붙인다 — 회신 전달과 같다. */
  omitAttachments?: boolean;
  omitReason?: OmitAttachmentsReason;
}

/**
 * 담당자의 답장을 응답자에게 넘기는 메일의 모양.
 * 받는 사람은 응답자뿐이고(원본의 참조·다른 받는 사람은 옮기지 않는다), 보낸 사람은 담당자가 쓴 이름에
 * 보낸이 계정 주소(중계 꼬리 없음), 답장 주소는 담당자의 주소다. 제목·본문·첨부는 받은 그대로다.
 */
export function buildRelayMail(input: RelayMailInput): ForwardMail {
  const { reply } = input;
  return composeForwardedMail({
    reply,
    envelope: {
      from: formatForwardFrom({
        senderName: reply.senderName,
        senderAddress: reply.senderAddress,
        senderAccount: input.senderAccount,
        sendDomain: input.sendDomain,
      }),
      to: input.respondentAddresses,
      replyTo: forwardReplyTo(reply),
      headers: REPLY_RELAY_HEADERS,
      tags: [REPLY_RELAY_TAG],
    },
    audience: 'respondent',
    ...(input.omitAttachments !== undefined ? { omitAttachments: input.omitAttachments } : {}),
    ...(input.omitReason !== undefined ? { omitReason: input.omitReason } : {}),
  });
}
