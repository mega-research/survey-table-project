import 'server-only';

import * as Sentry from '@sentry/nextjs';
import PostalMime from 'postal-mime';
import type { GetReceivingEmailResponseSuccess } from 'resend';

import { logger } from '@/lib/logger';
import { InternalFailure } from '@/server/internal-failure';
import { markSentryCaptured } from '@/server/rpc-error-policy';

import {
  REPLY_FORWARD_HOURLY_CAP,
  buildForwardMail,
  detectForwardLoop,
  exceedsForwardSizeBudget,
  extractSenderAccounts,
  findCompanyDomainMatch,
  mergeForwardAddresses,
  parseMailbox,
  type ForwardMail,
  type ForwardLoopSignal,
  type ForwardMailInput,
  type MailHeader,
  type OmitAttachmentsReason,
  type ReceivedAttachment,
} from '../domain/reply-forward';
import {
  findReplyAddressByRespondent,
  loadAccountReplyAddresses,
  type ReplyAddressSource,
} from './reply-address-lookup';
import {
  isWebhookEventRecorded,
  recordReplyForwardEvent,
  reserveForwardSlot,
} from './reply-forward-ledger';
import { getResend } from './resend-client';

/**
 * 회신 전달 — 보낸 사람 주소로 들어온 메일(`email.received`)을 회신 주소로 넘긴다.
 *
 * 처리 순서: ① 웹훅 장부에 이미 있으면 끝 → (알림 값으로 미리 거르기) → ② 받은 메일 조회·판정 → ③ 원본 내려받기·발송 → ④ 장부 기록.
 * ②·③의 실패는 던진다 — 라우트가 500 으로 답해 Resend 가 다시 보내고, 장부에 적지 않았으므로 처음부터 다시 한다.
 * ③은 됐는데 ④가 실패해도 발송 멱등 키(받은 메일 id)가 두 번째 발송을 막는다.
 * 첨부가 발송 한도를 넘으면 ③에서 첨부 없이 본문과 안내만 보낸다(`deliverForwardMail`).
 * 넘기지 않는 것은 실패가 아니라 정상 처리다(장부에 「넘기지 않음」으로 적고 끝).
 * 넘기기로 한 메일은 ③ 직전에 시간당 상한의 자리를 잡는다 — 못 잡으면 던져서(500) Resend 재시도가 뒤로 미루게 한다.
 *
 * 로그·오류 문구에는 주소·이름·제목·본문을 싣지 않는다 — 식별자와 분류값만.
 * 규칙은 `domain/reply-forward`, 전달 주소는 `reply-address-lookup` 이 DB 에서 읽은 회신 주소뿐이다.
 */

export interface ReplyForwardEvent {
  /** 웹훅 알림 id(svix-id) — 웹훅 장부의 키. */
  eventId: string;
  /** Resend 가 받은 메일의 id — 조회와 발송 멱등 키의 재료. */
  receivedEmailId: string;
  /**
   * 알림에 실려 온 실제 수신 주소·보낸 사람 표기. 받은 메일을 조회하기 **전에** 넘기지 않을 메일을 거르는 데만 쓴다 —
   * 넘길 메일의 판정과 전달 메일의 모양은 조회한 값으로 한다. 없으면 조회 뒤에 판정한다.
   * 로그·오류에 싣지 않는다.
   */
  receivedFor?: readonly string[];
  from?: string;
}

export type ReplyForwardSkipReason =
  /** 받는 주소에 발송 전용 도메인의 주소가 없다. */
  | 'no_sender_account'
  /** 보낸 사람 주소를 읽을 수 없다. */
  | 'unreadable_sender'
  /** 보낸 사람이 발송 전용 도메인이거나 전달 주소와 같은 도메인이다(자동응답 고리). */
  | 'company_domain'
  /** 쓴 적 없는 보낸이 계정으로 왔다(전달 주소 없음). */
  | 'unused_sender_account'
  /** 발송 서비스가 다시 해도 안 될 거절을 했다 — 첨부를 빼고도 거절됐다. 메일은 수신 목록에 남는다. */
  | 'send_rejected'
  /** 우리 표식 헤더를 단 메일 — 전달 메일이 보낸 사람 주소로 되돌아왔다. */
  | 'forward_loop'
  /** 배달 상태 통지(반송 통지) — 넘기면 그 메일이 또 반송되어 돈다. */
  | 'delivery_report';

