import { NOT_RESPONDED_STATUS } from '@/lib/operations/profiles';

import type { RawExportResponseRow } from './raw-workbook';

// ============================================================
// Raw 내보내기 — 조사 대상 기준 모수의 순수 조각
// (미응답 행 생성 + 정렬. DB 조회는 raw-export-rows.server.ts)
// ============================================================

export interface NonRespondentTarget {
  id: string;
  resid: number;
  groupValue: string | null;
  inviteCode: string | null;
}

/** 응답이 없는 조사 대상 → 미응답 행. 문항 열은 비고 응답 메타는 전부 null. */
export function buildNonRespondentRow(target: NonRespondentTarget): RawExportResponseRow {
  return {
    id: target.id,
    questionResponses: {},
    groupValue: target.groupValue,
    resid: target.resid,
    inviteCode: target.inviteCode,
    ipHash: null,
    currentStepId: null,
    platform: null,
    browser: null,
    status: NOT_RESPONDED_STATUS,
    startedAt: null,
    completedAt: null,
    totalSeconds: null,
  };
}

/**
 * 조사 대상 기준 모수의 정렬 — 시스템ID 오름차순, 같은 시스템ID(복수 응답 허용 설문)는
 * 시작일시 오름차순, 시스템ID 없는 익명 응답은 뒤에 시작일시 오름차순. 입력 배열은 건드리지 않는다.
 * 토글이 꺼진 경로는 이 함수를 부르지 않는다 — findMany 의 startedAt 순서가 그대로 파일 순서다.
 */
export function sortRowsForContactPopulation(
  rows: readonly RawExportResponseRow[],
): RawExportResponseRow[] {
  return [...rows].sort((a, b) => {
    if (a.resid != null && b.resid != null) {
      if (a.resid !== b.resid) return a.resid - b.resid;
    } else if (a.resid != null) {
      return -1;
    } else if (b.resid != null) {
      return 1;
    }
    return (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0);
  });
}
