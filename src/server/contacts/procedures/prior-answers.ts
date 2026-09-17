import { authed, pub, withRateLimit } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { EXCEL_UNREADABLE_ERROR, rethrowExcelError } from '../services/excel-errors';

import * as z from 'zod';

import {
  ImportPriorAnswersInput,
  ImportPriorAnswersResultSchema,
  LookupPriorAnswersInput,
  PriorAnswersOutput,
  SavePriorAnswerImportConfigInput,
  SuggestPriorAnswerMappingInput,
  SuggestPriorAnswerMappingResultSchema,
} from '../domain/prior-answers';
import * as svc from '../services/contact-prior-answers';
import * as importSvc from '../services/prior-answer-import';

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
  .handler(async ({ input, context, errors }) => {
    // 이월 응답은 조사 대상 행에 붙는 쓰기라 명단 업로드와 같은 capability 를 진다.
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
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
  .handler(async ({ input, context, errors }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'contacts.manage');
    try {
      return await importSvc.importPriorAnswers(input);
    } catch (error) {
      rethrowExcelError(error, errors);
    }
  });

/** 확정 매핑·값 대응 보관 — 다시 올릴 때 재사용된다. */
const saveConfig = authed
  .input(SavePriorAnswerImportConfigInput)
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ input, context }) => {
    // surveys 행 설정 쓰기라 survey.edit 이다 — view·contacts 계열 cap 으로 지키면 실사원이
    // 팀 공용 설정에 닿는다(운영 제어·쿼터 저장과 같은 원칙).
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return importSvc.savePriorAnswerImportConfig(input);
  });

export const priorAnswers = {
  lookup,
  suggestMapping,
  import: importSheet,
  saveConfig,
};
