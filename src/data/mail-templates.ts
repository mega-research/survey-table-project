import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db';
import { mailTemplates, type MailTemplate } from '@/db/schema/mail';

/**
 * 한 설문의 메일 템플릿 목록 (soft delete 제외, 최근 갱신순).
 * React.cache 로 동일 요청 내 중복 호출 dedupe.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
