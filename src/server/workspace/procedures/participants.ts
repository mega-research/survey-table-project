/**
 * 설문 참여자 procedure (역할 모델 v2 티켓 18, .pen FLOW 4-2).
 *
 * **관문이 표면마다 다르다 — 그것이 이 파일의 전부다**(스펙 §7·§11-5).
 *
 * - 조회·검색·추가는 `survey.invite` : 그 설문에 접근 가능한 내부인이면 누구나 초대할 수
 *   있다(소유자·팀장·참여자·팀 공개면 팀원). 좁히면 「같이 일하자」가 관리 행위가 된다.
 * - 제외는 `survey.manageAccess` : 소유자·소유 팀 팀장·슈퍼어드민만. 공개 범위 변경과 같은
 *   축이다 — 들이는 것과 내보내는 것은 무게가 다르다.
 *
 * 검색이 `survey.invite` 를 요구하는 것이 중요하다. 후보 목록은 조직의 내부 계정 명부라,
 * 관문 없이 열면 설문 id 하나로 전사 사용자 검색이 된다.
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { canRemoveSurveyParticipant } from '@/shared/contracts/workspace';

import {
  AddSurveyParticipantInput,
  ListSurveyParticipantsInput,
  ListSurveyParticipantsOutput,
  OwnerCannotBeParticipantError,
  ParticipantAlreadyExistsError,
  ParticipantNotFoundError,
  ParticipantNotInvitableError,
  RemoveSurveyParticipantInput,
  SearchParticipantCandidatesInput,
  SearchParticipantCandidatesOutput,
  WorkspaceActionOutput,
} from '../domain/participants';
import * as svc from '../services/participants';

/**
 * 도메인 에러 → RPC 코드.
 *
 * 자격 미달(비내부·비활성)은 BAD_REQUEST 다 — 입력이 가리키는 대상이 애초에 초대 가능한
 * 종류가 아니다. 소유자·중복·미존재는 CONFLICT/NOT_FOUND: 입력은 옳고 지금 상태와 부딪힐
 * 뿐이라, 화면은 문구를 띄우고 목록을 다시 읽으면 된다.
 */
function rethrowParticipantError(err: unknown): never {
  if (err instanceof ParticipantNotInvitableError) {
    throw new ORPCError('BAD_REQUEST', { message: err.message });
  }
  if (err instanceof OwnerCannotBeParticipantError || err instanceof ParticipantAlreadyExistsError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  if (err instanceof ParticipantNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  throw err;
}

/**
 * 참여자 목록 + 내가 제외할 수 있는가.
 *
 * `canRemove` 를 서버가 함께 주는 이유는 화면이 역할을 다시 세지 않게 하기 위해서다.
 * capability 집합을 이미 관문이 읽었지만 그 값을 돌려주지 않으므로 한 번 더 읽는다 —
 * 관문에 「집합도 돌려줘」를 붙이면 전 표면의 시그니처가 그 편의 하나 때문에 바뀐다.
 */
const list = authed
  .input(ListSurveyParticipantsInput)
  .output(ListSurveyParticipantsOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    const [participants, capabilities] = await Promise.all([
      svc.listSurveyParticipants(input.surveyId),
      loadSurveyCapabilities(context.user, input.surveyId),
    ]);
    return { participants, canRemove: canRemoveSurveyParticipant(capabilities) };
  });

const searchCandidates = authed
  .input(SearchParticipantCandidatesInput)
  .output(SearchParticipantCandidatesOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.searchParticipantCandidates(input);
  });

const add = authed
  .input(AddSurveyParticipantInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.addSurveyParticipant(context.user.id, input).catch(rethrowParticipantError);
  });

const remove = authed
  .input(RemoveSurveyParticipantInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.removeSurveyParticipant(input).catch(rethrowParticipantError);
  });

export const participants = {
  list,
  searchCandidates,
  add,
  remove,
};
