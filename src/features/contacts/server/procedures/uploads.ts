import * as z from 'zod';

import { EXCEL_UNREADABLE_MESSAGE, ExcelReadError } from '@/lib/contacts/excel-parser';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { authed } from '@/server/orpc';

import { GetExistingContactsCountInput } from '../../domain/contact-column';
import {
  IngestContactUploadInput,
  IngestContactUploadResultSchema,
  MatchContactUploadInput,
  MatchContactUploadResultSchema,
  ParseExcelPreviewInput,
  ParseExcelPreviewResultSchema,
} from '../../domain/contact-upload';
import * as columnsSvc from '../services/contact-columns.service';
import * as uploadsSvc from '../services/contact-uploads.service';

/**
 * 읽을 수 없는 엑셀은 typed error 로 내보낸다. 평범한 Error 로 두면 oRPC 가 운영에서
 * message 를 'Internal server error' 로 마스킹해, 업로드 마법사가 사용자에게 원인도
 * 대처법도 못 보여준다 (실제로 접두사 네임스페이스 xlsx 가 500 TypeError 로 나갔다).
 */
const EXCEL_UNREADABLE_ERROR = {
  EXCEL_UNREADABLE: { status: 400, message: EXCEL_UNREADABLE_MESSAGE },
} as const;

/** ExcelReadError → typed error. 그 외 예외는 그대로 통과시킨다. */
function rethrowExcelError(
  error: unknown,
  errors: { EXCEL_UNREADABLE: (init?: { message?: string }) => Error },
): never {
  if (error instanceof ExcelReadError) {
    throw errors.EXCEL_UNREADABLE({ message: error.message });
  }
  throw error;
}

const parsePreview = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(ParseExcelPreviewInput)
  .output(ParseExcelPreviewResultSchema)
  .handler(async ({ input, errors }) => {
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
  .handler(async ({ input, errors }) => {
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
  .handler(async ({ input, errors }) => {
    try {
      return await uploadsSvc.matchContactUpload(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

const existingCount = authed
  .input(GetExistingContactsCountInput)
  .output(z.number())
  .handler(async ({ input }) =>
    columnsSvc.getExistingContactsCount(input.surveyId, await loadOperationsDataScope(input.surveyId)),
  );

export const uploads = {
  parsePreview,
  ingest,
  matchPreview,
  existingCount,
};
