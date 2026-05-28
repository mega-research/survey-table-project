import 'server-only';

import { isNotNull, isNull, type SQL } from 'drizzle-orm';

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
