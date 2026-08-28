/**
 * 설문 게스트 부여 procedure (역할 모델 v2 티켓 21, .pen FLOW 4-2 클라이언트 블록).
 *
 * **관문은 참여자 블록과 같은 두 축이다**(스펙 §7·§11-5).
 *
 * - 조회·검색·추가·탭 저장은 `survey.invite` : 그 설문에 접근 가능한 내부인이면 누구나
 *   클라이언트를 들일 수 있다. 탭 화이트리스트가 이쪽에 서는 것은 그것이 **초대의 모양**이기
 *   때문이다 — 무엇을 열어 줄지 고르는 것과 들이는 것은 한 동작이고, .pen 도 체크박스를
 *   추가 버튼과 같은 블록에 그린다.
 * - 해제는 `survey.manageAccess` : 소유자·소유 팀 팀장·슈퍼어드민만. 들이는 것과 내보내는
 *   것은 무게가 다르다.
 *
 * 검색이 관문을 지는 이유도 참여자와 같다 — 후보 목록은 발급된 클라이언트 계정 명부라
 * 관문 없이 열면 설문 id 하나로 전 고객사 계정을 훑을 수 있다.
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { canRemoveSurveyParticipant } from '@/shared/contracts/workspace';

import {
  AddSurveyGuestInput,
  GuestAlreadyGrantedError,
  GuestGrantNotFoundError,
  GuestNotGrantableError,
  ListSurveyGuestsInput,
  ListSurveyGuestsOutput,
  ParticipantSurveyNotFoundError,
  RemoveSurveyGuestInput,
  SearchGuestCandidatesInput,
  SearchGuestCandidatesOutput,
  SetSurveyGuestTabsInput,
  WorkspaceActionOutput,
} from '../domain/guests';
import * as svc from '../services/guests';

/**
 * 도메인 에러 → RPC 코드 — 참여자 쪽과 같은 분류다.
 *
 * 자격 미달은 BAD_REQUEST(입력이 가리키는 대상이 애초에 부여 가능한 종류가 아니다),
 * 중복은 CONFLICT(입력은 옳고 지금 상태와 부딪힌다), 미존재는 NOT_FOUND.
 */
function rethrowGuestError(err: unknown): never {
  if (err instanceof GuestNotGrantableError) {
    throw new ORPCError('BAD_REQUEST', { message: err.message });
  }
  if (err instanceof GuestAlreadyGrantedError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  if (err instanceof GuestGrantNotFoundError || err instanceof ParticipantSurveyNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  throw err;
}

/**
 * 게스트 목록 + 내가 해제할 수 있는가.
 *
 * `canRemove` 의 판정은 참여자 블록과 **같은 술어**(`survey.manageAccess`)다 — 제외 권한이
 * 초대 종류마다 갈리면 한 모달 안에서 규칙이 두 벌이 된다.
 */
const list = authed
  .input(ListSurveyGuestsInput)
  .output(ListSurveyGuestsOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    const [guests, capabilities] = await Promise.all([
      svc.listSurveyGuests(input.surveyId),
      loadSurveyCapabilities(context.user, input.surveyId),
    ]);
    return { guests, canRemove: canRemoveSurveyParticipant(capabilities) };
  });

const searchCandidates = authed
  .input(SearchGuestCandidatesInput)
  .output(SearchGuestCandidatesOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.searchGuestCandidates(input);
  });

const add = authed
  .input(AddSurveyGuestInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.addSurveyGuest(context.user.id, input).catch(rethrowGuestError);
  });

const setTabs = authed
  .input(SetSurveyGuestTabsInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.invite');
    return svc.setSurveyGuestTabs(input).catch(rethrowGuestError);
  });

const remove = authed
  .input(RemoveSurveyGuestInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc.removeSurveyGuest(input).catch(rethrowGuestError);
  });

export const guests = {
  list,
  searchCandidates,
  add,
  setTabs,
  remove,
};
