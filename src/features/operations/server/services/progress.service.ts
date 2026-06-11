import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveys } from '@/db/schema/surveys';

import type {
  UpdateProgressColumnsInput,
  UpdateProgressColumnsResult,
} from '../../domain/progress';

/**
 * 진척률 표 컬럼 픽커 갱신.
 * - scheme.columns 빈 배열 → NULL 로 set (4개 고정 컬럼만).
 * - 검증: key 중복 + 라벨 빈 문자열 거부.
 *   (order 는 UI 의 ↑↓ 버튼이 idx 로 재할당하므로 충돌 검증 불필요.)
 *
 * 인증은 authed 미들웨어가 담당. 원본 action 은 requireAuth 만 사용했으므로
 * 소유권 SELECT 를 추가하지 않는다(없던 검증을 더하면 동작 변경).
 * 검증 실패는 throw 가 아니라 { ok:false, error } 로 반환 — 소비처 분기 계약 보존.
 * 캐시 갱신(revalidatePath 2경로)은 소비처 router.refresh 로 대체.
 */
export async function updateProgressColumns(
  input: UpdateProgressColumnsInput,
): Promise<UpdateProgressColumnsResult> {
  const { surveyId, scheme } = input;
  // columns 누락/형식 오류 방어 (domain scheme 은 z.custom 이라 런타임 미검증).
  // 비-UI/API 호출이 columns 를 빠뜨려도 throw 가 아니라 { ok:false, error } 계약 유지.
  if (!Array.isArray(scheme?.columns)) {
    return { ok: false, error: '컬럼 정보가 올바르지 않습니다.' };
  }
  // key 중복 검증
  const keys = scheme.columns.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: '컬럼 키가 중복되었습니다.' };
  }
  // 빈 라벨 거부
  if (scheme.columns.some((c) => c.label.trim().length === 0)) {
    return { ok: false, error: '라벨이 비어있는 컬럼이 있습니다.' };
  }

  const persisted = scheme.columns.length === 0 ? null : scheme;
  await db.update(surveys).set({ progressColumns: persisted }).where(eq(surveys.id, surveyId));

  return { ok: true };
}
