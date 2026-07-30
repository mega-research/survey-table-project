import 'server-only';

import { eq } from 'drizzle-orm';

import {
  mailCampaigns,
  mailTemplates,
  questions,
  surveys,
  surveyVersions,
} from '@/db/schema';
import type { R2DbExecutor } from '@/lib/r2-lifecycle/deletion-queue.server';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';

/**
 * 설문 hard delete 의 CASCADE 소멸 범위 전체에서 R2 키를 수집한다.
 * 반드시 삭제와 같은 트랜잭션에서, 삭제 전에 호출한다 — 삭제 후에는 참조를
 * 복원할 수 없다.
 *
 * 범위: 설문 responseHeader · 질문 행 전체(JSONB 포함) · 버전 스냅샷 ·
 * 소속 메일 템플릿(soft delete 포함) · 캠페인 스냅샷.
 * mail_recipients.sendPayloadSnapshot 은 캠페인 스냅샷과 키가 동일해 생략
 * (발송분 보호는 발송 장부 소관).
 */
export async function collectSurveyContentKeys(
  dbc: R2DbExecutor,
  surveyId: string,
): Promise<string[]> {
  const keys = new Set<string>();
  const add = (values: unknown) => {
    for (const key of extractR2KeysFromJsonbValue(values)) keys.add(key);
  };

  const [surveyRow] = await dbc
    .select({ responseHeader: surveys.responseHeader })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  add(surveyRow?.responseHeader);

  const questionRows = await dbc.select().from(questions).where(eq(questions.surveyId, surveyId));
  add(questionRows);

  const versionRows = await dbc
    .select({ snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.surveyId, surveyId));
  add(versionRows);

  // soft delete 된 템플릿도 CASCADE 로 소멸하므로 deletedAt 무관 전수 수집
  const templateRows = await dbc
    .select({ bodyHtml: mailTemplates.bodyHtml, attachments: mailTemplates.attachments })
    .from(mailTemplates)
    .where(eq(mailTemplates.surveyId, surveyId));
  add(templateRows);

  const campaignRows = await dbc
    .select({
      bodyHtmlSnapshot: mailCampaigns.bodyHtmlSnapshot,
      attachmentsSnapshot: mailCampaigns.attachmentsSnapshot,
    })
    .from(mailCampaigns)
    .where(eq(mailCampaigns.surveyId, surveyId));
  add(campaignRows);

  return [...keys];
}
