import 'server-only';

import { ORPCError } from '@orpc/server';

import { WorkScopeError } from './work-scope';

/**
 * 작업 범위 거부의 RPC 어댑터 — rpc-survey-access 의 형제 (역할 모델 v2 티켓 15).
 *
 * 판정은 코어(work-scope)가 하고 여기는 사유를 RPC 어휘로 옮기기만 한다. 코어가 RPC 어휘를
 * 알면 화면·REST 가 같은 판정을 쓸 수 없으므로 매핑은 늘 바깥에 둔다.
 *
 * 매핑이 없으면 rpc-error-policy 가 정체불명의 500 으로 마스킹한다 — 「일반 사용자의 system
 * 요청은 **거부한다**」(work-scope 의 계약)가 실제로는 크래시였다는 뜻이고, Sentry 에도
 * 예상 못 한 오류로 쌓인다. 입력이 명시적으로 지목한 범위를 못 주는 것이므로 FORBIDDEN 이다
 * (존재를 감출 것이 없어 NOT_FOUND 가 아니다).
 *
 * **쿠키에서 온 범위는 이 길로 오지 않는다.** 쿠키는 편의값이라 화면 쪽(admin 레이아웃·분석
 * 목록)이 기본 범위로 접는다 — 접는 쪽과 거부하는 쪽이 갈리는 것은 **값의 출처** 때문이지
 * 판정이 둘이어서가 아니다.
 */
export function toRpcWorkScopeError(error: unknown): unknown {
  if (error instanceof WorkScopeError) {
    return new ORPCError('FORBIDDEN', {
      message: '시스템 전체 보기 권한이 없습니다.',
    });
  }
  return error;
}
