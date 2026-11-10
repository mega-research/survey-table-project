import { type SQL, eq, sql } from 'drizzle-orm';
import 'server-only';

import type { DbOrTx } from '@/db';
import { contactTargets, fieldworkLinkShares, surveyAccessLinks } from '@/db/schema';
import { logger } from '@/lib/logger';
import { retryOnTxConflict } from '@/lib/pg-error';

import { lockWriteScope } from './data-scope';

/**
 * 담당 범위 표(`fieldwork_link_shares`)에 쓰는 트랜잭션의 공용 조각 (ADR-0035, fieldwork-multi-company 티켓 12).
 *
 * 범위 표를 만지는 자리는 둘이다 — 나누기 서비스(`contacts/services/fieldwork-shares` 의 적용·없애기)와 링크
 * 종료(`workspace/services/access-links` 의 `closeAccessLink`). 도메인끼리는 서로를 import 할 수 없어(ESLint)
 * **잠금 순서·잠금 세기·해제·재시도**를 여기 한 벌로 두고 둘이 부른다. 한쪽만 고치면 두 트랜잭션이 같은 대상을
 * 다른 세기로 잡아 교착이 나거나(04·11 이 실제로 맞춘 자리) 종료 중에 응답 행이 줄을 선다.
 *
 * 잠금 순서는 **설문 행 FOR SHARE → 링크 FOR UPDATE → 대상 id 오름차순 FOR NO KEY UPDATE** 다.
 * - 설문 행 FOR SHARE — 명단 교체 업로드(설문 행 FOR UPDATE)와 첫 잠금에서 줄을 선다.
 * - 대상 `FOR NO KEY UPDATE` — 스스로와 부딪히는 가장 약한 행 잠금이라 두 링크의 동시 가져오기가 줄을 서고,
 *   `FOR UPDATE` 와 달리 FK 검사의 키 공유 잠금과 부딪히지 않아 그동안에도 그 대상의 응답 행·회차 행이
 *   만들어진다(`fieldwork-share-overlap.realdb`·`fieldwork-share-release.realdb` 가 둘 다 실측).
 */

export type ShareWriteScopeLock = 'locked' | 'survey_not_found' | 'link_not_found';

/**
 * 잠금 순서의 앞 둘 — 설문 행 FOR SHARE → 링크 FOR UPDATE. `link` 는 링크 행을 집는 조건이다(적용은
 * 「이 설문의 열린 외주 링크」, 종료는 「이 설문의 열린 링크」 — 종류 조건이 서비스마다 다르다). 거부 어휘는
 * 서비스마다 달라 결과만 돌려준다.
 *
 * 설문 행은 「실데이터로 고정」(`isExternal: true`)으로 잠근다 — 범위는 실데이터 대상에만 선다.
 */
export async function lockShareWriteScope(
  tx: DbOrTx,
  surveyId: string,
  link: SQL,
): Promise<ShareWriteScopeLock> {
  const locked = await lockWriteScope(tx, surveyId, true, { lock: 'share' });
  if (!locked) return 'survey_not_found';
  const rows = await tx
    .select({ id: surveyAccessLinks.id })
    .from(surveyAccessLinks)
    .where(link)
    .for('update');
  return rows.length === 0 ? 'link_not_found' : 'locked';
}

/**
 * 잠금 순서의 셋째 — 조건에 맞는 조사 대상을 id 오름차순으로 `FOR NO KEY UPDATE`. 두 트랜잭션이 같은 대상을
 * 다른 순서로 잡지 않게 언제나 id 순이다. `where` 는 `contact_targets` 를 읽는 날 SQL 이다.
 */
export async function lockShareTargets(tx: DbOrTx, where: SQL): Promise<void> {
  await tx.execute(sql`
    SELECT ${contactTargets.id} FROM ${contactTargets}
    WHERE ${where}
    ORDER BY ${contactTargets.id}
    FOR NO KEY UPDATE
  `);
}

/**
 * 링크 하나의 범위를 통째로 푼다 — 그 링크 범위 대상을 잠근 뒤(위 순서의 셋째) 범위 행을 지운다. 풀린 인원을
 * 돌려준다(로그 재료 — 대상 id 는 싣지 않는다). 「담당 범위 없애기」와 링크 종료가 이 함수 하나를 부른다.
 * 「나눈 적 있음」은 건드리지 않는다 — 없애기는 되돌리고 종료는 남기는 것이 호출자마다 다르다.
 */
export async function releaseLinkShares(tx: DbOrTx, linkId: string): Promise<number> {
  await tx.execute(sql`
    SELECT t.${sql.identifier(contactTargets.id.name)} FROM ${contactTargets} t
    JOIN ${fieldworkLinkShares} fls
      ON fls.${sql.identifier(fieldworkLinkShares.contactTargetId.name)} = t.${sql.identifier(contactTargets.id.name)}
    WHERE fls.${sql.identifier(fieldworkLinkShares.linkId.name)} = ${linkId}
    ORDER BY t.${sql.identifier(contactTargets.id.name)}
    FOR NO KEY UPDATE OF t
  `);
  const released = await tx
    .delete(fieldworkLinkShares)
    .where(eq(fieldworkLinkShares.linkId, linkId))
    .returning({ id: fieldworkLinkShares.contactTargetId });
  return released.length;
}

/**
 * 범위 쓰기 트랜잭션 — 교착·직렬화 실패면 처음부터 다시 돈다(`retryOnTxConflict`, 조건도 새로 계산). 다시 돈
 * 일은 경고 한 줄로 남긴다 — 대상 id·조건 값은 싣지 않는다. `rpc` 는 그 쓰기를 부른 표면 이름이다.
 */
export function retryShareWrite<T>(
  context: { rpc: string; surveyId: string; linkId: string },
  run: () => Promise<T>,
): Promise<T> {
  return retryOnTxConflict(run, {
    onRetry: (attempt, error) =>
      logger.warn(
        {
          rpc: context.rpc,
          surveyId: context.surveyId,
          targetLinkId: context.linkId,
          attempt,
          err: error instanceof Error ? error.message : String(error),
        },
        '[fieldwork-share] 담당 범위 쓰기 트랜잭션 충돌 — 다시 실행',
      ),
  });
}
