import { eq } from 'drizzle-orm';
import 'server-only';

import {
  mailCampaigns,
  mailTemplates,
  questions,
  surveyDocuments,
  surveys,
  surveyVersions,
} from '@/db/schema';

import type { R2DbExecutor } from './deletion-queue';
import { extractR2KeysFromJsonbValue } from './key-extract';

export interface SurveyContentKeys {
  /** 설문 콘텐츠 전 범위에서 추출한 R2 키 (중복 제거) */
  keys: string[];
}

/**
 * 설문 콘텐츠 전 범위에서 R2 키를 수집한다.
 *
 * 삭제와 같은 트랜잭션에서 호출한다. 티켓 17 이전에는 「삭제 후에는 참조를 복원할 수 없다」가
 * 이유였지만(hard delete + CASCADE) 지금은 행이 살아남으므로 그 절박함은 없다 — 그럼에도
 * 유예 큐 등록은 관행 그대로 남긴다(티켓 17 지시). 등록된 후보는 살아남은 행이 참조를
 * 주장하므로 집행 직전 재확인에서 '보존됨' 으로 닫힌다.
 *
 * 범위: 설문 responseHeader · 질문 행 전체(JSONB 포함) · 버전 스냅샷 ·
 * 조사표(survey_documents.file_key) · 소속 메일 템플릿(soft delete 포함) · 캠페인 스냅샷.
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

  // 조사표 PDF — file_key 는 bare 키라 추출 게이트를 그대로 통과한다 (0097)
  const documentRows = await dbc
    .select({ fileKey: surveyDocuments.fileKey })
    .from(surveyDocuments)
    .where(eq(surveyDocuments.surveyId, surveyId));
  add(documentRows);

  // soft delete 된 템플릿도 함께 수집한다 — 그 행은 파일 참조 자격을 잃으므로(참조 표면의
  // mail_templates 술어) 여기서 안 거두면 어떤 후보로도 등록되지 않는다.
  // (예전 사유였던 "설문 삭제의 CASCADE 로 소멸하므로" 는 티켓 17 의 soft delete 전환으로
  //  더 이상 참이 아니다 — 수집이 옳은 이유는 위쪽이다.)
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

  return { keys: [...keys] };
}
