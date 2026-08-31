import * as z from 'zod';

import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { authed } from '@/server/orpc';

import { EXCEL_UNREADABLE_ERROR, rethrowExcelError } from '../excel-errors';

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
