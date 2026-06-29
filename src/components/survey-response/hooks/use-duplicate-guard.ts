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
  }, [isAdminEdit, isPreview, loadedSurvey?.id, inviteToken, signals]);

  return { duplicateStatus, setDuplicateStatus };
}
