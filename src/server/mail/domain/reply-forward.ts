/**
 * 회신 전달 규칙 (순수) — 보낸 사람 주소로 들어온 메일을 회신 주소로 넘길 때의 판정과 모양.
 *
 * DB·네트워크를 모른다. 조회는 `services/reply-address-lookup`, 엮는 진입점은 `services/reply-forward` 다.
 * 용어는 CONTEXT.md 「보낸이 계정」·「회신 주소」·「회신 전달」.
 */
import { addressParser, decodeWords } from 'postal-mime';

import { MAX_RECIPIENTS_PER_MAIL, splitEmailAddresses } from '@/lib/mail/split-email-addresses';
import { formatBytes } from '@/lib/utils';

/** 전달 메일에 붙이는 발송 태그 — 상태 알림(webhook)에서 회신 전달 메일을 가려내는 표식. */
export const REPLY_FORWARD_TAG = { name: 'kind', value: 'reply-forward' } as const;

/**
 * 전달 메일에 붙이는 헤더 — 고리를 끊는 표식.
 * 자체 표식은 전달 메일이 (자동 전달·반송으로) 보낸 사람 주소에 되돌아왔을 때 알아보는 데 쓰고,
 * `Auto-Submitted: auto-forwarded`(RFC 3834)는 받는 쪽 메일 서버가 자동응답을 돌려보내지 않게 한다.
 */
export const REPLY_FORWARD_MARK_HEADER = 'X-Survey-Reply-Forward';
export const REPLY_FORWARD_HEADERS: Readonly<Record<string, string>> = {
  [REPLY_FORWARD_MARK_HEADER]: '1',
  'Auto-Submitted': 'auto-forwarded',
};

/** 받은 메일의 헤더 한 줄. 이름의 대소문자는 가리지 않는다. */
export interface MailHeader {
  key: string;
  value: string;
}

/** 넘기면 고리가 되는 메일 — 우리 표식을 단 메일(`forward_mark`)과 배달 상태 통지(`delivery_report`). */
export type ForwardLoopSignal = 'forward_mark' | 'delivery_report';

const DELIVERY_REPORT_SENDERS: ReadonlySet<string> = new Set(['mailer-daemon', 'postmaster']);
const MULTIPART_REPORT = /^\s*multipart\/report\b/i;
const DELIVERY_STATUS_REPORT = /report-type\s*=\s*"?delivery-status"?/i;

/**
 * 받은 메일이 넘기면 고리가 되는 메일인가.
 *
 * - 우리 표식 헤더가 있다 — 전달 메일이 되돌아온 것이다. 다시 넘기면 끝없이 돈다.
 * - 배달 상태 통지다 — `multipart/report` 의 `delivery-status`, 또는 보낸 사람이 `mailer-daemon`·`postmaster`.
 *   전달 메일의 반송 통지가 보낸 사람 주소로 오면, 그것을 넘긴 메일이 또 반송되어 돈다.
 *
 * 응답자 메일 서버의 부재중 자동응답(`Auto-Submitted: auto-replied`)과 읽음 확인은 고리가 아니다 — 넘긴다.
 */
export function detectForwardLoop(input: {
  senderAddress: string;
  headers: readonly MailHeader[];
}): ForwardLoopSignal | null {
  const mark = REPLY_FORWARD_MARK_HEADER.toLowerCase();
  if (input.headers.some((header) => header.key.toLowerCase() === mark)) return 'forward_mark';

  const at = input.senderAddress.lastIndexOf('@');
  const localPart = (at < 0 ? input.senderAddress : input.senderAddress.slice(0, at)).trim().toLowerCase();
  if (DELIVERY_REPORT_SENDERS.has(localPart)) return 'delivery_report';

  const isDeliveryReport = input.headers.some(
    (header) =>
      header.key.toLowerCase() === 'content-type' &&
      MULTIPART_REPORT.test(header.value) &&
      DELIVERY_STATUS_REPORT.test(header.value),
  );
  return isDeliveryReport ? 'delivery_report' : null;
}

/**
 * 웹훅 장부(`webhook_events.event_type`)에 적는 회신 전달 결과.
 * 넘긴 건과 넘기지 않은 건을 갈라 적는다. 이 줄의 id 는 알림 id 그대로라 「이미 처리한 알림」 판정에 쓰인다.
 */
export const REPLY_FORWARD_EVENT_TYPE = {
  forwarded: 'email.received:forwarded',
  skipped: 'email.received:skipped',
} as const;
export type ReplyForwardLedgerOutcome = keyof typeof REPLY_FORWARD_EVENT_TYPE;

