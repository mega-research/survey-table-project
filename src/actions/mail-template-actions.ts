'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { mailTemplates } from '@/db/schema/mail';
import type { MailAttachment } from '@/db/schema/schema-types';
import { requireAuth } from '@/lib/auth';
import { deleteImagesFromR2Server, deleteR2ObjectsByKey } from '@/lib/image-utils-server';
import {
  AttachmentPromoteError,
  promoteMailAttachments,
} from '@/lib/mail/mail-attachment-promote';
import {
  diffOrphanAttachmentKeys,
  diffOrphanImages,
  extractMailTemplateAssets,
} from '@/lib/mail/mail-image-extractor';
import { promoteMailImages } from '@/lib/mail/mail-image-promote';
import {
  mailTemplateInputSchema,
  type MailTemplateInput,
} from '@/lib/mail/schema';
import { extractVariableKeys } from '@/lib/mail/variable-extractor';

interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

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

function promoteErrorResponse(err: unknown): ActionResult<never> | null {
  if (err instanceof AttachmentPromoteError) {
    return {
      ok: false,
      error: `첨부 파일을 저장하지 못했습니다 (${err.failedKeys.length}개). 잠시 후 다시 시도해 주세요.`,
    };
  }
  return null;
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

export async function createMailTemplateAction(
  surveyId: string,
  input: MailTemplateInput,
): Promise<ActionResult<{ id: string; attachments: MailAttachment[] }>> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const {
    name, subject, bodyHtml: rawBodyHtml, fromLocal, fromName, replyTo,
    attachments: rawAttachments,
  } = parsed.data;

  let promoted: Awaited<ReturnType<typeof promoteAssets>>;
  try {
    promoted = await promoteAssets(rawBodyHtml, rawAttachments);
  } catch (err) {
    const errResp = promoteErrorResponse(err);
    if (errResp) return errResp;
    throw err;
  }
  const { bodyHtml, attachments } = promoted;
  const variablesUsed = extractVariableKeys(subject, bodyHtml, fromName);

  const [row] = await db
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

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail/templates`);
  // promote 된 영구 key 를 클라이언트로 돌려줘 state 동기화 — 저장 직후 발송에서
  // stale tmp prefix 로 R2 download 시도하는 사고 차단.
  return { ok: true, data: { id: row.id, attachments } };
}

export async function updateMailTemplateAction(
  surveyId: string,
  templateId: string,
  input: MailTemplateInput,
): Promise<ActionResult<{ attachments: MailAttachment[] }>> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const {
    name, subject, bodyHtml: rawBodyHtml, fromLocal, fromName, replyTo,
    attachments: rawAttachments,
  } = parsed.data;

  // R2 cleanup 을 위해 기존 템플릿 에셋 먼저 fetch.
  // optimistic lock 은 의도적으로 제거 — PG timestamptz(μs) ↔ JS Date(ms) 정밀도
  // mismatch 로 단일 사용자도 거짓 충돌을 일으켰음 (메모리 노트 참조).
  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { bodyHtml: true, attachments: true },
  });

  if (!oldRow) {
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  let promoted: Awaited<ReturnType<typeof promoteAssets>>;
  try {
    promoted = await promoteAssets(rawBodyHtml, rawAttachments);
  } catch (err) {
    const errResp = promoteErrorResponse(err);
    if (errResp) return errResp;
    throw err;
  }
  const { bodyHtml, attachments } = promoted;
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
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  cleanupOrphans(
    extractMailTemplateAssets(oldRow),
    extractMailTemplateAssets({ bodyHtml, attachments }),
  );

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail/templates`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/mail/templates/${templateId}/edit`);
  return { ok: true, data: { attachments } };
}

export async function deleteMailTemplateAction(
  surveyId: string,
  templateId: string,
): Promise<ActionResult> {
  await requireAuth();

  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { bodyHtml: true, attachments: true },
  });

  if (!oldRow) {
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
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
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  // soft delete 성공 후 모든 에셋 R2 cleanup (best-effort)
  const assets = extractMailTemplateAssets(oldRow);
  if (assets.imageUrls.length > 0) {
    deleteImagesFromR2Server(assets.imageUrls).catch(console.error);
  }
  if (assets.attachmentKeys.length > 0) {
    deleteR2ObjectsByKey(assets.attachmentKeys).catch(console.error);
  }

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail/templates`);
  return { ok: true };
}
