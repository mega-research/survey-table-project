import 'server-only';

import * as Sentry from '@sentry/nextjs';
import PostalMime from 'postal-mime';
import type { GetReceivingEmailResponseSuccess } from 'resend';

import { logger } from '@/lib/logger';
import { InternalFailure } from '@/server/internal-failure';
import { markSentryCaptured } from '@/server/rpc-error-policy';

import {
  REPLY_FORWARD_CAP_WINDOW_MS,
  REPLY_FORWARD_HOURLY_CAP,
  buildForwardMail,
  exceedsForwardSizeBudget,
  extractSenderAccounts,
  findCompanyDomainMatch,
  mergeForwardAddresses,
  parseMailbox,
  type ForwardMail,
  type ForwardMailInput,
  type ReceivedAttachment,
} from '../domain/reply-forward';
import {
  findReplyAddressByRespondent,
  loadAccountReplyAddresses,
  type ReplyAddressSource,
} from './reply-address-lookup';
import {
  countForwardedRepliesSince,
  isWebhookEventRecorded,
  recordReplyForwardEvent,
} from './reply-forward-ledger';
import { getResend } from './resend-client';

/**
 * 회신 전달 — 보낸 사람 주소로 들어온 메일(`email.received`)을 회신 주소로 넘긴다.
 *
 * 처리 순서: ① 웹훅 장부에 이미 있으면 끝 → ② 받은 메일 조회·판정 → ③ 원본 내려받기·발송 → ④ 장부 기록.
 * ②·③의 실패는 던진다 — 라우트가 500 으로 답해 Resend 가 다시 보내고, 장부에 적지 않았으므로 처음부터 다시 한다.
 * ③은 됐는데 ④가 실패해도 발송 멱등 키(받은 메일 id)가 두 번째 발송을 막는다.
 * 첨부가 발송 한도를 넘으면 ③에서 첨부 없이 본문과 안내만 보낸다(`deliverForwardMail`).
 * 넘기지 않는 것은 실패가 아니라 정상 처리다(장부에 「넘기지 않음」으로 적고 끝).
 * 넘기기로 한 메일은 ③ 직전에 시간당 상한을 본다 — 넘었으면 던져서(500) Resend 재시도가 뒤로 미루게 한다.
 *
 * 로그·오류 문구에는 주소·이름·제목·본문을 싣지 않는다 — 식별자와 분류값만.
 * 규칙은 `domain/reply-forward`, 전달 주소는 `reply-address-lookup` 이 DB 에서 읽은 회신 주소뿐이다.
 */

export interface ReplyForwardEvent {
  /** 웹훅 알림 id(svix-id) — 웹훅 장부의 키. */
  eventId: string;
  /** Resend 가 받은 메일의 id — 조회와 발송 멱등 키의 재료. */
  receivedEmailId: string;
}

export type ReplyForwardSkipReason =
  /** 받는 주소에 발송 전용 도메인의 주소가 없다. */
  | 'no_sender_account'
  /** 보낸 사람 주소를 읽을 수 없다. */
  | 'unreadable_sender'
  /** 보낸 사람이 발송 전용 도메인이거나 전달 주소와 같은 도메인이다(자동응답 고리). */
  | 'company_domain'
  /** 쓴 적 없는 보낸이 계정으로 왔다(전달 주소 없음). */
  | 'unused_sender_account';

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

/** 원본에서 풀어 낸 내용 — 본문·첨부와 응답자가 쓴 표시 이름. */
export interface ReceivedContent {
  senderName: string | null;
  html: string | null;
  text: string | null;
  attachments: ReceivedAttachment[];
}

const RAW_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * 받은 메일 원본(.eml)을 내려받아 푼다.
 * SDK 의 전달 도우미(`emails.receiving.forward`)를 쓰지 않는 이유: 답장 주소와 보낸 사람 이름을 넣지 못한다.
 * 원본은 글자가 아니라 바이트로 읽는다 — 글자로 읽으면 8bit 본문·첨부가 깨질 수 있다.
 */
export async function loadReceivedContent(downloadUrl: string): Promise<ReceivedContent> {
  let raw: ArrayBuffer;
  try {
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(RAW_DOWNLOAD_TIMEOUT_MS) });
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
    html: parsed.html ?? null,
    text: parsed.text ?? null,
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentId: attachment.contentId ?? null,
      // attachmentEncoding: 'base64' 라 내용은 base64 문자열로 온다.
      contentBase64: String(attachment.content),
    })),
  };
}

