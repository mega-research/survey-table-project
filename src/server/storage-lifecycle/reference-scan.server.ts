import 'server-only';

import { and, sql } from 'drizzle-orm';

import { db } from '@/db';
import { extractR2KeysFromJsonbValue } from './key-extract';
import { REFERENCE_SURFACE } from './reference-surface.server';

/**
 * 집행 직전 전역 참조 재확인의 스캔 표면은 reference-surface.server 의
 * REFERENCE_SURFACE 단일 정의를 그대로 쓴다 — 파생 인덱스 재구축과 표면·술어가
 * 갈리면 인덱스가 스캔보다 넓어져 삭제가 영구히 막힌다.
 */

function escapeLikePattern(key: string): string {
  return key.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * 주어진 키들 중 스캔 표면 어딘가에서 실제로 참조되는 키의 집합을 반환한다.
 * 행 전체를 text 캐스팅해 LIKE 로 선별(prefilter)한 뒤, 매칭 행을 키 추출
 * 모듈로 확정한다 — 수집과 재확인이 같은 추출 의미론을 공유한다.
 */
export async function findReferencedKeys(keys: readonly string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  if (keys.length === 0) return referenced;

  const target = new Set(keys);
  // CLAUDE.md drizzle 함정: ANY(${배열}) 바인딩 금지 — sql.join 으로 배열 리터럴 구성
  const patternList = sql.join(
    keys.map((k) => sql`${`%${escapeLikePattern(k)}%`}`),
    sql`, `,
  );

  for (const { table, extraWhere } of REFERENCE_SURFACE) {
    if (target.size === referenced.size) break; // 전부 발견되면 조기 종료
    const prefilter = sql`${table}::text like any (array[${patternList}])`;
    const rows = await db
      .select()
      .from(table)
      .where(extraWhere ? and(prefilter, extraWhere) : prefilter);
    for (const row of rows) {
      for (const key of extractR2KeysFromJsonbValue(row)) {
        if (target.has(key)) referenced.add(key);
      }
    }
  }
  return referenced;
}
