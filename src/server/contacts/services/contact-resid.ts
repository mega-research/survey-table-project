import { sql } from 'drizzle-orm';
import 'server-only';

import type { DbTransaction } from '@/db';

/**
 * 컨택 resid 발번 — 설문·파티션별 순번을 DB 함수 next_contact_resid 에서 하나 받는다.
 *
 * 업로드·수동 추가·테스트 대상자 생성 세 INSERT 경로가 같은 한 줄을 각자 들고 있었고
 * 결과 캐스트만 세 가지였다. 발번은 반드시 대상자 INSERT 와 같은 트랜잭션 안에서
 * 호출해야 한다 — 밖에서 받으면 롤백된 시도가 번호를 태워 먹는다.
 */
export async function allocateContactResid(
  tx: DbTransaction,
  surveyId: string,
  isTest: boolean,
): Promise<number> {
  const rows = await tx.execute<{ resid: number }>(
    sql`SELECT next_contact_resid(${surveyId}::uuid, ${isTest}) AS resid`,
  );
  const resid = rows[0]?.resid;
  if (resid == null) throw new Error('next_contact_resid 호출 실패');
  return Number(resid);
}