/** 검증 계열 거절 가운데 문구가 크기를 말하는 것만 크기 초과로 본다. */
const SIZE_REJECTION_NAMES: ReadonlySet<string> = new Set([
  'validation_error',
  'invalid_attachment',
  'invalid_parameter',
]);
const SIZE_REJECTION_MESSAGE = /too large|too big|size|exceed|40\s?mb|payload/i;

/**
 * 발송 API 의 거절이 「메일이 너무 크다」인가.
 * 발송 서비스 문서에 크기 초과의 오류 이름이 없어 두 모양을 본다: HTTP 413(앞단이 본문을 받지 않을 때 —
 * SDK 가 `application_error` 로 옮긴다), 그리고 검증 계열 거절 가운데 문구가 크기를 말하는 것.
 * 문구는 판정에만 쓰고 어디에도 옮기지 않는다(주소를 담을 수 있다).
 */
function isSizeRejection(error: { name: string; statusCode: number | null; message?: string }): boolean {
  if (error.statusCode === 413) return true;
  return SIZE_REJECTION_NAMES.has(error.name) && SIZE_REJECTION_MESSAGE.test(error.message ?? '');
}

/**
 * 전달 메일을 보낸다. 받은 메일 id 로 만든 멱등 키를 걸어, 같은 알림이 다시 와도 한 통만 나간다.
 * 「같은 멱등 키인데 내용이 다르다」는 거절(재시도 사이 전달 주소가 바뀜)은 이미 보낸 것이다.
 * 크기 초과 거절은 `too_large` 로 돌려준다 — 첨부를 빼고 다시 보낼지는 호출부(`deliverForwardMail`)가 정한다.
 * 그 밖의 거절·오류는 던진다 — 오류 문구에는 분류값만 싣는다(발송 서비스의 문구는 주소를 담을 수 있다).
 */
export async function sendForwardMail(
  mail: ForwardMail,
  receivedEmailId: string,
  variant: ForwardMailVariant = 'full',
): Promise<'sent' | 'already_sent' | 'too_large'> {
  const { data, error } = await getResend().emails.send(mail, {
    idempotencyKey: replyForwardIdempotencyKey(receivedEmailId, variant),
  });
  if (error) {
    if (error.name === 'invalid_idempotent_request') return 'already_sent';
    if (isSizeRejection(error)) return 'too_large';
    throw new InternalFailure(`회신 전달 발송 실패 — ${error.name} (${error.statusCode ?? '-'})`);
  }
  if (!data?.id) throw new InternalFailure('회신 전달 발송 실패 — 응답에 id 가 없습니다');
  return 'sent';
}

export interface ForwardDelivery {
  sent: 'sent' | 'already_sent';
  /** 첨부를 빼고 본문과 안내만 보냈다. */
  attachmentsOmitted: boolean;
}

/**
 * 전달 메일을 조립해 보낸다 — 첨부가 발송 한도를 넘으면 첨부 없이 본문과 안내만.
 *
 * - 인코딩한 첨부와 본문이 한도(여유를 둔 값)를 넘으면 처음부터 첨부 없이 보낸다. 거절될 것을 올려 보지 않는다.
 * - 한도 안쪽인데 발송 API 가 크기 초과로 거절하면 같은 방식으로 **한 번** 더 보낸다. 그것도 실패하면 던진다.
 * - 첨부가 없는 메일은 뺄 것이 없으니 크기 초과 거절이 곧 실패다.
 */
export async function deliverForwardMail(
  input: Omit<ForwardMailInput, 'omitAttachments'>,
  receivedEmailId: string,
): Promise<ForwardDelivery> {
  const sendWithoutAttachments = async (): Promise<ForwardDelivery> => {
    const mail = buildForwardMail({ ...input, omitAttachments: true });
    const sent = await sendForwardMail(mail, receivedEmailId, 'no_attachments');
    if (sent === 'too_large') {
      throw new InternalFailure('회신 전달 발송 실패 — 첨부를 빼도 크기 초과입니다');
    }
    return { sent, attachmentsOmitted: true };
  };

  if (exceedsForwardSizeBudget(input.reply)) return sendWithoutAttachments();

  const sent = await sendForwardMail(buildForwardMail(input), receivedEmailId);
  if (sent !== 'too_large') return { sent, attachmentsOmitted: false };
  if (input.reply.attachments.length === 0) {
    throw new InternalFailure('회신 전달 발송 실패 — 크기 초과인데 뺄 첨부가 없습니다');
  }
  return sendWithoutAttachments();
}

