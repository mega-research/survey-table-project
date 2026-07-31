import 'server-only';

import { and, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import {
  mailCampaigns,
  mailTemplates,
  questions,
  savedCells,
  savedLookups,
  savedQuestions,
  surveys,
  surveyVersions,
} from '@/db/schema';
import { extractR2KeysFromJsonbValue } from '@/lib/r2-lifecycle/key-extract';

/**
 * 집행 직전 전역 참조 재확인의 스캔 표면 — 라이브 행 전체 + 발행 스냅샷 +
 * 보관함 + 캠페인 스냅샷. soft-delete 된 mail_templates 행만 제외한다
 * (soft delete 행은 파일 참조 자격을 잃는다 — CONTEXT.md).
 *
 * mail_recipients.sendPayloadSnapshot 은 캠페인 스냅샷과 키 집합이 동일하고
 * (수신자별 토큰 치환만 다름) 발송분 보호는 발송 장부 소관이라 스캔하지 않는다.
 */
const REFERENCE_SURFACE: Array<{ table: PgTable; extraWhere?: SQL }> = [
  { table: surveys },
  { table: questions },
  // 보존 정책으로 정리된 버전(snapshot IS NULL)은 참조를 주장하지 않는다.
  // 정리 시점에 그 키들을 이미 유예 큐에 등록했으므로 회계상 정합하다.
  { table: surveyVersions, extraWhere: isNotNull(surveyVersions.snapshot) },
  { table: savedQuestions },
  { table: savedCells },
  { table: savedLookups },
  { table: mailTemplates, extraWhere: isNull(mailTemplates.deletedAt) },
  { table: mailCampaigns },
];

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
