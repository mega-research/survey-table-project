/**
 * 회신 전달 규칙 (순수) — 보낸 사람 주소로 들어온 메일을 회신 주소로 넘길 때의 판정과 모양.
 *
 * DB·네트워크를 모른다. 조회는 `services/reply-address-lookup`, 엮는 진입점은 `services/reply-forward` 다.
 * 용어는 CONTEXT.md 「보낸이 계정」·「회신 주소」·「회신 전달」.
 */
import { addressParser, decodeWords } from 'postal-mime';

import { MAX_RECIPIENTS_PER_MAIL, splitEmailAddresses } from '@/lib/mail/split-email-addresses';

/** 전달 메일에 붙이는 발송 태그 — 상태 알림(webhook)에서 회신 전달 메일을 가려내는 표식. */
export const REPLY_FORWARD_TAG = { name: 'kind', value: 'reply-forward' } as const;

/**
 * 웹훅 장부(`webhook_events.event_type`)에 적는 회신 전달 결과.
 * 넘긴 건과 넘기지 않은 건을 갈라 적는다 — 시간당 상한이 「넘긴 건」만 센다.
 */
export const REPLY_FORWARD_EVENT_TYPE = {
  forwarded: 'email.received:forwarded',
  skipped: 'email.received:skipped',
} as const;
export type ReplyForwardLedgerOutcome = keyof typeof REPLY_FORWARD_EVENT_TYPE;

/**
 * 시간당 상한 — 최근 한 시간에 넘긴 건이 이만큼이면 더 넘기지 않는다.
 * 회신 전달은 설문 발송과 같은 발송 한도를 쓴다. 보낸 사람 주소로 메일을 쏟아부어도 설문 발송이 막히지 않게 한다.
 */
export const REPLY_FORWARD_HOURLY_CAP = 200;
export const REPLY_FORWARD_CAP_WINDOW_MS = 60 * 60 * 1000;

/**
 * 상태 알림에 실린 태그가 전달 메일의 것인가.
 * 알림의 태그는 `{ 이름: 값 }` 객체로 오지만, 발송 요청과 같은 `[{ name, value }]` 목록으로 와도 알아본다 —
 * 모양이 달라졌다고 반송 알림이 조용히 사라지면 안 된다.
 */
export function hasReplyForwardTag(tags: unknown): boolean {
  if (tags === null || typeof tags !== 'object') return false;
  if (Array.isArray(tags)) {
    return tags.some(
      (tag: unknown) =>
        tag !== null &&
        typeof tag === 'object' &&
        (tag as { name?: unknown }).name === REPLY_FORWARD_TAG.name &&
        (tag as { value?: unknown }).value === REPLY_FORWARD_TAG.value,
    );
  }
  return (tags as Record<string, unknown>)[REPLY_FORWARD_TAG.name] === REPLY_FORWARD_TAG.value;
}

/** 전달 메일이 회신 주소에 닿지 못했다는 상태 알림 — 회신 주소 오타·메일함 폐쇄·발송 거절. */
const REPLY_FORWARD_DELIVERY_FAILURE_EVENT_TYPES: readonly string[] = ['email.bounced', 'email.failed'];

export function isReplyForwardDeliveryFailure(eventType: string): boolean {
  return REPLY_FORWARD_DELIVERY_FAILURE_EVENT_TYPES.includes(eventType);
}

export const NO_SUBJECT_PLACEHOLDER = '(제목 없음)';
/** 본문이 아예 없는 메일(첨부만 보낸 스캔본) — 발송 API 가 본문 없는 메일을 받지 않아 채운다. */
export const NO_BODY_PLACEHOLDER = '(본문 없음)';

const DISPLAY_NAME_MAX_LENGTH = 100;
/** 받은 메일의 답장 주소를 그대로 옮길 때의 상한 — 헤더를 부풀린 메일이 발송 거절로 끝나지 않게. */
const MAX_REPLY_TO_ADDRESSES = 10;

/** 한 통에서 보는 보낸이 계정 수 상한 — 받는 주소를 부풀린 메일이 조회를 쏟아붓지 못하게. 운영 계정은 한 자릿수다. */
export const MAX_SENDER_ACCOUNTS = 10;

const LOOKS_LIKE_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** 주소의 도메인(소문자). `@` 가 없으면 빈 문자열. */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
}

