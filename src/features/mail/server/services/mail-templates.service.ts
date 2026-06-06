import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { mailTemplates, type MailTemplate } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';
import { deleteImagesFromR2Server, deleteR2ObjectsByKey } from '@/lib/image-utils-server';
import { promoteMailAttachments } from '@/lib/mail/mail-attachment-promote';
import {
  diffOrphanAttachmentKeys,
  diffOrphanImages,
  extractMailTemplateAssets,
} from '@/lib/mail/mail-image-extractor';
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
  const [bodyHtml, attachments] = await Promise.all([
    promoteMailImages(rawBodyHtml),
    promoteMailAttachments(rawAttachments),
  ]);
  return { bodyHtml, attachments };
}

/**
 * DB update 성공 후 영구 위치에서 사라진 에셋(orphan)을 R2 에서 정리.
 * cleanup 자체 실패는 사용자에게 노출 안 함 — best-effort.
 */
function cleanupOrphans(
  oldAssets: ReturnType<typeof extractMailTemplateAssets>,
  newAssets: ReturnType<typeof extractMailTemplateAssets>,
): void {
  const orphanImageUrls = diffOrphanImages(oldAssets.imageUrls, newAssets.imageUrls);
  const orphanAttachmentKeys = diffOrphanAttachmentKeys(
    oldAssets.attachmentKeys,
    newAssets.attachmentKeys,
  );
  if (orphanImageUrls.length > 0) {
    deleteImagesFromR2Server(orphanImageUrls).catch(console.error);
  }
  if (orphanAttachmentKeys.length > 0) {
    deleteR2ObjectsByKey(orphanAttachmentKeys).catch(console.error);
  }
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
  return { id: row.id, attachments };
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

  // R2 cleanup 을 위해 기존 템플릿 에셋 먼저 fetch.
  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { bodyHtml: true, attachments: true },
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

  cleanupOrphans(
    extractMailTemplateAssets(oldRow),
    extractMailTemplateAssets({ bodyHtml, attachments }),
  );

  return { attachments };
}

/**
 * 메일 템플릿 soft delete.
 * 성공 후 모든 에셋 R2 cleanup (best-effort). 미존재 시 MailTemplateNotFoundError throw.
 */
export async function deleteMailTemplate(params: DeleteMailTemplateInput): Promise<void> {
  const { surveyId, templateId } = params;

  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { bodyHtml: true, attachments: true },
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

  // soft delete 성공 후 모든 에셋 R2 cleanup (best-effort)
  const assets = extractMailTemplateAssets(oldRow);
  if (assets.imageUrls.length > 0) {
    deleteImagesFromR2Server(assets.imageUrls).catch(console.error);
  }
  if (assets.attachmentKeys.length > 0) {
    deleteR2ObjectsByKey(assets.attachmentKeys).catch(console.error);
  }
}
