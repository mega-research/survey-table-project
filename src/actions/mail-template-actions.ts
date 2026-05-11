'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { mailTemplates } from '@/db/schema/mail';
import { requireAuth } from '@/lib/auth';
import { deleteImagesFromR2Server, deleteR2ObjectsByKey } from '@/lib/image-utils-server';
import {
  diffOrphanAttachmentKeys,
  diffOrphanImages,
  extractMailTemplateAssets,
} from '@/lib/mail/mail-image-extractor';
import {
  mailTemplateInputSchema,
  type MailTemplateInput,
} from '@/lib/mail/schema';
import { promoteMailImages } from '@/lib/mail/mail-image-promote';
import { extractVariableKeys } from '@/lib/mail/variable-extractor';

interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

export async function createMailTemplateAction(
  surveyId: string,
  input: MailTemplateInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const { name, subject, bodyHtml: rawBodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;

  // tmp/mail/ 이미지를 영구 prefix로 promote
  const bodyHtml = await promoteMailImages(rawBodyHtml);

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

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  return { ok: true, data: { id: row.id } };
}

export async function updateMailTemplateAction(
  surveyId: string,
  templateId: string,
  input: MailTemplateInput,
): Promise<ActionResult> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const { name, subject, bodyHtml: rawBodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;

  // R2 cleanup을 위해 기존 템플릿 에셋 먼저 fetch (updatedAt은 optimistic lock에 사용)
  const oldRow = await db.query.mailTemplates.findFirst({
    where: and(
      eq(mailTemplates.id, templateId),
      eq(mailTemplates.surveyId, surveyId),
      isNull(mailTemplates.deletedAt),
    ),
    columns: { bodyHtml: true, attachments: true, updatedAt: true },
  });

  if (!oldRow) {
    return { ok: false, error: '템플릿을 찾을 수 없습니다' };
  }

  // tmp/mail/ 이미지를 영구 prefix로 promote (oldRow fetch 이후 실행)
  const bodyHtml = await promoteMailImages(rawBodyHtml);
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
        eq(mailTemplates.updatedAt, oldRow.updatedAt),  // optimistic lock
        isNull(mailTemplates.deletedAt),
      ),
    )
    .returning({ id: mailTemplates.id });

  if (result.length === 0) {
    // race 또는 row gone
    return {
      ok: false,
      error: '다른 사용자가 이 템플릿을 수정했습니다. 새로고침 후 다시 시도하세요.',
    };
  }

  // DB update 성공 후 orphan 에셋 R2 cleanup (실패해도 user에게 에러 노출 안 함)
  const oldAssets = extractMailTemplateAssets(oldRow);
  const newAssets = extractMailTemplateAssets({ bodyHtml, attachments });

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

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates/${templateId}/edit`);
  return { ok: true };
}

export async function deleteMailTemplateAction(
  surveyId: string,
  templateId: string,
): Promise<ActionResult> {
  await requireAuth();

  // R2 cleanup을 위해 삭제 전 에셋 fetch
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

  // soft delete 성공 후 모든 에셋 R2 cleanup (실패해도 user에게 에러 노출 안 함)
  const assets = extractMailTemplateAssets(oldRow);

  if (assets.imageUrls.length > 0) {
    deleteImagesFromR2Server(assets.imageUrls).catch(console.error);
  }
  if (assets.attachmentKeys.length > 0) {
    deleteR2ObjectsByKey(assets.attachmentKeys).catch(console.error);
  }

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  return { ok: true };
}
