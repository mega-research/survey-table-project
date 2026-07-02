import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { client } from '@/shared/lib/rpc';
import type { BlockReason, ClientSignals } from '@/lib/duplicate-detection/types';
import type { Survey } from '@/types/survey';

/**
 * 응답 흐름의 중복 차단 상태. 컴포넌트가 소유(렌더 분기)하지만
 * useResponseLifecycle 의 handleResponse/handleSubmit 도 blocked 로 set 하므로
 * 타입을 이 훅에서 export 해 공유한다 (이 훅이 진입 시 중복검사의 주 소유자).
 */
export type DuplicateStatus =
  | { kind: 'checking' }
  | { kind: 'blocked'; reason: BlockReason }
  | { kind: 'ok' };

interface UseDuplicateGuardArgs {
  isAdminEdit: boolean;
  isPreview?: boolean;
  loadedSurvey: Survey | null;
  inviteToken: string | null;
  signals: ClientSignals | null;
  /**
   * 진입 시 중복검사를 건너뛴다. 유효 테스트 세션(control.testSession==='valid')에서 true.
   * true 면 네트워크 호출 없이 즉시 ok 로 통과시킨다 — 테스트 링크는 같은 브라우저로 반복 응답이 정상.
   */
  skip?: boolean;
}

interface UseDuplicateGuardResult {
  duplicateStatus: DuplicateStatus;
  setDuplicateStatus: Dispatch<SetStateAction<DuplicateStatus>>;
}

/**
 * 진입 시 중복 응답 감지 가드 추출 훅.
 *
 * survey-response-flow.tsx 의 duplicateStatus state 초기화 + checkOnEntry useEffect 를
 * 라인 단위 그대로 이관했다. 잘못 차단하면 정상 응답자를 막고, 잘못 통과시키면 중복이 새므로
 * 동작 보존이 절대적이다 — 가드/RPC 페이로드/blocked·ok set/cancelled cleanup/deps 를 1:1 유지한다.
 *
 * 동작 보존 핵심:
 * - 초기값은 admin-edit 분기(8/8)로 isAdminEdit 이면 ok, 아니면 checking.
 * - effect 는 isAdminEdit 이면 즉시 return(검사 skip, 초기값이 이미 ok),
 *   loadedSurvey?.id 또는 signals 가 없으면 return → signals 채워지면 자동 재실행.
 * - checkOnEntry 페이로드(surveyId, inviteToken 조건부 spread, clientSignals: signals)와
 *   blocked/ok set, cancelled cleanup 플래그를 그대로 둔다. deps 배열도 원본과 1:1 동일.
 * - setDuplicateStatus 는 useResponseLifecycle 도 받으므로(INSERT blocked 결과 set)
 *   컴포넌트가 이 훅의 반환 setter 를 lifecycle 에도 그대로 넘긴다.
 */