export type ReplyForwardResult =
  | { outcome: 'deduped' }
  | { outcome: 'skipped'; reason: ReplyForwardSkipReason }
  | {
      outcome: 'forwarded';
      forwardCount: number;
      /** 주소를 찾은 방법(계정이 여럿이면 여럿). */
      sources: ReplyAddressSource[];
      /** 멱등 키 내용 불일치 거절을 「이미 보냄」으로 처리했다. */
      alreadySent: boolean;
      /** 첨부가 발송 한도를 넘어 본문과 안내만 보냈다. 그대로 넘긴 건에는 이 칸이 없다. */
      attachmentsOmitted?: true;
    };

/** 전달 메일의 두 모양 — 받은 그대로(`full`), 첨부를 빼고 안내를 붙인 것(`no_attachments`). */
export type ForwardMailVariant = 'full' | 'no_attachments';

/**
 * 발송 멱등 키 — 받은 메일 한 통에 전달 메일 한 통.
 * 모양마다 키가 다르다: 같은 키로 내용이 다른 요청은 발송 서비스가 거절하므로, 크기 초과로 거절된 뒤
 * 첨부를 빼고 다시 보낼 때 같은 키를 쓸 수 없다. 받은 그대로 보낸 것이 성공하면 첨부 뺀 것은 보내지 않으니
 * 키가 둘이어도 나가는 메일은 한 통이다.
 */
export function replyForwardIdempotencyKey(
  receivedEmailId: string,
  variant: ForwardMailVariant = 'full',
): string {
  const base = `reply-forward/${receivedEmailId}`;
  return variant === 'no_attachments' ? `${base}/no-attachments` : base;
}

function requireSendDomain(): string {
  const sendDomain = process.env['RESEND_FROM_DOMAIN']?.trim().toLowerCase();
  if (!sendDomain) throw new InternalFailure('RESEND_FROM_DOMAIN 환경변수가 설정되지 않았습니다.');
  return sendDomain;
}

export interface ForwardAddressResolution {
  /** 전달 주소(한 통의 받는 사람). 비면 쓴 적 없는 보낸이 계정이다. */
  addresses: string[];
  /** 주소를 찾은 방법 — 전달 주소를 낸 계정들의 것만, 중복 없이. */
  sources: ReplyAddressSource[];
  /** 전달 메일의 보낸 사람 주소에 쓸 계정 — 전달 주소를 낸 첫 계정. */
  senderAccount: string | null;
}

/**
 * 전달 주소 조회 — 받는 주소에서 뽑은 보낸이 계정마다 회신 주소를 찾아 한 통의 받는 사람으로 합친다.
 *
 * 계정마다 먼저 응답자 주소로 찾는다(그 주소에 가장 최근에 보낸 발송 회차의 회신 주소 한 곳). 못 찾으면
 * 계정 기준(`loadAccountReplyAddresses` — 그 계정이 쓴 회신 주소 전부)으로 물러난다.
 * 응답자 주소는 「어느 회차인가」를 고르는 재료일 뿐이고, 전달 주소는 어느 경로든 DB 의 회신 주소다.
 */
export async function resolveForwardAddresses(input: {
  senderAccounts: readonly string[];
  /** 답장을 보낸 주소. 없으면 계정 기준으로만 찾는다. */
  respondentAddress?: string;
  sendDomain: string;
  now?: Date;
}): Promise<ForwardAddressResolution> {
  const now = input.now ?? new Date();
  const lists: string[][] = [];
  const sources: ReplyAddressSource[] = [];
  let senderAccount: string | null = null;
  for (const account of input.senderAccounts) {
    const byRespondent = input.respondentAddress
      ? await findReplyAddressByRespondent(account, input.respondentAddress, {
          sendDomain: input.sendDomain,
        })
      : null;
    const found =
      byRespondent && byRespondent.source !== null && byRespondent.addresses.length > 0
        ? byRespondent
        : await loadAccountReplyAddresses(account, { sendDomain: input.sendDomain, now });
    if (found.source === null || found.addresses.length === 0) continue;
    senderAccount ??= account;
    lists.push(found.addresses);
    if (!sources.includes(found.source)) sources.push(found.source);
  }
  return { addresses: mergeForwardAddresses(lists), sources, senderAccount };
}

/** 원본에서 풀어 낸 내용 — 본문·첨부와 응답자가 쓴 표시 이름, 고리 판정에 쓰는 헤더. */
export interface ReceivedContent {
  senderName: string | null;
  headers: MailHeader[];
  html: string | null;
  text: string | null;
  attachments: ReceivedAttachment[];
}