/**
 * 시간당 상한이 세는 「자리」 줄의 종류 — 발송 **전에** 잡는다.
 * 결과 줄과 종류도 id 도 다르다: 자리만 잡고 실패한 알림이 「이미 처리한 알림」으로 보이면 재시도가 그 메일을 버린다.
 */
export const REPLY_FORWARD_SLOT_EVENT_TYPE = 'email.received:slot';

/** 자리 줄의 id — 알림 id 에서 파생한다. 같은 알림의 재시도는 같은 자리를 다시 쓴다. */
export function replyForwardSlotId(eventId: string): string {
  return `${eventId}:reply-forward-slot`;
}

/**
 * 시간당 상한 — 최근 한 시간에 잡힌 자리가 이만큼이면 더 넘기지 않는다.
 * 회신 전달은 설문 발송과 같은 발송 한도를 쓴다. 보낸 사람 주소로 메일을 쏟아부어도 설문 발송이 막히지 않게 한다.
 * 자리는 발송이 실패해도 한 시간 동안 센다(보수적) — 상한은 「나간 메일」이 아니라 「발송을 시도한 메일」의 수다.
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

/**
 * 전달 메일이 회신 주소에 닿지 못했다는(또는 앞으로 닿지 못하게 됐다는) 상태 알림.
 * - `email.bounced`·`email.failed`: 회신 주소 오타·메일함 폐쇄·발송 거절.
 * - `email.suppressed`: 이전에 반송·신고된 주소라 발송 서비스가 아예 보내지 않았다. 한 번 반송된 회신 주소는
 *   그 뒤로 반송이 아니라 이것으로만 알려 온다 — 빼면 두 번째 답장부터 조용히 사라진다.
 * - `email.complained`: 담당자가 전달 메일을 스팸으로 신고했다. 그 주소는 수신 거부 목록에 들어 다음부터 위와 같이 된다.
 */
const REPLY_FORWARD_DELIVERY_FAILURE_EVENT_TYPES: readonly string[] = [
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
];

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
  /**
   * 원본 파트에 붙어 있던 내용 ID(꺾쇠가 붙어 있어도 된다). 없으면 null.
   * 이것만으로는 본문 속 이미지가 아니다 — 일반 PDF 에 내용 ID 를 붙여 보내는 메일 프로그램이 있다(`isInlineImage`).
   */
  contentId: string | null;
  /** 원본 풀기가 본문 속(`multipart/related`) 파트라고 한 첨부. */
  related?: boolean;
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
  /** 고리 표식 — `REPLY_FORWARD_HEADERS`. */
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * 파일 이름은 응답자가 정한 글자다 — 줄바꿈·제어 문자를 공백으로 바꾸고 앞뒤 공백을 걷는다.
 * 발송 요청의 첨부 이름과 안내문의 파일 목록이 함께 쓴다(헤더·안내의 줄을 흉내 내지 못하게).
 */
