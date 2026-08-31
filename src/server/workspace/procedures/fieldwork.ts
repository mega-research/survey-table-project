/**
 * 설문 실사 초대 procedure (역할 모델 v2 티켓 25, .pen FLOW 4-2 실사 블록).
 *
 * **관문은 참여자·게스트 블록과 같은 두 축이다**(스펙 §7·§11-5).
 *
 * - 조회·검색·추가는 `survey.invite` : 그 설문에 접근 가능한 내부인이면 누구나 실사를
 *   붙일 수 있다.
 * - **해제**는 `survey.manageAccess` : 소유자·소유 팀 팀장·슈퍼어드민만.
 *
 * 게스트 블록에는 탭 저장이 관리 축에 함께 있었지만 여기는 해제뿐이다 — 실사에는 열리는
 * 화면을 설문마다 고르는 축이 없다(초대되면 조사 대상·응답 현황이 고정으로 열린다).
 *
 * 검색이 관문을 지는 이유도 같다 — 후보 목록은 **협력사 인력 명부**라 관문 없이 열면 설문
 * id 하나로 전 업체의 실사원을 훑을 수 있다. 업체 명부 자체(티켓 24)가 슈퍼어드민 전용인
 * 것과 같은 판단이고, 여기서는 그 명부를 「이 설문에 붙일 수 있는 사람」으로만 노출한다.
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { canRemoveSurveyParticipant } from '@/shared/contracts/workspace';

import {
  AddSurveyFieldworkInput,
  FieldworkAlreadyInvitedError,
  FieldworkInviteNotFoundError,
  FieldworkNotInvitableError,
  ListSurveyFieldworkInput,
  ListSurveyFieldworkOutput,
  ParticipantSurveyNotFoundError,
  RemoveSurveyFieldworkInput,
  SearchFieldworkCandidatesInput,
  SearchFieldworkCandidatesOutput,
  WorkspaceActionOutput,
} from '../domain/fieldwork';
import * as svc from '../services/fieldwork';

/**
 * 도메인 에러 → RPC 코드 — 참여자·게스트 쪽과 같은 분류다.
 *
 * 자격 미달은 BAD_REQUEST(입력이 가리키는 대상이 애초에 초대 가능한 종류가 아니다),
 * 중복은 CONFLICT(입력은 옳고 지금 상태와 부딪힌다), 미존재는 NOT_FOUND.
 */
function rethrowFieldworkError(err: unknown): never {
  if (err instanceof FieldworkNotInvitableError) {
    throw new ORPCError('BAD_REQUEST', { message: err.message });
  }
  if (err instanceof FieldworkAlreadyInvitedError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  if (
    err instanceof FieldworkInviteNotFoundError ||
    err instanceof ParticipantSurveyNotFoundError
  ) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  throw err;
}

const list = authed
  .input(ListSurveyFieldworkInput)
  .output(ListSurveyFieldworkOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    const [members, capabilities] = await Promise.all([
      svc.listSurveyFieldwork(input.surveyId),
      loadSurveyCapabilities(context.user, input.surveyId),
    ]);
    return { members, canManage: canRemoveSurveyParticipant(capabilities) };
  });

const searchCandidates = authed
  .input(SearchFieldworkCandidatesInput)
  .output(SearchFieldworkCandidatesOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.searchFieldworkCandidates(input);
  });

const add = authed
  .input(AddSurveyFieldworkInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.addSurveyFieldwork(context.user.id, input).catch(rethrowFieldworkError);
  });

const remove = authed
  .input(RemoveSurveyFieldworkInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.removeSurveyFieldwork(input).catch(rethrowFieldworkError);
  });

export const fieldwork = { list, searchCandidates, add, remove };
