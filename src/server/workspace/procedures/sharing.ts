/**
 * 공유 설정 procedure (역할 모델 v2 티켓 16, .pen FLOW 4-2).
 *
 * 지금은 공개 범위 하나다. 참여자·클라이언트·실사 블록은 각각 티켓 18·21·24 가 이 자리에
 * 붙이고, 소유권 이전은 티켓 19 다 — 모달의 골격만 세우는 티켓이라 표면도 골격만 연다.
 *
 * 관문이 `survey.edit` 이 아니라 **`survey.manageAccess`** 인 것이 이 표면의 전부다.
 * 편집은 팀 공개 설문의 팀원도 갖지만(TEAM_MEMBER_CAPS) 공개 범위를 바꾸는 것은 소유자·
 * 소유 팀 팀장·슈퍼어드민뿐이다(스펙 §7). 같은 이유로 `UpdateSurveyDataSchema` 의
 * allowlist 에 `visibility` 가 없다 — 두 표면 중 하나만 조이면 다른 쪽이 우회로가 된다.
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  SetSurveyVisibilityInput,
  SharingSurveyNotFoundError,
  WorkspaceActionOutput,
} from '../domain/sharing';
import * as svc from '../services/sharing';
import { rethrowWorkspaceError } from './teams';

/**
 * 공유 도메인 에러 → RPC 코드. 형제 도메인(teams·members·survey-groups·reassignment)과 같은
 * 모양으로 둔다 — handler 안에 사슬을 인라인하면 티켓 18·19·21·24 가 에러를 더할 때마다
 * handler 가 두꺼워지고, 같은 매핑이 표면마다 사본으로 늘어난다.
 *
 * 관문을 지난 뒤 사라진 설문은 관문의 존재 은닉과 같은 어휘(NOT_FOUND)로 돌려준다.
 */
function rethrowSharingError(err: unknown): never {
  if (err instanceof SharingSurveyNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  rethrowWorkspaceError(err);
}

const setVisibility = authed
  .input(SetSurveyVisibilityInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.setSurveyVisibility(input).catch(rethrowSharingError);
  });

export const sharing = {
  setVisibility,
};