function cleanFilename(filename: string): string {
  return filename
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attachmentFilename(attachment: ReceivedAttachment, index: number): string {
  const name = cleanFilename(attachment.filename ?? '');
  if (name) return name;
  const extension = EXTENSION_BY_MIME[attachment.mimeType.toLowerCase()];
  return extension ? `attachment-${index + 1}.${extension}` : `attachment-${index + 1}`;
}

function bareContentId(attachment: ReceivedAttachment): string {
  return attachment.contentId?.trim().replace(/^<|>$/g, '').trim() ?? '';
}

/** HTML 본문에서 `cid:` 참조를 뽑는다(소문자). 따옴표·꺾쇠·공백에서 끊는다. */
function referencedContentIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(/cid:([^"'\s<>)]+)/gi)) {
    const raw = match[1];
    if (!raw) continue;
    ids.add(raw.toLowerCase());
    try {
      ids.add(decodeURIComponent(raw).toLowerCase());
    } catch {
      // 잘못된 퍼센트 인코딩 — 글자 그대로만 본다.
    }
  }
  return ids;
}

/**
 * 본문 속 이미지인가 — 내용 ID 를 발송으로 넘길지와 안내의 「본문 속 이미지」 표시가 이 판정 하나를 쓴다.
 *
 * 내용 ID 가 붙어 있다는 것만으로는 아니다. 내용 ID 를 넘기면 받는 쪽 메일 프로그램이 그 파일을 본문 속 그림으로 보고
 * 첨부 목록에서 감춘다 — 본문이 가리키지 않는 PDF 에 그렇게 하면 스캔본이 사라진다.
 * 그래서 HTML 본문이 있고, 원본 풀기가 본문 속(related) 파트라고 했거나 본문이 그 `cid:` 를 실제로 참조할 때만이다.
 */
function isInlineImage(
  attachment: ReceivedAttachment,
  html: string | null,
  referenced: ReadonlySet<string>,
): boolean {
  const contentId = bareContentId(attachment);
  if (!contentId || !html) return false;
  return attachment.related === true || referenced.has(contentId.toLowerCase());
}

function toForwardAttachment(
  attachment: ReceivedAttachment,
  index: number,
  inline: boolean,
): ForwardAttachment {
  return {
    filename: attachmentFilename(attachment, index),
    content: attachment.contentBase64,
    contentType: attachment.mimeType,
    ...(inline ? { contentId: bareContentId(attachment) } : {}),
  };
}

/**
 * 그대로 넘길 수 있는 크기 — 인코딩한 첨부 합계 + 본문 바이트의 상한.
 * 발송 서비스의 한도는 인코딩 후 40MB 다. 거기서 5MB 를 남긴다: 발송 서비스가 첨부를 메일로 엮을 때 붙는
 * 줄바꿈(약 3%)과 본문 재인코딩(한글 본문은 최대 3배)·헤더 몫이다. 그래도 넘치면 발송 API 가 거절하고,
 * 그때는 서비스가 첨부를 빼고 한 번 더 보낸다(`services/reply-forward`).
 */
export const FORWARD_SIZE_BUDGET_BYTES = 35 * 1024 * 1024;

type SizedReply = Pick<ReceivedReply, 'html' | 'text' | 'attachments'>;

function utf8ByteLength(value: string | null): number {
  return value ? new TextEncoder().encode(value).length : 0;
}

/** 전달 메일의 크기 — 인코딩한(base64) 첨부 합계와 본문(HTML·텍스트)의 바이트. */
export function measureForwardSize(reply: SizedReply): number {
  const attachments = reply.attachments.reduce((sum, a) => sum + a.contentBase64.length, 0);
  return attachments + utf8ByteLength(reply.html) + utf8ByteLength(reply.text);
}

/** 첨부를 빼고 보내야 하는가. 첨부가 없으면 뺄 것이 없으니 늘 아니다. */
export function exceedsForwardSizeBudget(reply: SizedReply): boolean {
  return reply.attachments.length > 0 && measureForwardSize(reply) > FORWARD_SIZE_BUDGET_BYTES;
}

/** 함께 전달하지 못한 첨부 하나 — 안내문의 재료. */
export interface OmittedAttachment {
  filename: string;
  /** 인코딩 전(원래 파일) 크기. */
  sizeBytes: number;
  /** 본문 속 이미지인가 — 전달할 때 내용 ID 를 넘겼을 첨부(`isInlineImage`). */
  inline: boolean;
}

function decodedByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * 받은 메일의 첨부 전부를 「빠진 파일」 목록으로. 이름과 「본문 속 이미지」 판정은 전달할 때와 같다.
 * @param html 받은 메일의 HTML 본문 — 본문 속 이미지 판정의 재료. 없으면 본문 속 이미지도 없다.
 */
export function listOmittedAttachments(
  attachments: readonly ReceivedAttachment[],
  html: string | null = null,
): OmittedAttachment[] {
  const referenced = referencedContentIds(html ?? '');
  return attachments.map((attachment, index) => ({
    filename: attachmentFilename(attachment, index),
    sizeBytes: decodedByteLength(attachment.contentBase64),
    inline: isInlineImage(attachment, html, referenced),
  }));
}

/** 안내문에 이름을 적는 파일 수 상한 — 넘는 것은 개수로만 알린다. */
const MAX_NOTICE_FILES = 20;
const NOTICE_FILENAME_MAX_LENGTH = 120;
/**
 * 첨부를 뺀 까닭 — 안내의 첫 문장이 갈린다.
 * `size`: 발송 한도를 넘었다(앱의 판정이든 발송 서비스의 크기 초과 거절이든).
 * `rejected`: 발송 서비스가 크기와 무관하게 거절했다(막힌 파일 종류 등) — 크기를 탓하면 틀린 안내가 된다.
 */
export type OmitAttachmentsReason = 'size' | 'rejected';

const NOTICE_HEADLINE: Record<OmitAttachmentsReason, string> = {
  size: '첨부 파일이 커서 함께 전달하지 못했습니다.',
  rejected: '첨부 파일을 함께 전달하지 못했습니다.',
};
const NOTICE_ORIGIN = '원본은 메일 발송 서비스(Resend) 수신 목록에 있습니다.';
const NOTICE_TEXT_RULE = '----------------------------------------';

/** 안내에 적는 파일 이름 — 줄바꿈·제어 문자가 안내의 줄을 흉내 내지 못하게 걷어내고 길이를 자른다. */
function noticeFilename(filename: string): string {
  return Array.from(cleanFilename(filename)).slice(0, NOTICE_FILENAME_MAX_LENGTH).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 한도 초과 안내문 — 전달 메일 본문 맨 위에 붙인다.
 * 본문 속 이미지도 첨부와 함께 빠지므로 목록에 넣고 따로 표시한다(본문에서 그 자리가 깨져 보인다).
 * 텍스트 안내는 원래 본문과 갈리도록 구분선과 빈 줄로 끝난다.
 */
export function buildOmittedAttachmentsNotice(
  files: readonly OmittedAttachment[],
  reason: OmitAttachmentsReason = 'size',
): {
  html: string;
  text: string;
} {
  const headline = NOTICE_HEADLINE[reason];
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const summary = `빠진 파일 (${files.length}개, 합계 ${formatBytes(total)})`;
  const labels = files.slice(0, MAX_NOTICE_FILES).map((file) => {
    const detail = file.inline ? `${formatBytes(file.sizeBytes)}, 본문 속 이미지` : formatBytes(file.sizeBytes);
    return `${noticeFilename(file.filename)} (${detail})`;
  });
  if (files.length > MAX_NOTICE_FILES) labels.push(`외 ${files.length - MAX_NOTICE_FILES}개`);

  const text = [
    `[안내] ${headline}`,
    summary,
    ...labels.map((label) => `- ${label}`),
    NOTICE_ORIGIN,
    NOTICE_TEXT_RULE,
    '',
    '',
  ].join('\n');
  const html = [
    '<div style="margin:0 0 16px;padding:12px 16px;border:1px solid #d1d5db;background:#f9fafb;color:#111827;font-size:14px;line-height:1.6;">',
    `<p style="margin:0 0 8px;font-weight:bold;">${headline}</p>`,
    `<p style="margin:0;">${summary}</p>`,
    '<ul style="margin:4px 0 8px;padding-left:20px;">',
    ...labels.map((label) => `<li>${escapeHtml(label)}</li>`),
    '</ul>',
    `<p style="margin:0;">${NOTICE_ORIGIN}</p>`,
    '</div>',
  ].join('');
  return { html, text };
}

const BODY_OPEN_TAG = /<body\b[^>]*>/i;

/** 안내를 HTML 본문 맨 위에 — 온전한 문서면 body 여는 태그 바로 뒤, 조각이면 맨 앞. */
function prependHtmlNotice(html: string, notice: string): string {
  const match = BODY_OPEN_TAG.exec(html);
  if (!match) return `${notice}${html}`;
  const at = match.index + match[0].length;
  return `${html.slice(0, at)}${notice}${html.slice(at)}`;
}

export interface ForwardMailInput {
  reply: ReceivedReply;
  /** 보낸 사람 주소에 쓰는 보낸이 계정. */
  senderAccount: string;
  sendDomain: string;
  forwardAddresses: readonly string[];
  /**
   * 첨부(본문 속 이미지 포함)를 하나도 싣지 않고 본문 맨 위에 안내를 붙인다 — 발송 한도를 넘을 때.
   * 첨부가 없는 메일에는 아무 일도 하지 않는다.
   */
  omitAttachments?: boolean;
  /** 첨부를 뺀 까닭 — 안내 문구를 고른다. 기본은 크기(`size`). */
  omitReason?: OmitAttachmentsReason;
}

/**
 * 받은 메일을 전달 메일의 모양으로 바꾼다.
 * 받는 사람은 전달 주소뿐이다 — 원본의 참조·다른 받는 사람은 옮기지 않는다.
 */
export function buildForwardMail(input: ForwardMailInput): ForwardMail {
  const { reply } = input;
  const replyTo = dedupeAddresses(reply.replyTo).slice(0, MAX_REPLY_TO_ADDRESSES);
  const omit = input.omitAttachments === true && reply.attachments.length > 0;
  const referenced = referencedContentIds(reply.html ?? '');
  const notice = omit
    ? buildOmittedAttachmentsNotice(
        listOmittedAttachments(reply.attachments, reply.html),
        input.omitReason,
      )
    : null;
  const html = reply.html && notice ? prependHtmlNotice(reply.html, notice.html) : reply.html;
  const text = reply.text ? `${notice?.text ?? ''}${reply.text}` : reply.text;
  const body: ForwardBody = html
    ? { html, ...(text ? { text } : {}) }
    : { text: text || `${notice?.text ?? ''}${NO_BODY_PLACEHOLDER}` };
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
    attachments: omit
      ? []
      : reply.attachments.map((attachment, index) =>
          toForwardAttachment(attachment, index, isInlineImage(attachment, reply.html, referenced)),
        ),
    headers: { ...REPLY_FORWARD_HEADERS },
    tags: [{ ...REPLY_FORWARD_TAG }],
  };
}
