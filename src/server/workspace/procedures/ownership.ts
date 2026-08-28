/**
 * 소유권 이전 procedure (역할 모델 v2 티켓 19, .pen FLOW 4-4).
 *
 * 요구는 `survey.transferOwnership` — 소유자·소유 팀 팀장·슈퍼어드민뿐이다(스펙 §8).
 * 참여자는 편집·운영·삭제까지 하면서도 이 축은 못 넘는다: 설문을 **누구 것으로 할지**는
 * 설문 자체의 처분권이고, 공개 범위 변경(`survey.manageAccess`)과 같은 무게다.
 *
 * 승계 미리보기(퇴사 처리)는 여기 없다 — 그쪽은 설문이 아니라 **사람**을 지목하는 표면이라
 * 슈퍼어드민 축이고, `auth` 도메인의 퇴사 흐름과 한 트랜잭션이어야 해서 workflows 가 잇는다.
 */
import { ORPCError } from '@orpc/server';

import { authed, superadmin } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import {
  ListTransferCandidatesOutput,
  SuccessionPreviewInput,
  SuccessionPreviewOutput,
  SurveyIdOnlyInput,
  TransferSurveyOwnershipInput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

import {
  AmbiguousOwnerTeamError,
  NotATransferCandidateError,
  OwnershipSurveyNotFoundError,
  SelfTransferError,
} from '../domain/succession';
import * as svc from '../services/ownership';

/**
 * 도메인 에러 → RPC 코드.
 *
 * 후보 아님·자기 자신·팀 모호는 전부 CONFLICT 다 — 입력은 문법적으로 옳고 지금 상태와
 * 부딪힐 뿐이라, 화면은 문구를 띄우고 후보 목록을 다시 읽으면 된다. 사라진 설문만
 * NOT_FOUND 로 관문의 어휘를 잇는다.
 */
function rethrowOwnershipError(err: unknown): never {
  if (err instanceof OwnershipSurveyNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (
    err instanceof NotATransferCandidateError ||
    err instanceof SelfTransferError ||
    err instanceof AmbiguousOwnerTeamError
  ) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw err;
}

/** 이전 후보 (.pen 4-4 드롭다운) — 같은 팀 active 멤버 + 이 설문 참여자. */
const candidates = authed
  .input(SurveyIdOnlyInput)
  .output(ListTransferCandidatesOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.transferOwnership');
    return svc.listTransferCandidates(input.surveyId);
  });

const transfer = authed
  .input(TransferSurveyOwnershipInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.transferOwnership');
    return svc.transferSurveyOwnership(context.user.id, input).catch(rethrowOwnershipError);
  });

/**
 * 퇴사 처리 화면의 승계 미리보기 (.pen 9-3) — **슈퍼어드민 전용**.
 *
 * 설문이 아니라 **사람**을 지목한다. 그 사람이 소유한 설문 전수를 훑어야 해서 설문 단위
 * capability 관문을 쓸 수 없고(어느 설문인지 모르는 채로 묻는다), 계정 수명주기를 다루는
 * 표면이라 사용자 관리와 같은 전역 권한 축에 둔다.
 *
 * **아무것도 바꾸지 않는다.** 제안만 하고 확정은 퇴사 처리가 한다 — 무확인 자동 이전 없음.
 */
const successionPreview = superadmin
  .input(SuccessionPreviewInput)
  .output(SuccessionPreviewOutput)
  .handler(({ input }) => svc.previewSuccession(input.userId));

export const ownership = {
  candidates,
  transfer,
  successionPreview,
};
