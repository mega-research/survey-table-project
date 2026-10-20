import {
  FILTER_NONE_VALUE,
  FILTER_SOURCE,
  HEADER_FILTER_VALUE_SEPARATOR,
} from '@/lib/operations/filter-shared';

import { internalOperationsPaths } from '../../operations-paths';

// 컨택원 관리는 내부 콘솔 전용 화면이라 외주 실사 링크 콘솔에 주입받을 상대가 없다 — 스스로 조립한다.
export function assignmentsHref(surveyId: string): string {
  return internalOperationsPaths(surveyId).contactsAssignments;
}

export function assignmentEditHref(surveyId: string, assignmentId: string): string {
  return internalOperationsPaths(surveyId).contactsAssignment(assignmentId);
}

/** 조사 대상 목록 — 「컨택원」 열 머리 필터로 고른 컨택원들(null = 배정 없음). */
export function contactsByAssignmentHref(
  surveyId: string,
  assignmentIds: Array<string | null>,
): string {
  const values = assignmentIds.map((id) => id ?? FILTER_NONE_VALUE);
  const p = new URLSearchParams();
  p.append('hcol', FILTER_SOURCE.CONTACT_OWNER);
  p.append('hm', 'in');
  p.append('hv', values.join(HEADER_FILTER_VALUE_SEPARATOR));
  return `${internalOperationsPaths(surveyId).contacts}?${p.toString()}`;
}

/** 조사 대상 목록 — 배정 없는 대상만. */
export function unassignedContactsHref(surveyId: string): string {
  return contactsByAssignmentHref(surveyId, [null]);
}