async function fetchReceivedEmail(receivedEmailId: string): Promise<GetReceivingEmailResponseSuccess> {
  const { data, error } = await getResend().emails.receiving.get(receivedEmailId);
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

/**
 * 시간당 상한을 넘어 이번 알림을 넘기지 않았다. 던지면 라우트가 500 으로 답하고 Resend 가 간격을 늘려 다시 보낸다 —
 * 장부에 적지 않았으므로 재시도가 처음부터 다시 하고, 원본은 수신 목록에 남는다.
 * Sentry 경고는 던지기 전에 이미 냈다(표식을 달아 라우트가 장애로 또 보내지 않는다).
 */
export class ReplyForwardCapExceeded extends InternalFailure {}

/**
 * 시간당 상한 확인 — 판정이 끝나 넘기기로 한 메일만 여기에 온다(넘기지 않는 메일은 상한과 무관하게 끝난다).
 * 세는 재료는 웹훅 장부에 「넘김」으로 적힌 최근 한 시간의 줄 수다.
 * 확인과 발송이 한 덩어리가 아니라 동시에 몰린 요청은 상한을 조금 넘겨 나갈 수 있다 — 한도 보호에는 그 정도면 된다.
 */
async function assertUnderHourlyCap(event: ReplyForwardEvent): Promise<void> {
  const forwardedLastHour = await countForwardedRepliesSince(
    new Date(Date.now() - REPLY_FORWARD_CAP_WINDOW_MS),
  );
  if (forwardedLastHour < REPLY_FORWARD_HOURLY_CAP) return;

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
      forwardedLastHour,
      cap: REPLY_FORWARD_HOURLY_CAP,
    },
  });
  const error = new ReplyForwardCapExceeded('회신 전달 시간당 상한 초과');
  markSentryCaptured(error);
  throw error;
}

/** 회신 전달 진입점 — 웹훅 라우트가 `email.received` 알림일 때 부른다. */
export async function forwardReceivedReply(event: ReplyForwardEvent): Promise<ReplyForwardResult> {
  const sendDomain = requireSendDomain();

  // ① 이미 처리한 알림
  if (await isWebhookEventRecorded(event.eventId)) {
    logger.info({ receivedEmailId: event.receivedEmailId, outcome: 'deduped' }, '[reply-forward] 중복 알림');
    return { outcome: 'deduped' };
  }

  // ② 조회·판정
  const received = await fetchReceivedEmail(event.receivedEmailId);
  const senderAccounts = extractSenderAccounts(received.received_for ?? [], sendDomain);
  if (senderAccounts.length === 0) return skip(event, 'no_sender_account');

  const sender = parseMailbox(received.from ?? '');
  if (!sender) return skip(event, 'unreadable_sender');
  if (findCompanyDomainMatch(sender.address, sendDomain, [])) return skip(event, 'company_domain');

  const resolution = await resolveForwardAddresses({
    senderAccounts,
    respondentAddress: sender.address,
    sendDomain,
  });
  if (resolution.addresses.length === 0 || resolution.senderAccount === null) {
    return skip(event, 'unused_sender_account');
  }
  const companyMatch = findCompanyDomainMatch(sender.address, sendDomain, resolution.addresses);
  if (companyMatch) {
    return skip(event, 'company_domain', {
      externalReplyDomain: companyMatch.kind === 'reply_domain' && companyMatch.external,
    });
  }

  // 넘기기로 한 메일만 시간당 상한을 본다.
  await assertUnderHourlyCap(event);

  // ③ 원본 내려받기·발송 — 이 사이 DB 트랜잭션을 잡지 않는다.
  if (!received.raw?.download_url) {
    throw new InternalFailure('받은 메일 원본이 아직 준비되지 않았습니다');
  }
  const content = await loadReceivedContent(received.raw.download_url);
  const { sent, attachmentsOmitted } = await deliverForwardMail(
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