/**
 * 단계별 제한 시간 — 외부 호출 하나가 매달려 요청 전체가 플랫폼 제한까지 끌려가지 않게 한다.
 * 합(가장 오래 걸리는 길: 조회 → 내려받기 → 받은 그대로 발송 → 첨부를 뺀 재발송)이 웹훅 라우트의 `maxDuration` 안에
 * 들어야 한다 — 라우트의 export 테스트가 대조한다. 값을 올리면 그 테스트와 `maxDuration` 을 함께 본다.
 *
 * - `download`·`send`: 40MB 원본을 내려받고, 한도(35MB)에 가까운 요청을 올리는 데 걸리는 시간. 느린 구간(초당 0.5MB 안팎)을
 *   견디도록 잡았다.
 * - `sendWithoutAttachments`: 본문과 안내뿐이라 짧다.
 */
export const REPLY_FORWARD_STEP_TIMEOUTS_MS = {
  lookup: 15_000,
  download: 60_000,
  send: 120_000,
  sendWithoutAttachments: 30_000,
} as const;

/**
 * 발송 서비스 SDK 는 중단 신호를 받지 않는다 — 바깥에서 시계를 건다.
 * 제한 시간이 지나도 이미 나간 요청은 취소되지 않는다. 발송이 뒤늦게 성공해도 재시도가 같은 멱등 키로 이어 가므로
 * 메일은 한 통이다.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new InternalFailure(`${label} 시간 초과 (${Math.round(ms / 1000)}초)`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 받은 메일 원본(.eml)을 내려받아 푼다.
 * SDK 의 전달 도우미(`emails.receiving.forward`)를 쓰지 않는 이유: 답장 주소와 보낸 사람 이름을 넣지 못한다.
 * 원본은 글자가 아니라 바이트로 읽는다 — 글자로 읽으면 8bit 본문·첨부가 깨질 수 있다.
 */
export async function loadReceivedContent(downloadUrl: string): Promise<ReceivedContent> {
  let raw: ArrayBuffer;
  try {
    // 내려받기 주소는 서명된 URL 이다 — 그 주소만 있으면 누구나 원본(본문·첨부)을 받는다.
    // Sentry 는 나가는 요청의 경로와 쿼리를 breadcrumb·span 에 싣고, 기본 가림 목록(token·key·auth …)에는
    // `X-Amz-Signature` 같은 서명 칸이 없다. 이 요청 하나만 추적에서 뺀다(추적 헤더도 붙지 않는다).
    const response = await Sentry.suppressTracing(() =>
      fetch(downloadUrl, {
        signal: AbortSignal.timeout(REPLY_FORWARD_STEP_TIMEOUTS_MS.download),
      }),
    );
    if (!response.ok) {
      throw new InternalFailure(`받은 메일 원본 내려받기 실패 (HTTP ${response.status})`);
    }
    raw = await response.arrayBuffer();
  } catch (err) {
    if (err instanceof InternalFailure) throw err;
    // 원인 오류에는 서명된 내려받기 주소가 실릴 수 있어 이어 붙이지 않는다.
    throw new InternalFailure('받은 메일 원본 내려받기 실패 (네트워크)');
  }

  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'base64' });
  return {
    senderName: parsed.from?.name?.trim() || null,
    headers: parsed.headers.map((header) => ({ key: header.key, value: header.value })),
    html: parsed.html ?? null,
    text: parsed.text ?? null,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentId: attachment.contentId ?? null,
      related: attachment.related === true,
      // attachmentEncoding: 'base64' 라 내용은 base64 문자열로 온다.
      contentBase64: String(attachment.content),
    })),
  };
}

/**
 * 같은 알림을 다른 요청이 처리하는 중이라 이번 요청은 물러난다(발송 멱등 키의 「처리 중」 거절).
 * 장애가 아니라 표식(`markSentryCaptured`)을 달고 던진다 — 500 으로 답하되 Sentry 장애 이벤트는 내지 않는다.
 */
export class ReplyForwardInProgress extends InternalFailure {}

/** 검증 계열 거절 가운데 문구가 크기를 말하는 것만 크기 초과로 본다. */
const SIZE_REJECTION_NAMES: ReadonlySet<string> = new Set([
  'validation_error',
  'invalid_attachment',
  'invalid_parameter',
]);
const SIZE_REJECTION_MESSAGE = /too large|too big|size|exceed|40\s?mb|payload/i;

