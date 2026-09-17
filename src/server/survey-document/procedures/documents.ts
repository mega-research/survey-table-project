import * as z from 'zod';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  AttachSurveyDocumentInput,
  ListSurveyDocumentsInput,
  RemoveSurveyDocumentInput,
  SurveyDocumentSchema,
} from '../domain/survey-document';
import * as svc from '../services/survey-documents';

/**
 * 조사표 CRUD. 빌더 오서링 표면이라 authed 베이스이고, 핸들러 첫 줄에서 설문 capability 를
 * 묻는다 — 조회는 survey.view, 붙이기·떼기는 survey.edit (빌더의 다른 표면과 같은 매핑).
 */
const list = authed
  .input(ListSurveyDocumentsInput)
  .output(z.array(SurveyDocumentSchema))
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.listSurveyDocuments(input);
  });

const attach = authed
  .input(AttachSurveyDocumentInput)
  .output(SurveyDocumentSchema)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.attachSurveyDocument(input);
  });

const remove = authed
  .input(RemoveSurveyDocumentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    await svc.removeSurveyDocument(input);
    return { ok: true as const };
  });

export const documents = {
  list,
  attach,
  remove,
};
