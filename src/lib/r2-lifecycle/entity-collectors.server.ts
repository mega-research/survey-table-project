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

export interface SurveyContentKeys {
  /** CASCADE 소멸 범위에서 추출한 R2 키 (중복 제거) */
  keys: string[];
  /** 함께 소멸할 survey_versions 행 id — 파생 참조 인덱스 해제 대상 */
  versionIds: string[];
}

/**
 * 설문 hard delete 의 CASCADE 소멸 범위 전체에서 R2 키를 수집한다.
 * 반드시 삭제와 같은 트랜잭션에서, 삭제 전에 호출한다 — 삭제 후에는 참조를
 * 복원할 수 없다.
 *
 * 범위: 설문 responseHeader · 질문 행 전체(JSONB 포함) · 버전 스냅샷 ·
 * 소속 메일 템플릿(soft delete 포함) · 캠페인 스냅샷.
 * mail_recipients.sendPayloadSnapshot 은 캠페인 스냅샷과 키가 동일해 생략
 * (발송분 보호는 발송 장부 소관).
 *
 * 버전 id 를 함께 반환한다. r2_key_refs 에는 FK 가 없어 CASCADE 가 닿지
 * 않으므로, 호출자가 삭제 트랜잭션 안에서 인덱스를 직접 해제해야 한다.
 */
export async function collectSurveyContentKeys(
  dbc: R2DbExecutor,
  surveyId: string,
): Promise<SurveyContentKeys> {
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
    .select({ id: surveyVersions.id, snapshot: surveyVersions.snapshot })
    .from(surveyVersions)
    .where(eq(surveyVersions.surveyId, surveyId));
  add(versionRows.map((row) => row.snapshot));

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

  return { keys: [...keys], versionIds: versionRows.map((row) => row.id) };
}