/** 발송 서비스가 돌려준 거절의 분류값 — 문구는 주소를 담을 수 있어 옮기지 않는다. */
export interface SendRejection {
  name: string;
  statusCode: number | null;
}

/**
 * 발송 API 의 거절이 「메일이 너무 크다」인가.
 * 발송 서비스 문서에 크기 초과의 오류 이름이 없어 두 모양을 본다: HTTP 413(앞단이 본문을 받지 않을 때 —
 * SDK 가 `application_error` 로 옮긴다), 그리고 검증 계열 거절 가운데 문구가 크기를 말하는 것.
 * 문구는 판정에만 쓰고 어디에도 옮기지 않는다(주소를 담을 수 있다).
 */
function isSizeRejection(error: SendRejection & { message?: string }): boolean {
  if (error.statusCode === 413) return true;
  return SIZE_REJECTION_NAMES.has(error.name) && SIZE_REJECTION_MESSAGE.test(error.message ?? '');
}

/** 요청의 내용이 틀렸다는 거절 — 같은 요청을 다시 보내도 결과가 같다. */
const PERMANENT_REJECTION_NAMES: ReadonlySet<string> = new Set([
  'validation_error',
  'invalid_attachment',
  'invalid_parameter',
  'missing_required_field',
  'invalid_from_address',
]);

/**
 * 다시 해도 결과가 같을 거절인가 — 검증 계열 이름이면서 400·422 인 것만.
 *
 * 좁게 잡는다. 여기에 든 거절은 재시도 없이 끝나므로(첨부를 빼고 한 번 더, 그것도 안 되면 「넘기지 않음」),
 * 사람이 고치면 풀리는 거절이 섞이면 그동안 온 메일이 조용히 버려진다:
 * 429(한도)·5xx·연결 실패는 기다리면 풀리고, 401·403(API 키·도메인 인증 — 403 은 이름이 `validation_error` 다)은
 * 설정을 고치면 풀리고, 409(멱등 충돌)는 따로 다룬다. 그런 거절은 던져서 재시도에 맡긴다.
 */
function isPermanentRejection(error: SendRejection): boolean {
  return (
    (error.statusCode === 400 || error.statusCode === 422) && PERMANENT_REJECTION_NAMES.has(error.name)
  );
}

export type ForwardSendOutcome =
  | { kind: 'sent' }
  /** 「같은 멱등 키인데 내용이 다르다」 — 이미 보낸 것으로 본다. */
  | { kind: 'already_sent' }
  /**
   * 발송 서비스가 거절했고, 호출부가 물러날 수 있는 거절이다.
   * `size`: 크기 초과. `permanent`: 다시 해도 결과가 같다(검증 계열). 둘 다일 수 있다(크기를 말하는 검증 오류).
   */
  | { kind: 'rejected'; size: boolean; permanent: boolean; rejection: SendRejection };

/**
 * 전달 메일을 보낸다. 받은 메일 id 로 만든 멱등 키를 걸어, 같은 알림이 다시 와도 한 통만 나간다.
 * 「같은 멱등 키인데 내용이 다르다」는 거절(재시도 사이 전달 주소가 바뀜)은 이미 보낸 것이다.
 * 크기 초과·검증 계열 거절은 `rejected` 로 돌려준다 — 첨부를 빼고 다시 보낼지, 그만둘지는 호출부(`deliverForwardMail`)가 정한다.
 * 그 밖의 거절·오류(한도·서버 오류·연결 실패·시간 초과)는 던진다 — 오류 문구에는 분류값만 싣는다(발송 서비스의 문구는 주소를 담을 수 있다).
 */
