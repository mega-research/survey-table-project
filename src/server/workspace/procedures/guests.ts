/**
 * 설문 게스트 부여 procedure (역할 모델 v2 티켓 21, .pen FLOW 4-2 클라이언트 블록).
 *
 * **관문은 참여자 블록과 같은 두 축이다**(스펙 §7·§11-5).
 *
 * - 조회·검색·추가는 `survey.invite` : 그 설문에 접근 가능한 내부인이면 누구나 클라이언트를
 *   들일 수 있다. 새 부여는 언제나 기본 탭(응답 현황만)으로 서므로, 들이는 행위 자체가
 *   무엇을 더 열어 주지는 않는다.
 * - **해제와 탭 저장**은 `survey.manageAccess` : 소유자·소유 팀 팀장·슈퍼어드민만.
 *   스펙 §11-5 의 「**초대** 제거·범위 변경」이 이 둘이다 — 게스트의 탭 화이트리스트가
 *   곧 그 초대의 범위이고, 넓히면 조사 대상(마스킹)·쿼터가 외부인에게 열린다. .pen 이
 *   체크박스를 추가 버튼과 같은 블록에 그리는 것은 배치의 문제이지 권한의 문제가 아니다.
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
 * 게스트 목록 + 내가 이 부여들을 관리할 수 있는가.
 *
 * 판정은 참여자 블록과 **같은 술어**(`survey.manageAccess`)다 — 제외 권한이 초대 종류마다
 * 갈리면 한 모달 안에서 규칙이 두 벌이 된다. 게스트 쪽만 그 값이 탭 칩까지 잠근다.
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
    return { guests, canManage: canRemoveSurveyParticipant(capabilities) };
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
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
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
