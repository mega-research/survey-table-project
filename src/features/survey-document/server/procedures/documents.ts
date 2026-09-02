import * as z from 'zod';

import { assertSurveyAccess, scoped } from '@/server/orpc';

import {
  AttachSurveyDocumentInput,
  ListSurveyDocumentsInput,
  RemoveSurveyDocumentInput,
  SurveyDocumentSchema,
} from '../../domain/survey-document';
import * as svc from '../services/survey-documents.service';

/**
 * 조사표 CRUD. 게스트 기획자도 자기 설문의 조사표를 다루므로 scoped 베이스이고,
 * 핸들러 첫 줄에서 assertSurveyAccess 로 설문 일치를 강제한다.
 */
const list = scoped
  .input(ListSurveyDocumentsInput)
  .output(z.array(SurveyDocumentSchema))
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.listSurveyDocuments(input);
  });

const attach = scoped
  .input(AttachSurveyDocumentInput)
  .output(SurveyDocumentSchema)
  .handler(({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    return svc.attachSurveyDocument(input);
  });

const remove = scoped
  .input(RemoveSurveyDocumentInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    assertSurveyAccess(context.user.id, input.surveyId);
    await svc.removeSurveyDocument(input);
    return { ok: true as const };
  });

export const documents = {
  list,
  attach,
  remove,
};
