import { authed } from '@/server/orpc';

import { SetScaleMeanQuestionsInput, SetScaleMeanQuestionsResult } from '../domain/scale-mean';
import * as svc from '../services/scale-mean';

/**
 * 척도 평균 「문항 선택」 저장 — CONTEXT.md 「척도 평균」.
 * 내부 담당자 화면이라 authed(게스트 FORBIDDEN). 후보 밖 문항 거부는 throw 가 아니라
 * { ok:false, error } 로 통과한다.
 */
const setQuestions = authed
  .input(SetScaleMeanQuestionsInput)
  .output(SetScaleMeanQuestionsResult)
  .handler(({ input }) => svc.setScaleMeanQuestions(input));

export const scaleMean = {
  setQuestions,
};
