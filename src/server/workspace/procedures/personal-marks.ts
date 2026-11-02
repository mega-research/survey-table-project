/**
 * 개인 표시 procedure — 즐겨찾기 (설문 즐겨찾기·태그 티켓 06). 내 태그(티켓 07)가 같은 묶음에 붙는다.
 *
 * 관문은 **`survey.view`** 다 — 편집 권한이 없어도 볼 수 있는 설문이면 별을 켤 수 있다(참여자로
 * 맡은 설문도 표시한다). 볼 수 없는 설문은 존재를 알리지 않고 NOT_FOUND 다(관문의 계약).
 * 표시는 요청자 본인의 것이라 서비스는 세션의 사용자 id 로만 쓴다 — 입력에 사용자 칸이 없다.
 */
import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import { SetFavoriteInput, SetFavoriteOutput } from '../domain/personal-marks';
import * as svc from '../services/personal-marks';

const setFavorite = authed
  .input(SetFavoriteInput)
  .output(SetFavoriteOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.setFavorite(context.user.id, input);
  });

export const personalMarks = {
  setFavorite,
};
