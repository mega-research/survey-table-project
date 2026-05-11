'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { mailTemplates } from '@/db/schema/mail';
import { requireAuth } from '@/lib/auth';
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

export async function createMailTemplateAction(
  surveyId: string,
  input: MailTemplateInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAuth();
  const parsed = mailTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다' };
  }

  const { name, subject, bodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;
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

  const { name, subject, bodyHtml, fromLocal, fromName, replyTo, attachments } = parsed.data;
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

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates/${templateId}/edit`);
  return { ok: true };
}

export async function deleteMailTemplateAction(
  surveyId: string,
  templateId: string,
): Promise<ActionResult> {
  await requireAuth();

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

  revalidatePath(`/admin/surveys/${surveyId}/operations/mail-templates`);
  return { ok: true };
}

