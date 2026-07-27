import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { mailTemplates, type MailTemplate } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';
import { promoteMailAttachments } from '@/lib/mail/mail-attachment-promote';
import { ensureImageLinkBandSlices } from '@/lib/mail/image-link-band-slices';
import { promoteMailImages } from '@/lib/mail/mail-image-promote';
import { extractVariableKeys } from '@/lib/mail/variable-extractor';

import type {
  CreateMailTemplateInput,
  CreateMailTemplateOutput,
  DeleteMailTemplateInput,
  UpdateMailTemplateInput,
  UpdateMailTemplateOutput,
} from '../../domain/mail-template';

// AttachmentPromoteError 는 procedure 가 ORPCError 로 매핑하기 위해 재노출.
export { AttachmentPromoteError } from '@/lib/mail/mail-attachment-promote';

/** 템플릿을 찾지 못했을 때 — procedure 가 NOT_FOUND 로 매핑. */
export class MailTemplateNotFoundError extends Error {
  constructor() {
    super('템플릿을 찾을 수 없습니다');
    this.name = 'MailTemplateNotFoundError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 한 설문의 메일 템플릿 목록 (soft delete 제외, 최근 갱신순).
 * React.cache 로 동일 요청 내 중복 호출 dedupe (RSC 페이지가 의존하므로 보존).
 */
export const getMailTemplatesBySurvey = cache(
  async (surveyId: string): Promise<MailTemplate[]> => {
    return await db
      .select()
      .from(mailTemplates)
      .where(and(eq(mailTemplates.surveyId, surveyId), isNull(mailTemplates.deletedAt)))
      .orderBy(desc(mailTemplates.updatedAt));
  },
);

/**
 * 단건 조회. surveyId 가드 — 다른 설문의 템플릿 못 보게.
 * 잘못된 UUID 형식 / 없거나 다른 설문 소속이면 null (PG throw 방지).
 */
export const getMailTemplate = cache(
  async (surveyId: string, templateId: string): Promise<MailTemplate | null> => {
    if (!UUID_RE.test(surveyId) || !UUID_RE.test(templateId)) return null;
    const rows = await db
      .select()
      .from(mailTemplates)
      .where(
        and(
          eq(mailTemplates.id, templateId),
          eq(mailTemplates.surveyId, surveyId),
          isNull(mailTemplates.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
);

/**
 * tmp/* R2 객체를 영구 prefix 로 promote — bodyHtml 이미지와 attachment 파일을 동시에.
 * 첨부 promote 가 부분 실패하면 `AttachmentPromoteError` 가 throw 되어 caller 가
 * 사용자 친화 메시지로 응답하도록 한다.
 */
async function promoteAssets(
  rawBodyHtml: string,
  rawAttachments: MailAttachment[],
): Promise<{ bodyHtml: string; attachments: MailAttachment[] }> {
  const [promotedBodyHtml, attachments] = await Promise.all([
    promoteMailImages(rawBodyHtml),
    promoteMailAttachments(rawAttachments),
  ]);
  // 클릭 영역 밴드 슬라이스는 promote 이후(영구 URL 기준)에 생성해야 한다
  const bodyHtml = await ensureImageLinkBandSlices(promotedBodyHtml);
  return { bodyHtml, attachments };
}

/**
 * 메일 템플릿 생성.
 * 인증은 authed 미들웨어가 담당. 캐시 갱신은 소비처 router.refresh/replace 로 대체.
 * promote 실패는 AttachmentPromoteError throw — procedure 가 사용자 메시지로 변환.
 */
export async function createMailTemplate(
  params: CreateMailTemplateInput,
): Promise<CreateMailTemplateOutput> {
  const { surveyId, input } = params;
  const {
    name,
    subject,
    bodyHtml: rawBodyHtml,
    fromLocal,
    fromName,
    replyTo,
    attachments: rawAttachments,
  } = input;

  const { bodyHtml, attachments } = await promoteAssets(rawBodyHtml, rawAttachments);
  const variablesUsed = extractVariableKeys(subject, bodyHtml, fromName);

  const insertedRows = await db
    .insert(mailTemplates)
    .values({
      surveyId,
      name,
      subject,
      bodyHtml,
      fromLocal,
      fromName,
      replyTo,
      attachments,
      variablesUsed,
    })
    .returning({ id: mailTemplates.id });
  const row = insertedRows[0];
  if (!row) throw new Error('createMailTemplate: 템플릿 생성 실패');

  // promote 된 영구 key 를 클라이언트로 돌려줘 state 동기화 — 저장 직후 발송에서
  // stale tmp prefix 로 R2 download 시도하는 사고 차단.
  return { id: row.id, bodyHtml, attachments };
}

/**
 * 메일 템플릿 수정.
 * optimistic lock 은 의도적으로 제거 — PG timestamptz(μs) ↔ JS Date(ms) 정밀도
 * mismatch 로 단일 사용자도 거짓 충돌을 일으켰음 (메모리 노트 참조).
 * 템플릿 미존재 시 MailTemplateNotFoundError throw.
 */
export async function updateMailTemplate(
  params: UpdateMailTemplateInput,
): Promise<UpdateMailTemplateOutput> {
  const { surveyId, templateId, input } = params;
  const {
    name,
    subject,
    bodyHtml: rawBodyHtml,
    fromLocal,
    fromName,
    replyTo,
    attachments: rawAttachments,
  } = input;

  // promote(R2 move) 를 시도하기 전에 존재 여부부터 확인해 빠르게 실패시킨다.
  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { id: true },
  });

  if (!oldRow) {
    throw new MailTemplateNotFoundError();
  }

  const { bodyHtml, attachments } = await promoteAssets(rawBodyHtml, rawAttachments);
  const variablesUsed = extractVariableKeys(subject, bodyHtml, fromName);

  const result = await db
    .update(mailTemplates)
    .set({
      name,
      subject,
      bodyHtml,
      fromLocal,
      fromName,
      replyTo,
      attachments,
      variablesUsed,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailTemplates.id, templateId),
        eq(mailTemplates.surveyId, surveyId),
        isNull(mailTemplates.deletedAt),
      ),
    )
    .returning({ id: mailTemplates.id });

  if (result.length === 0) {
    throw new MailTemplateNotFoundError();
  }

  // 수정으로 본문/첨부에서 빠진 이전 영구 에셋은 R2 에서 지우지 않는다. 이미 발송된
  // 캠페인 스냅샷(mail_campaigns.*Snapshot)과 수신자 메일함에 전달된 메일이 같은
  // mail/ URL·첨부 키를 참조하므로, 템플릿을 고쳤다고 지우면 발송 완료 메일이 깨진다.

  return { bodyHtml, attachments };
}

/**
 * 메일 템플릿 soft delete. R2 에셋은 지우지 않는다(사유는 아래 주석 참조).
 * 미존재 시 MailTemplateNotFoundError throw.
 */
export async function deleteMailTemplate(params: DeleteMailTemplateInput): Promise<void> {
  const { surveyId, templateId } = params;

  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { id: true },
  });

  if (!oldRow) {
    throw new MailTemplateNotFoundError();
  }

  const result = await db
    .update(mailTemplates)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(mailTemplates.id, templateId),
        eq(mailTemplates.surveyId, surveyId),
        isNull(mailTemplates.deletedAt),
      ),
    )
    .returning({ id: mailTemplates.id });

  if (result.length === 0) {
    throw new MailTemplateNotFoundError();
  }

  // soft delete 이후에도 R2 에셋은 지우지 않는다. 발송된 캠페인 스냅샷과 수신자
  // 메일함에 전달된 메일이 같은 mail/ URL·첨부 키를 참조하므로, 템플릿 삭제가
  // 그 메일들을 파괴해서는 안 된다.
}