export async function sendForwardMail(
  mail: ForwardMail,
  receivedEmailId: string,
  variant: ForwardMailVariant = 'full',
): Promise<ForwardSendOutcome> {
  const { data, error } = await withTimeout(
    getResend().emails.send(mail, {
      idempotencyKey: replyForwardIdempotencyKey(receivedEmailId, variant),
    }),
    variant === 'no_attachments'
      ? REPLY_FORWARD_STEP_TIMEOUTS_MS.sendWithoutAttachments
      : REPLY_FORWARD_STEP_TIMEOUTS_MS.send,
    '회신 전달 발송',
  );
  if (error) {
    if (error.name === 'invalid_idempotent_request') return { kind: 'already_sent' };
    if (error.name === 'concurrent_idempotent_requests') {
      // 같은 알림을 다른 요청이 처리하는 중이다(먼저 온 요청이 오래 걸려 알림이 다시 왔다). 장애가 아니다 —
      // 던져서 500 으로 답하되 표식을 달아 라우트가 Sentry 장애로 보내지 않게 한다. 먼저 온 요청이 끝내면
      // 다음 재시도가 장부에서 중복으로 끝난다.
      logger.warn(
        { receivedEmailId, outcome: 'deferred', reason: 'in_progress' },
        '[reply-forward] 같은 알림이 처리 중 — 재시도에 맡김',
      );
      const inProgress = new ReplyForwardInProgress('회신 전달 발송 — 같은 알림이 처리 중입니다');
      markSentryCaptured(inProgress);
      throw inProgress;
    }
    const size = isSizeRejection(error);
    const permanent = isPermanentRejection(error);
    if (size || permanent) {
      return {
        kind: 'rejected',
        size,
        permanent,
        rejection: { name: error.name, statusCode: error.statusCode },
      };
    }
    throw new InternalFailure(`회신 전달 발송 실패 — ${error.name} (${error.statusCode ?? '-'})`);
  }
  if (!data?.id) throw new InternalFailure('회신 전달 발송 실패 — 응답에 id 가 없습니다');
  return { kind: 'sent' };
}

export type ForwardDelivery =
  | {
      sent: 'sent' | 'already_sent';
      /** 첨부를 빼고 본문과 안내만 보냈다. */
      attachmentsOmitted: boolean;
    }
  /** 다시 해도 안 될 거절로 끝났다 — 첨부를 빼고도 거절됐거나 뺄 첨부가 없다. 보낸 메일이 없다. */
  | { sent: 'rejected'; rejection: SendRejection };

/**
 * 전달 메일을 조립해 보낸다 — 받은 그대로 못 보내면 첨부 없이 본문과 안내만.
 *
 * - 인코딩한 첨부와 본문이 한도(여유를 둔 값)를 넘으면 처음부터 첨부 없이 보낸다. 거절될 것을 올려 보지 않는다.
 * - 받은 그대로 보낸 것을 발송 API 가 크기 초과로, 또는 다시 해도 안 될 검증 오류(막힌 파일 종류 등)로 거절하면
 *   첨부 없이 **한 번** 더 보낸다. 안내 문구는 까닭을 따른다 — 크기 초과만 「커서」라고 말한다.
 * - 첨부를 뺀 것도 검증 오류로 거절되면(또는 뺄 첨부가 없으면) `rejected` 로 돌려준다 — 같은 요청으로 500 을
 *   되풀이해 봐야 결과가 같다. 호출부가 「넘기지 않음」으로 끝내고 알린다.
 * - 그 밖의 실패는 던진다(재시도에 맡긴다). 크기 초과(413)가 첨부를 빼고도 남으면 그것도 던진다.
 */
export async function deliverForwardMail(
  input: Omit<ForwardMailInput, 'omitAttachments' | 'omitReason'>,
  receivedEmailId: string,
): Promise<ForwardDelivery> {
  const sendWithoutAttachments = async (omitReason: OmitAttachmentsReason): Promise<ForwardDelivery> => {
    const mail = buildForwardMail({ ...input, omitAttachments: true, omitReason });
    const outcome = await sendForwardMail(mail, receivedEmailId, 'no_attachments');
    if (outcome.kind !== 'rejected') return { sent: outcome.kind, attachmentsOmitted: true };
    if (outcome.permanent) return { sent: 'rejected', rejection: outcome.rejection };
    throw new InternalFailure('회신 전달 발송 실패 — 첨부를 빼도 크기 초과입니다');
  };

  if (exceedsForwardSizeBudget(input.reply)) return sendWithoutAttachments('size');

  const outcome = await sendForwardMail(buildForwardMail(input), receivedEmailId);
  if (outcome.kind !== 'rejected') return { sent: outcome.kind, attachmentsOmitted: false };
  if (input.reply.attachments.length === 0) {
    if (outcome.permanent) return { sent: 'rejected', rejection: outcome.rejection };
    throw new InternalFailure('회신 전달 발송 실패 — 크기 초과인데 뺄 첨부가 없습니다');
  }
  return sendWithoutAttachments(outcome.size ? 'size' : 'rejected');
}

