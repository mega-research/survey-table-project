import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';

import type {
  UpdateProfileColumnsInput,
  UpdateProfileColumnsResult,
} from '../domain/profile-columns';

/**
 * 응답 내역 컬럼 픽커 갱신 — progress.service 의 updateProgressColumns 와 동일 계약.
 * - scheme.columns 빈 배열 → NULL 로 set (기본 스킴 복귀).
 * - 검증: key 중복 + 라벨 빈 문자열 거부.
 *   (order 는 UI 의 ↑↓ 버튼이 idx 로 재할당하므로 충돌 검증 불필요.)
 *
 * 인증은 authed 미들웨어가 담당. 검증 실패는 throw 가 아니라 { ok:false, error } 반환.
 * 캐시 갱신은 소비처 router.refresh 로 대체.
 */
export async function updateProfileColumns(
  input: UpdateProfileColumnsInput,
): Promise<UpdateProfileColumnsResult> {
  const { surveyId, scheme } = input;
  // columns 누락/형식 오류 방어 (domain scheme 은 z.custom 이라 런타임 미검증).
  if (!Array.isArray(scheme?.columns)) {
    return { ok: false, error: '컬럼 정보가 올바르지 않습니다.' };
  }
  const keys = scheme.columns.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: '컬럼 키가 중복되었습니다.' };
  }
  if (scheme.columns.some((c) => c.label.trim().length === 0)) {
    return { ok: false, error: '라벨이 비어있는 컬럼이 있습니다.' };
  }

  const persisted = scheme.columns.length === 0 ? null : scheme;
  await db.update(surveys).set({ profileColumns: persisted }).where(eq(surveys.id, surveyId));

  return { ok: true };
}
