import { pub, withRateLimit } from '@/server/orpc';

import { LookupPriorAnswersInput, PriorAnswersOutput } from '../../domain/prior-answers';
import * as svc from '../services/contact-prior-answers.service';

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

export const priorAnswers = {
  lookup,
};
