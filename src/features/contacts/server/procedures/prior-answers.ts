import { authed, pub, withRateLimit } from '@/server/orpc';

import { EXCEL_UNREADABLE_ERROR, rethrowExcelError } from '../excel-errors';

import {
  ImportPriorAnswersInput,
  ImportPriorAnswersResultSchema,
  LookupPriorAnswersInput,
  PriorAnswersOutput,
  SuggestPriorAnswerMappingInput,
  SuggestPriorAnswerMappingResultSchema,
} from '../../domain/prior-answers';
import * as svc from '../services/contact-prior-answers.service';
import * as importSvc from '../services/prior-answer-import.service';

/**
 * inviteToken 으로 이월 응답 조회(pub). 응답 페이지 프리필 전용.
 * 무효 토큰·이월 응답 없음은 null — 호출부가 빈 설문으로 폴백한다.
 * 공개 읽기 조회이므로 attrs lookup 과 같은 lookup 그룹으로 rate limit 한다.
 */
const lookup = pub
  .use(withRateLimit('lookup'))
  .input(LookupPriorAnswersInput)
  .output(PriorAnswersOutput)
  .handler(async ({ input }) => svc.lookupPriorAnswers(input));

/** 시트/헤더 행을 고른 뒤의 매핑 자동 제안. */
const suggestMapping = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(SuggestPriorAnswerMappingInput)
  .output(SuggestPriorAnswerMappingResultSchema)
  .handler(async ({ input, errors }) => {
    try {
      return await importSvc.suggestPriorAnswerImportMapping(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

/** 이월 응답 적재. dryRun 이면 계산만 하고 쓰지 않는다. */
const importSheet = authed
  .errors(EXCEL_UNREADABLE_ERROR)
  .input(ImportPriorAnswersInput)
  .output(ImportPriorAnswersResultSchema)
  .handler(async ({ input, errors }) => {
    try {
      return await importSvc.importPriorAnswers(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

export const priorAnswers = {
  lookup,
  suggestMapping,
  import: importSheet,
};