async function fetchReceivedEmail(receivedEmailId: string): Promise<GetReceivingEmailResponseSuccess> {
  const { data, error } = await withTimeout(
    getResend().emails.receiving.get(receivedEmailId),
    REPLY_FORWARD_STEP_TIMEOUTS_MS.lookup,
    '받은 메일 조회',
  );
  if (error) {
    throw new InternalFailure(`받은 메일 조회 실패 — ${error.name} (${error.statusCode ?? '-'})`);
  }
  if (!data) throw new InternalFailure('받은 메일 조회 실패 — 응답이 비었습니다');
  return data;
}

async function skip(
  event: ReplyForwardEvent,
  reason: ReplyForwardSkipReason,
  options: { externalReplyDomain?: boolean } = {},
): Promise<ReplyForwardResult> {
  await recordReplyForwardEvent(event.eventId, 'skipped');
  const line = { receivedEmailId: event.receivedEmailId, outcome: 'skipped', reason, forwardCount: 0 };
  if (options.externalReplyDomain) {
    // 회신 주소를 외부 메일(gmail 등)로 적은 템플릿 — 같은 메일 서비스를 쓰는 응답자의 답장이 여기서 막힌다.
    logger.warn({ ...line, externalReplyDomain: true }, '[reply-forward] 회신 주소와 같은 외부 도메인에서 온 메일을 넘기지 않음');
  } else {
    logger.info(line, '[reply-forward] 넘기지 않음');
  }
  return { outcome: 'skipped', reason };
}

const LOOP_SKIP_REASON: Record<ForwardLoopSignal, ReplyForwardSkipReason> = {
  forward_mark: 'forward_loop',
  delivery_report: 'delivery_report',
};

/**
 * 발송 서비스가 다시 해도 안 될 거절을 했다 — 첨부를 빼고도 거절됐다(또는 뺄 첨부가 없다).
 * 500 으로 답해 봐야 재시도마다 같은 거절이 돌아오므로 「넘기지 않음」으로 적고 200 으로 끝낸다.
 * 메일은 수신 목록에 남는다 — 사람이 확인하도록 경고를 낸다. 주소·제목·파일 이름·거절 문구는 싣지 않는다(오류 이름·상태만).
 */
async function giveUpRejected(
  event: ReplyForwardEvent,
  rejection: SendRejection,
): Promise<ReplyForwardResult> {
  await recordReplyForwardEvent(event.eventId, 'skipped');
  logger.warn(
    { receivedEmailId: event.receivedEmailId, outcome: 'skipped', reason: 'send_rejected', forwardCount: 0 },
    '[reply-forward] 발송 거절 — 넘기지 못함',
  );
  Sentry.captureMessage('회신 전달 발송 거절 — 넘기지 못함', {
    level: 'warning',
    tags: { operation: 'reply_forward_rejected' },
    extra: {
      receivedEmailId: event.receivedEmailId,
      errorName: rejection.name,
      statusCode: rejection.statusCode,
    },
  });
  return { outcome: 'skipped', reason: 'send_rejected' };
}

/**
 * 시간당 상한을 넘어 이번 알림을 넘기지 않았다. 던지면 라우트가 500 으로 답하고 Resend 가 간격을 늘려 다시 보낸다 —
 * 장부에 적지 않았으므로 재시도가 처음부터 다시 하고, 원본은 수신 목록에 남는다.
 * Sentry 경고는 던지기 전에 이미 냈다(표식을 달아 라우트가 장애로 또 보내지 않는다).
 */
export class ReplyForwardCapExceeded extends InternalFailure {}

/**
 * 시간당 상한의 자리를 잡는다 — 판정이 끝나 넘기기로 한 메일만 여기에 온다(넘기지 않는 메일은 자리를 잡지 않는다).
 * 자리는 발송 **전에** 잡는다. 발송 뒤에 적힌 줄을 세면 동시에 몰린 요청이 서로를 보지 못한다.
 * 못 잡으면 던진다. 같은 알림의 재시도는 자기 자리를 다시 쓴다(`reserveForwardSlot`).
 */
