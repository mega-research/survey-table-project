import * as z from 'zod';

import { loadOperationsDataScope } from '@/server/data-scope';
import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { EXCEL_UNREADABLE_ERROR, rethrowExcelError } from '../services/excel-errors';

import { GetExistingContactsCountInput } from '../domain/contact-column';
import {
  IngestContactUploadInput,
  IngestContactUploadResultSchema,
  MatchContactUploadInput,
  MatchContactUploadResultSchema,
  ParseExcelPreviewInput,
  ParseExcelPreviewResultSchema,
} from '../domain/contact-upload';
import * as columnsSvc from '../services/contact-columns';
import * as uploadsSvc from '../services/contact-uploads';

const parsePreview = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(ParseExcelPreviewInput)
  .output(ParseExcelPreviewResultSchema)
  .handler(async ({ input, errors }) => {
    // surveyId 없는 무상태 엑셀 파싱이라 설문 capability 관문을 태울 대상이 없다 —
    // 설문에 닿는 ingest/matchPreview 가 관문을 지므로 authed 만 유지한다 (티켓 10).
    try {
      return await uploadsSvc.parseExcelPreview(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

const ingest = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(IngestContactUploadInput)
  .output(IngestContactUploadResultSchema)
  .handler(async ({ context, input, errors }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    try {
      return await uploadsSvc.ingestContactUpload(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

const matchPreview = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(MatchContactUploadInput)
  .output(MatchContactUploadResultSchema)
  .handler(async ({ context, input, errors }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    try {
      return await uploadsSvc.matchContactUpload(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

const existingCount = authed
  .input(GetExistingContactsCountInput)
  .output(z.number())
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    return columnsSvc.getExistingContactsCount(
      input.surveyId,
      await loadOperationsDataScope(input.surveyId),
    );
  });

export const uploads = {
  parsePreview,
  ingest,
  matchPreview,
  existingCount,
};