export function useDuplicateGuard({
  isAdminEdit,
  isPreview = false,
  loadedSurvey,
  inviteToken,
  signals,
  skip = false,
}: UseDuplicateGuardArgs): UseDuplicateGuardResult {
  // DuplicateStatus 타입은 useResponseLifecycle 과 공유한다(handleResponse/handleSubmit 가 blocked 로 set).
  // admin-edit 분기 (8/8) — 어드민 수정은 중복검사 대상이 아니므로 초기값부터 ok.
  const [duplicateStatus, setDuplicateStatus] = useState<DuplicateStatus>(() =>
    isAdminEdit || isPreview ? { kind: 'ok' } : { kind: 'checking' },
  );

  // 진입 시 중복 검사 — 설문 로드 + 신호 수집 완료 후 1회 실행
  // signals 가 null 인 동안 effect skip → state 채워지면 자동 재실행
  // admin-edit 분기 (2/8) — 어드민 수정 모드에서는 검사 자체를 건너뜀 (초기값이 이미 ok)
  useEffect(() => {
    if (isAdminEdit || isPreview) return;
    // 유효 테스트 세션 — 진입 시 중복검사 자체를 건너뜀 (반환값은 아래에서 ok 로 덮는다).
    if (skip) return;
    if (!loadedSurvey?.id || !signals) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await client.surveyResponse.duplicate.checkOnEntry({
          surveyId: loadedSurvey.id,
          ...(inviteToken != null ? { inviteToken } : {}),
          clientSignals: signals,
        });
        if (cancelled) return;
        if (r.blocked) {
          setDuplicateStatus({ kind: 'blocked', reason: r.reason });
        } else {
          setDuplicateStatus({ kind: 'ok' });
        }
      } catch (err) {
        // 검사 실패 시 통과 가정 (best-effort) — 첫 답변에서 다시 검사됨
        console.error('checkDuplicateOnEntry 실패', err);
        if (!cancelled) setDuplicateStatus({ kind: 'ok' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdminEdit, isPreview, skip, loadedSurvey?.id, inviteToken, signals]);

  // 유효 테스트 세션은 진입 시 중복검사 없이 통과. 내부 state 를 effect 에서 동기 set 하면
  // cascading render 가 되므로(react-hooks/set-state-in-effect), 반환값만 ok 로 파생해 덮는다.
  // 테스트 세션은 중단/중복 예외 대상이라 그 사이 blocked 로 set 될 경로가 없어 마스킹은 안전하다.
  const effectiveStatus: DuplicateStatus = skip ? { kind: 'ok' } : duplicateStatus;

  return { duplicateStatus: effectiveStatus, setDuplicateStatus };
}

/**
 * mutation 실패가 "설문 중단(survey_paused)" 때문인지 판정하고, 맞으면 blocked 로 전환한다.
 *
 * 여러 mutation catch 지점(첫 답변 create / blank+complete / resume)의 단일 공통 진입점이다
 * (산탄총 수정 대신 헬퍼 1개). 반환 true 면 호출부는 이후 일반 에러 처리(토스트/로그)를 건너뛴다.
 *
 * 판정 2단계 — oRPC 특성 때문에 두 경로가 모두 필요하다:
 *  1) fast-path: 서버가 사유를 보존해 던진 경우(Error.message 에 'survey_paused' 포함) 즉시 판정.
 *     서비스 직접 호출/단위테스트 경로에서 유효하다.
 *  2) 재조회 fallback: RPCHandler 는 비-ORPCError 를 "Internal server error" 로 마스킹해
 *     클라이언트로 오는 message 에서 사유가 소실된다(toJSON 이 cause 를 직렬화하지 않음).
 *     따라서 실제 네트워크 경로에서는 현재 control 을 재조회해 isPaused 를 직접 확인한다.
 *     이 방식은 세션 도중 중단된 경우에도 stale 없이 최신 문구를 반영한다.
 *
 * 유효 테스트 세션(isTestSession)은 중단 예외 대상이므로 재조회 자체를 건너뛴다.
 */
export async function handlePausedMutationError(args: {
  err: unknown;
  surveyId: string | undefined;
  testToken: string | null;
  isTestSession: boolean;
  setDuplicateStatus: Dispatch<SetStateAction<DuplicateStatus>>;
}): Promise<boolean> {
  const { err, surveyId, testToken, isTestSession, setDuplicateStatus } = args;

  if (err instanceof Error && err.message.includes('survey_paused')) {
    setDuplicateStatus({ kind: 'blocked', reason: 'survey_paused' });
    return true;
  }

  if (isTestSession || !surveyId) return false;

  try {
    const res = await client.surveyBuilder.publicRead.forResponse({
      surveyId,
      ...(testToken != null ? { testToken } : {}),
    });
    if (res?.control.isPaused) {
      setDuplicateStatus({ kind: 'blocked', reason: 'survey_paused' });
      return true;
    }
  } catch (refetchErr) {
    // 재조회 자체 실패는 best-effort — 일반 에러 처리로 폴백한다.
    console.error('중단 상태 재확인 실패:', refetchErr);
  }
  return false;
}
