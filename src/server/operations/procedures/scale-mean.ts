import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { SetScaleMeanQuestionsInput, SetScaleMeanQuestionsResult } from '../domain/scale-mean';
import * as svc from '../services/scale-mean';

/**
 * 척도 평균 「문항 선택」 저장 — CONTEXT.md 「척도 평균」.
 * 내부 담당자 화면이라 authed(외부 계정 FORBIDDEN). 문항 설정을 바꾸는 쓰기라 컬럼 픽커 저장과
 * 같은 survey.edit 관문을 진다 — authed 는 내부 계정 전부가 지나므로 관문이 없으면 다른 팀
 * 설문의 문항을 바꿀 수 있다. 후보 밖 문항 거부는 throw 가 아니라 { ok:false, error } 로 통과한다.
 */
const setQuestions = authed
  .input(SetScaleMeanQuestionsInput)
  .output(SetScaleMeanQuestionsResult)
  .handler(async ({ context, input }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.edit');
    return svc.setScaleMeanQuestions(input);
  });

export const scaleMean = {
  setQuestions,
};
