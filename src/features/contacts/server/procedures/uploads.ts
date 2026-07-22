import * as z from 'zod';

import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { authed } from '@/server/orpc';

import { GetExistingContactsCountInput } from '../../domain/contact-column';
import {
  IngestContactUploadInput,
  IngestContactUploadResultSchema,
  ParseExcelPreviewInput,
  ParseExcelPreviewResultSchema,
} from '../../domain/contact-upload';
import * as columnsSvc from '../services/contact-columns.service';
import * as uploadsSvc from '../services/contact-uploads.service';

const parsePreview = authed
  .input(ParseExcelPreviewInput)
  .output(ParseExcelPreviewResultSchema)
  .handler(({ input }) => uploadsSvc.parseExcelPreview(input));

const ingest = authed
  .input(IngestContactUploadInput)
  .output(IngestContactUploadResultSchema)
  .handler(({ input }) => uploadsSvc.ingestContactUpload(input));

const existingCount = authed
  .input(GetExistingContactsCountInput)
  .output(z.number())
  .handler(async ({ input }) =>
    columnsSvc.getExistingContactsCount(input.surveyId, await loadOperationsDataScope(input.surveyId)),
  );

export const uploads = {
  parsePreview,
  ingest,
  existingCount,
};