/**
 * 받은 메일의 실제 수신 주소 목록에서 보낸이 계정(`@` 앞, 소문자)을 뽑는다.
 * 발송 전용 도메인의 주소만 보고, 받은 순서를 지키며 중복은 뺀다. 상한을 넘으면 앞에서부터 남긴다.
 */
export function extractSenderAccounts(receivedFor: readonly string[], sendDomain: string): string[] {
  const domain = sendDomain.trim().toLowerCase();
  const accounts: string[] = [];
  for (const raw of receivedFor) {
    const address = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    const at = address.lastIndexOf('@');
    if (at <= 0) continue;
    if (address.slice(at + 1) !== domain) continue;
    const account = address.slice(0, at);
    if (!accounts.includes(account)) accounts.push(account);
  }
  return accounts.slice(0, MAX_SENDER_ACCOUNTS);
}

export interface Mailbox {
  /** 표시 이름 — 없으면 빈 문자열. */
  name: string;
  address: string;
}

/** `이름 <주소>` 표기 하나를 읽는다. 주소 모양이 아니면 null. */
export function parseMailbox(raw: string): Mailbox | null {
  const [first] = addressParser(raw, { flatten: true });
  const address = first?.address?.trim();
  if (!address || !LOOKS_LIKE_ADDRESS.test(address)) return null;
  return { name: decodeWords(first?.name ?? '').trim(), address };
}

/**
 * 보낸 사람 이름 정제 — 응답자가 정한 글자가 전달 메일의 헤더를 깨지 못하게 한다.
 * 줄바꿈·탭은 공백으로, 그 밖의 제어 문자와 `<>"\` 는 걷어내고, 길이를 자른다.
 */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim();
}

/** RFC 5322 에서 따옴표 없이 표시 이름에 쓸 수 없는 글자(정제가 이미 걷어낸 `<>"\` 제외). */
const NEEDS_QUOTING = /[()[\]:;@,.]/;

/**
 * 전달 메일의 보낸 사람 표기 — 이름은 응답자가 쓴 이름(없으면 응답자 주소), 주소는 보낸이 계정.
 * 쉼표·`@` 같은 글자가 든 이름은 따옴표로 감싼다(안 감싸면 주소 둘로 읽힌다).
 */
export function formatForwardFrom(input: {
  senderName: string | null;
  senderAddress: string;
  senderAccount: string;
  sendDomain: string;
}): string {
  const name =
    sanitizeDisplayName(input.senderName ?? '') || sanitizeDisplayName(input.senderAddress);
  const address = `${input.senderAccount}@${input.sendDomain}`;
  if (!name) return address;
  return NEEDS_QUOTING.test(name) ? `"${name}" <${address}>` : `${name} <${address}>`;
}

/** 대소문자를 무시하고 먼저 온 표기를 남긴다. */
function dedupeAddresses(addresses: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of addresses) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

/**
 * DB 에 적힌 회신 주소 값들 → 전달 주소 후보. 받은 순서(호출부가 최근순으로 준다)를 지킨다.
 * 빈 값은 후보가 아니고, 발송 전용 도메인의 주소는 전달 주소가 될 수 없다 — 보낸 메일이 다시 들어와 고리가 된다.
 */
export function collectReplyAddresses(
  values: ReadonlyArray<string | null>,
  sendDomain: string,
): string[] {
  const domain = sendDomain.trim().toLowerCase();
  const addresses: string[] = [];
  for (const value of values) {
    if (!value) continue;
    for (const address of splitEmailAddresses(value)) {
      if (domainOf(address) === domain) continue;
      addresses.push(address);
    }
  }
  return dedupeAddresses(addresses);
}

/** 계정별 전달 주소를 한 통의 받는 사람으로 합친다. 상한을 넘으면 앞(최근)부터 남긴다. */
export function mergeForwardAddresses(lists: ReadonlyArray<readonly string[]>): string[] {
  return dedupeAddresses(lists.flat()).slice(0, MAX_RECIPIENTS_PER_MAIL);
}

export type CompanyDomainMatch =
  /** 보낸 사람이 발송 전용 도메인 — 우리가 보낸 메일이 되돌아온 것. */
  | { kind: 'send_domain' }
  /**
   * 보낸 사람이 전달 주소(회신 주소)와 같은 도메인 — 회사 메일함의 자동응답·자동 전달.
   * `external` 은 그 도메인이 발송 전용 도메인의 상위가 아닐 때다(회신 주소를 gmail 같은 외부 메일로 적은 템플릿).
   * 그 경우 같은 메일 서비스를 쓰는 응답자의 답장도 막히므로 호출부가 경고로 남긴다.
   */
  | { kind: 'reply_domain'; external: boolean };

