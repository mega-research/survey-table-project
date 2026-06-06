import * as z from 'zod';

import { authed } from '@/server/orpc';

import {
  ExportLibrarySchema,
  ImportLibraryInput,
  PresetQuestionsSchema,
} from '../../domain/library-transfer';
import * as svc from '../services/library-transfer.service';

// 라이브러리 내보내기 — JSON 문자열 반환
const exportLibrary = authed
  .output(ExportLibrarySchema)
  .handler(() => svc.exportLibrary());

// 라이브러리 가져오기 — { json } 입력을 service 의 positional string 인자로 펼침
const importLibrary = authed
  .input(ImportLibraryInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input }) => {
    await svc.importLibrary(input.json);
    return { ok: true as const };
  });

// 프리셋 질문 초기화 — SavedQuestion 배열 반환
const initializePresets = authed
  .output(PresetQuestionsSchema)
  .handler(() => svc.initializePresetQuestions());

export const transfer = {
  export: exportLibrary,
  import: importLibrary,
  initializePresets,
};
