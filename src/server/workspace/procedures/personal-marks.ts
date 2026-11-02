/**
 * 개인 표시 procedure — 즐겨찾기 (티켓 06) · 내 태그 (티켓 07·08).
 *
 * 관문은 **`survey.view`** 다 — 편집 권한이 없어도 볼 수 있는 설문이면 별을 켜고 태그를 붙인다
 * (참여자로 맡은 설문도 표시한다). 볼 수 없는 설문은 존재를 알리지 않고 NOT_FOUND 다(관문의 계약).
 * 표시는 요청자 본인의 것이라 서비스는 세션의 사용자 id 로만 쓴다 — 입력에 사용자 칸이 없다.
 * 태그 소유는 서비스가 요청자 id 로 보고, 남의 태그 id 는 없는 태그와 같은 NOT_FOUND 다.
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import {
  CreatePersonalTagInput,
  CreatePersonalTagOutput,
  DeletePersonalTagInput,
  DeletePersonalTagOutput,
  MinePersonalTagsOutput,
  PersonalMarkTargetGoneError,
  PersonalTagLimitError,
  PersonalTagNameTakenError,
  PersonalTagNotFoundError,
  SetFavoriteInput,
  SetFavoriteOutput,
  SetTagLinkInput,
  SetTagLinkOutput,
  UpdatePersonalTagInput,
  UpdatePersonalTagOutput,
} from '../domain/personal-marks';
import * as svc from '../services/personal-marks';

/**
 * 개인 표시 도메인 에러 → RPC 코드. 메시지에 태그 이름을 싣지 않는다(로그에 남는다).
 * 한도와 이름 충돌은 지금 상태와 부딪힌 것이라 CONFLICT 다.
 */
function rethrowPersonalMarksError(err: unknown): never {
  if (err instanceof PersonalTagNotFoundError || err instanceof PersonalMarkTargetGoneError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (err instanceof PersonalTagLimitError || err instanceof PersonalTagNameTakenError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw err;
}

const setFavorite = authed
  .input(SetFavoriteInput)
  .output(SetFavoriteOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.setFavorite(context.user.id, input).catch(rethrowPersonalMarksError);
  });

/** 내 태그 전부 — 내 행만. 작업 범위와 무관하다(팀을 바꿔도 같은 목록). */
const mine = authed
  .output(MinePersonalTagsOutput)
  .handler(({ context }) => svc.listMyTags(context.user.id));

const setTagLink = authed
  .input(SetTagLinkInput)
  .output(SetTagLinkOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.view');
    return svc.setTagLink(context.user.id, input).catch(rethrowPersonalMarksError);
  });

/**
 * 만들기(+ 붙이기). 붙일 설문의 관문은 트랜잭션보다 먼저 선다 — 거부되면 태그도 생기지 않는다.
 * 관문을 지난 뒤 설문이 사라지면 붙이기가 트랜잭션 안에서 깨져 함께 되돌려진다.
 */
const createTag = authed
  .input(CreatePersonalTagInput)
  .output(CreatePersonalTagOutput)
  .handler(async ({ input, context }) => {
    if (input.attachToSurveyId) {
      await assertSurveyCapabilityRpc(context.user, input.attachToSurveyId, 'survey.view');
    }
    return svc.createTag(context.user.id, input).catch(rethrowPersonalMarksError);
  });

/**
 * 태그 고치기·지우기 (티켓 08) — 설문을 지목하지 않아 설문 관문이 없다. 태그 소유는 서비스가
 * 요청자 id 를 WHERE 에 걸어 보고, 남의 태그 id 는 없는 태그와 같은 NOT_FOUND 다.
 */
const updateTag = authed
  .input(UpdatePersonalTagInput)
  .output(UpdatePersonalTagOutput)
  .handler(({ input, context }) =>
    svc.updateTag(context.user.id, input).catch(rethrowPersonalMarksError),
  );

const deleteTag = authed
  .input(DeletePersonalTagInput)
  .output(DeletePersonalTagOutput)
  .handler(({ input, context }) =>
    svc.deleteTag(context.user.id, input).catch(rethrowPersonalMarksError),
  );

export const personalMarks = {
  setFavorite,
  mine,
  setTagLink,
  createTag,
  updateTag,
  deleteTag,
};