/** 「회사 도메인에서 온 메일」인지 — 맞으면 넘기지 않는다(자동응답 고리를 끊는다). */
export function findCompanyDomainMatch(
  senderAddress: string,
  sendDomain: string,
  forwardAddresses: readonly string[],
): CompanyDomainMatch | null {
  const senderDomain = domainOf(senderAddress);
  const domain = sendDomain.trim().toLowerCase();
  if (senderDomain === domain) return { kind: 'send_domain' };
  if (!forwardAddresses.some((address) => domainOf(address) === senderDomain)) return null;
  return { kind: 'reply_domain', external: !domain.endsWith(`.${senderDomain}`) };
}

/** 받은 메일의 첨부 하나 — 내용은 base64 로 인코딩된 문자열. */
export interface ReceivedAttachment {
  filename: string | null;
  mimeType: string;
  /** 본문 속 이미지의 내용 ID(꺾쇠가 붙어 있어도 된다). 일반 첨부는 null. */
  contentId: string | null;
  contentBase64: string;
}

/** 받은 메일 한 통 — 조회 응답과 풀어 낸 원본에서 전달에 쓰는 것만. */
export interface ReceivedReply {
  /** 답장한 사람(응답자)의 주소. */
  senderAddress: string;
  /** 답장한 사람이 쓴 표시 이름. 없으면 null. */
  senderName: string | null;
  /** 받은 메일이 따로 지정한 답장 주소. 없으면 빈 배열. */
  replyTo: readonly string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  attachments: readonly ReceivedAttachment[];
}

export interface ForwardAttachment {
  filename: string;
  /** base64 문자열. */
  content: string;
  contentType: string;
  contentId?: string;
}

/** 전달 메일의 본문 — 발송 API 가 HTML·텍스트 가운데 하나는 있어야 받는다. */
export type ForwardBody = { html: string; text?: string } | { html?: never; text: string };

/** 발송 API 에 그대로 넘기는 전달 메일. */
export type ForwardMail = ForwardBody & {
  from: string;
  to: string[];
  replyTo: string[];
  subject: string;
  attachments: ForwardAttachment[];
  tags: Array<{ name: string; value: string }>;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function attachmentFilename(attachment: ReceivedAttachment, index: number): string {
  const name = attachment.filename?.trim();
  if (name) return name;
  const extension = EXTENSION_BY_MIME[attachment.mimeType.toLowerCase()];
  return extension ? `attachment-${index + 1}.${extension}` : `attachment-${index + 1}`;
}

function toForwardAttachment(attachment: ReceivedAttachment, index: number): ForwardAttachment {
  const contentId = attachment.contentId?.trim().replace(/^<|>$/g, '');
  return {
    filename: attachmentFilename(attachment, index),
    content: attachment.contentBase64,
    contentType: attachment.mimeType,
    ...(contentId ? { contentId } : {}),
  };
}

/**
 * 받은 메일을 전달 메일의 모양으로 바꾼다.
 * 받는 사람은 전달 주소뿐이다 — 원본의 참조·다른 받는 사람은 옮기지 않는다.
 */
export function buildForwardMail(input: {
  reply: ReceivedReply;
  /** 보낸 사람 주소에 쓰는 보낸이 계정. */
  senderAccount: string;
  sendDomain: string;
  forwardAddresses: readonly string[];
}): ForwardMail {
  const { reply } = input;
  const replyTo = dedupeAddresses(reply.replyTo).slice(0, MAX_REPLY_TO_ADDRESSES);
  const body: ForwardBody = reply.html
    ? { html: reply.html, ...(reply.text ? { text: reply.text } : {}) }
    : { text: reply.text || NO_BODY_PLACEHOLDER };
  return {
    from: formatForwardFrom({
      senderName: reply.senderName,
      senderAddress: reply.senderAddress,
      senderAccount: input.senderAccount,
      sendDomain: input.sendDomain,
    }),
    to: [...input.forwardAddresses],
    replyTo: replyTo.length > 0 ? replyTo : [reply.senderAddress],
    subject: reply.subject?.trim() ? reply.subject : NO_SUBJECT_PLACEHOLDER,
    ...body,
    attachments: reply.attachments.map(toForwardAttachment),
    tags: [{ ...REPLY_FORWARD_TAG }],
  };
}
