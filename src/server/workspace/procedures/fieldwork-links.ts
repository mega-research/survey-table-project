/**
 * 외주 실사 링크 procedure (ADR-0026, .pen FLOW 10-2 실사 블록의 「외주」 세그먼트).
 *
 * **관문이 다섯 표면 전부 `survey.manageAccess` 다** — 소유자·소유 팀 팀장·슈퍼어드민.
 * 참여자·게스트 블록이 「추가는 `survey.invite`, 해제는 `survey.manageAccess`」로 갈린 것과
 * **일부러 다르다.**
 *
 * 저쪽이 `survey.invite` 인 이유는 그것이 **계정 있는 사람**을 지목하는 일이라서다 — 되돌리기
 * 쉽고 누가 누구를 초대했는지 행으로 남는다. 반면 공유 비밀번호는 한 번 읽히면 회수 수단이
 * 비밀번호 변경뿐이고, **읽는 것 자체가 곧 접근 수단을 얻는 것**이다. 열람 권한만 있는 팀원에게
 * 그 값을 열면 외부로 나가는 열쇠가 그 손에서 만들어진다.
 *
 * `get` 과 `revealPassword` 를 가른 것도 같은 축이다. 목록 응답에 평문을 실으면 캐시·로그·RSC
 * payload 로 번지고 「누가 언제 읽었는가」가 남지 않는다 — 따로 두면 rpc-logging 이 호출 한 줄을
 * 기록한다(별도 감사 테이블은 만들지 않는다. 게스트 부여도 감사 테이블이 없다).
 */
import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import {
  IssuedFieldworkLinkOutput,
  RevealedFieldworkLinkPasswordOutput,
  SurveyFieldworkLinkOutput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

import {
  FieldworkLinkAlreadyIssuedError,
  FieldworkLinkNotFoundError,
  IssueFieldworkLinkInput,
  ResetFieldworkLinkPasswordInput,
  SurveyFieldworkLinkInput,
} from '../domain/fieldwork-link';
import * as svc from '../services/fieldwork-links';

/**
 * 도메인 에러 → RPC 코드.
 *
 * 중복은 CONFLICT(입력은 옳고 지금 상태와 부딪힌다), 미존재는 NOT_FOUND — 게스트·참여자 쪽과
 * 같은 분류다. 문자열 Error 로 던지면 rpc-error-policy 가 500 으로 마스킹해, 정확히 거부된
 * 요청이 화면에는 「내부 오류」로 보인다.
 */
function rethrowLinkError(err: unknown): never {
  if (err instanceof FieldworkLinkAlreadyIssuedError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  if (err instanceof FieldworkLinkNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  throw err;
}

/** 이 설문의 링크 상태 — 없으면 null. 평문 비밀번호는 실리지 않는다. */
const get = authed
  .input(SurveyFieldworkLinkInput)
  .output(SurveyFieldworkLinkOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    const link = await svc.getFieldworkLink(input.surveyId);
    // 이 표면 자체가 manageAccess 를 요구하므로 여기까지 온 주체는 언제나 관리자다.
    return { link, canManage: true };
  });

/** 발급 — 자동 생성 비밀번호를 **이때 한 번** 평문으로 함께 돌려준다. */
const issue = authed
  .input(IssueFieldworkLinkInput)
  .output(IssuedFieldworkLinkOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc
      .issueFieldworkLink({
        surveyId: input.surveyId,
        password: input.password,
        actorId: context.user.id,
      })
      .catch(rethrowLinkError);
  });

/**
 * 비밀번호 재설정 — 주소는 그대로 두고 이미 들어와 있던 외주 세션을 끊는다.
 *
 * 링크가 유출됐을 때·업체를 갈아치울 때의 유일한 대응 경로다. 토큰 재발급 표면을 만들지 말 것 —
 * 주소만 새어도 비밀번호 화면까지만 보이므로 주소를 갈아끼워 막아지는 것이 없고, 주소가 고정이라
 * 연구원이 공유 문서에 박아 둔 링크가 계속 유효하다.
 */
const resetPassword = authed
  .input(ResetFieldworkLinkPasswordInput)
  .output(IssuedFieldworkLinkOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    return svc
      .resetFieldworkLinkPassword({
        surveyId: input.surveyId,
        password: input.password,
        actorId: context.user.id,
      })
      .catch(rethrowLinkError);
  });

/** 평문 조회 — 업체가 잊었을 때 연구원이 바로 답해 준다. 호출이 구조화 로그에 남는다. */
const revealPassword = authed
  .input(SurveyFieldworkLinkInput)
  .output(RevealedFieldworkLinkPasswordOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    const password = await svc.revealFieldworkLinkPassword(input.surveyId).catch(rethrowLinkError);
    return { password };
  });

/** 종료 — 행 삭제가 아니라 상태 전환이다. 종료 뒤 재발급이 된다. */
const close = authed
  .input(SurveyFieldworkLinkInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityRpc(context.user, input.surveyId, 'survey.manageAccess');
    await svc
      .closeFieldworkLink({ surveyId: input.surveyId, actorId: context.user.id })
      .catch(rethrowLinkError);
    return { success: true } as const;
  });

export const fieldworkLinks = { get, issue, resetPassword, revealPassword, close };