async function reserveHourlySlot(event: ReplyForwardEvent): Promise<void> {
  const reservation = await reserveForwardSlot(event.eventId);
  if (reservation.reserved) return;

  logger.warn(
    { receivedEmailId: event.receivedEmailId, outcome: 'deferred', reason: 'hourly_cap' },
    '[reply-forward] 시간당 상한 초과 — 넘기지 않고 재시도에 맡김',
  );
  // 문구는 고정이다 — 건수를 넣으면 이벤트마다 이슈가 갈린다. 주소·제목은 싣지 않는다.
  Sentry.captureMessage('회신 전달 시간당 상한 초과', {
    level: 'warning',
    tags: { operation: 'reply_forward_cap' },
    extra: {
      receivedEmailId: event.receivedEmailId,
      slotsLastHour: reservation.slotsInWindow,
      cap: REPLY_FORWARD_HOURLY_CAP,
    },
  });
  const error = new ReplyForwardCapExceeded('회신 전달 시간당 상한 초과');
  markSentryCaptured(error);
  throw error;
}

/** 한 번 찾은 전달 주소 — 같은 재료(보낸이 계정들·응답자 주소)로 다시 찾지 않으려고 재료와 함께 든다. */
interface ResolvedForwardAddresses {
  key: string;
  resolution: ForwardAddressResolution;
}

async function resolveOnce(
  senderAccounts: readonly string[],
  respondentAddress: string,
  sendDomain: string,
  previous?: ResolvedForwardAddresses,
): Promise<ResolvedForwardAddresses> {
  const key = JSON.stringify([senderAccounts, respondentAddress.toLowerCase()]);
  if (previous?.key === key) return previous;
  return {
    key,
    resolution: await resolveForwardAddresses({ senderAccounts, respondentAddress, sendDomain }),
  };
}

type Prefilter =
  | { skip: ReplyForwardSkipReason }
  /** 걸러지지 않았다. 알림 값으로 전달 주소를 찾아 봤으면 그 결과를 함께 든다. */
  | { skip: null; resolved?: ResolvedForwardAddresses };

/**
 * 알림에 실린 받는 주소·보낸 사람으로 미리 거른다 — 넘기지 않을 메일(스팸·되돌아온 메일)에 받은 메일 조회 API 를 쓰지 않는다.
 * 거르는 것은 셋뿐이다: 발송 전용 도메인의 받는 주소가 없음 · 보낸 사람이 발송 전용 도메인 · 쓴 적 없는 보낸이 계정.
 * 값이 없거나 읽을 수 없으면 거르지 않는다 — 조회한 값으로 판정한다.
 */
async function prefilterByNotification(event: ReplyForwardEvent, sendDomain: string): Promise<Prefilter> {
  const hintedSender = event.from !== undefined ? parseMailbox(event.from) : null;
  if (hintedSender && findCompanyDomainMatch(hintedSender.address, sendDomain, [])) {
    return { skip: 'company_domain' };
  }
  if (event.receivedFor === undefined) return { skip: null };

  const hintedAccounts = extractSenderAccounts(event.receivedFor, sendDomain);
  if (hintedAccounts.length === 0) return { skip: 'no_sender_account' };
  // 「쓴 적 없는 계정」은 보낸 사람까지 알아야 말할 수 있다 — 응답자 주소로 찾는 길에는 기간 제한이 없다.
  if (!hintedSender) return { skip: null };

  const resolved = await resolveOnce(hintedAccounts, hintedSender.address, sendDomain);
  if (resolved.resolution.addresses.length === 0 || resolved.resolution.senderAccount === null) {
    return { skip: 'unused_sender_account' };
  }
  return { skip: null, resolved };
}

