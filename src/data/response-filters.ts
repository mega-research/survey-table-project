import 'server-only';

import { eq, isNotNull, isNull, type SQL } from 'drizzle-orm';

import { surveyResponses } from '@/db/schema';

/**
 * soft-delete 되지 않은(활성) 응답 조건.
 * 통계·리스트·export 전 경로에서 재사용한다.
 */
export const notDeletedResponse: SQL = isNull(surveyResponses.deletedAt);

/**
 * 삭제된(휴지통) 응답 조건.
 * profiles deleted view 전용.
 */
export const deletedResponse: SQL = isNotNull(surveyResponses.deletedAt);

/**
 * 완료된 응답만 (분석 모수).
 * export(.sav/raw/raw-split)는 in_progress·drop·screened_out·quotaful_out·bad 를
 * 행 단위로 제외한다 — 이탈/진행중은 missing 값이 아니라 분석 대상 아님.
 */
export const completedResponse: SQL = eq(surveyResponses.status, 'completed');

/**
 * 테스트 모드 응답 제외 조건.
 * 통계·쿼터·중복대조·export 모수에서 사용. profiles 목록은 예외(표시 + 배지).
 */
export const notTestResponse: SQL = eq(surveyResponses.isTest, false);