/** 회신 전달 진입점 — 웹훅 라우트가 `email.received` 알림일 때 부른다. */
export async function forwardReceivedReply(event: ReplyForwardEvent): Promise<ReplyForwardResult> {
  const sendDomain = requireSendDomain();

  // ① 이미 처리한 알림
  if (await isWebhookEventRecorded(event.eventId)) {
    logger.info({ receivedEmailId: event.receivedEmailId, outcome: 'deduped' }, '[reply-forward] 중복 알림');
    return { outcome: 'deduped' };
  }

  // 알림 값으로 미리 거른다 — 여기서 끝나는 메일은 발송 서비스 API 를 한 번도 부르지 않는다.
  const prefilter = await prefilterByNotification(event, sendDomain);
  if (prefilter.skip !== null) return skip(event, prefilter.skip);

  // ② 조회·판정 — 최종 판정은 조회한 값으로 한다(알림 값은 미리 거르는 데만 썼다).
  const received = await fetchReceivedEmail(event.receivedEmailId);
  const senderAccounts = extractSenderAccounts(received.received_for ?? [], sendDomain);
  if (senderAccounts.length === 0) return skip(event, 'no_sender_account');

  const sender = parseMailbox(received.from ?? '');
  if (!sender) return skip(event, 'unreadable_sender');
  if (findCompanyDomainMatch(sender.address, sendDomain, [])) return skip(event, 'company_domain');
  // 고리가 될 메일 — 조회 응답에 보이는 것(보낸 사람·헤더)으로 먼저 본다. 여기서 걸리면 자리도 잡지 않는다.
  const earlyLoop = detectForwardLoop({
    senderAddress: sender.address,
    headers: Object.entries(received.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  });
  if (earlyLoop) return skip(event, LOOP_SKIP_REASON[earlyLoop]);

  // 알림 값과 조회한 값이 같으면(보통 같다) 미리 찾은 전달 주소를 그대로 쓴다.
  const { resolution } = await resolveOnce(senderAccounts, sender.address, sendDomain, prefilter.resolved);
  if (resolution.addresses.length === 0 || resolution.senderAccount === null) {
    return skip(event, 'unused_sender_account');
  }
  const companyMatch = findCompanyDomainMatch(sender.address, sendDomain, resolution.addresses);
  if (companyMatch) {
    return skip(event, 'company_domain', {
      externalReplyDomain: companyMatch.kind === 'reply_domain' && companyMatch.external,
    });
  }

  // 넘기기로 한 메일만 시간당 상한의 자리를 잡는다 — 발송 전에.
  await reserveHourlySlot(event);

  // ③ 원본 내려받기·발송 — 이 사이 DB 트랜잭션을 잡지 않는다.
  if (!received.raw?.download_url) {
    throw new InternalFailure('받은 메일 원본이 아직 준비되지 않았습니다');
  }
  const content = await loadReceivedContent(received.raw.download_url);
  // 원본의 헤더로 한 번 더 본다 — 조회 응답이 헤더를 싣지 않았을 수 있다. 여기서 걸리면 잡은 자리는 한 시간 동안 센다.
  const loop = detectForwardLoop({ senderAddress: sender.address, headers: content.headers });
  if (loop) return skip(event, LOOP_SKIP_REASON[loop]);
  const delivery = await deliverForwardMail(
    {
      reply: {
        senderAddress: sender.address,
        senderName: content.senderName ?? (sender.name || null),
        replyTo: (received.reply_to ?? []).flatMap((value) => parseMailbox(value)?.address ?? []),
        subject: received.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
      },
      senderAccount: resolution.senderAccount,
      sendDomain,
      forwardAddresses: resolution.addresses,
    },
    event.receivedEmailId,
  );
  if (delivery.sent === 'rejected') return giveUpRejected(event, delivery.rejection);
  const { sent, attachmentsOmitted } = delivery;

  // ④ 장부 기록
  await recordReplyForwardEvent(event.eventId, 'forwarded');
  const line = {
    receivedEmailId: event.receivedEmailId,
    outcome: 'forwarded',
    lookup: resolution.sources.join('+'),
    forwardCount: resolution.addresses.length,
    // 「첨부 제외」 — 뺀 건에만 싣는다. 파일 이름·크기는 싣지 않는다.
    ...(attachmentsOmitted ? { attachmentsOmitted: true as const } : {}),
  };
  if (sent === 'already_sent') {
    logger.warn({ ...line, alreadySent: true }, '[reply-forward] 멱등 키 내용 불일치 — 이미 보낸 것으로 처리');
    // 「이미 보냈다」는 추정이다 — 거절된 요청의 키가 남아 있었다면 실제로는 나가지 않았다. 사람이 확인하게 알린다.
    Sentry.captureMessage('회신 전달 멱등 키 내용 불일치 — 발송 여부 확인 필요', {
      level: 'warning',
      tags: { operation: 'reply_forward_idempotency_mismatch' },
      extra: { receivedEmailId: event.receivedEmailId },
    });
  } else if (attachmentsOmitted) {
    logger.info(line, '[reply-forward] 첨부를 빼고 넘김');
  } else {
    logger.info(line, '[reply-forward] 넘김');
  }
  return {
    outcome: 'forwarded',
    forwardCount: resolution.addresses.length,
    sources: resolution.sources,
    alreadySent: sent === 'already_sent',
    ...(attachmentsOmitted ? { attachmentsOmitted: true as const } : {}),
  };
}
