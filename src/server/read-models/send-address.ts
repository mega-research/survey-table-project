import { type SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactPii, contactTargets, mailCampaigns, mailRecipients, surveys } from '@/db/schema';
import { type MailEmailOrder, resolveMailEmailOrder } from '@/lib/contacts/mail-email-order';
import { decryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import {
  type SendAddressCell,
  type SendAddressResolution,
  resolveSendAddress,
} from '@/lib/mail/send-address';
import { splitEmailAddresses } from '@/lib/mail/split-email-addresses';

/**
 * 발송 주소 — DB 쪽 얼굴. 규칙 자체는 `lib/mail/send-address.ts` 이고 여기는 그 재료를 읽는다.
 *
 * 발송 주소 후보는 **이메일로 암호화된 명단 열**(contact_pii.field_type='email')이고, 발송 주소 순서
 * (컬럼 설정 mailOrder — 지정되면 그 열만, 아니면 column_key 오름차순)대로 훑는다. 「이 대상의 이메일」을
 * 읽는 자리는 field_type 을 직접 거르지 말고 이 모듈을 쓴다.
 *
 * 얼굴은 둘이다.
 *  - 행 — 칸을 복호화해 규칙대로 판정한다(정확). 발송 · 사전 점검 · 대체 발송 · 단건 선검증 · 표시가 쓴다.
 *  - SQL — 목록·집계용 근사. 암호문은 SQL 이 나눌 수 없어 칸 단위로만 본다: 후보 열이 있는가,
 *    후보 칸이 전부 반송 칸인가. 칸 안 주소가 하나씩 따로 반송된 경우는 놓친다(마법사 예고 숫자).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 발송 주소 순서
// ─────────────────────────────────────────────────────────────────────────────

/** 설문의 메일 발송 주소 순서 — 파티션마다 스킴이 따로라 순서도 따로다. */
export interface MailEmailOrders {
  real: MailEmailOrder;
  test: MailEmailOrder;
}

export async function loadMailEmailOrders(
  surveyId: string,
  executor: DbOrTx = db,
): Promise<MailEmailOrders> {
  const [row] = await executor
    .select({ real: surveys.contactColumns, test: surveys.testContactColumns })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return {
    real: resolveMailEmailOrder(row?.real),
    test: resolveMailEmailOrder(row?.test),
  };
}

/** 한 파티션의 발송 주소 순서. */
export async function loadMailEmailOrder(
  surveyId: string,
  isTest: boolean,
  executor: DbOrTx = db,
): Promise<MailEmailOrder> {
  const orders = await loadMailEmailOrders(surveyId, executor);
  return isTest ? orders.test : orders.real;
}

// ─────────────────────────────────────────────────────────────────────────────
// 반송 주소
// ─────────────────────────────────────────────────────────────────────────────

/** 이 설문에서 반송된 것으로 확정된 칸 값·주소 — blind index 로 담는다. */
export interface BouncedAddresses {
  /** 칸 값 또는 칸 안 주소 하나가 반송 주소인가 */
  has(valueOrAddress: string): boolean;
  /** SQL 칸 단위 대조용 */
  readonly blindIndexes: readonly string[];
}

function bouncedAddressesOf(blinds: ReadonlySet<string>): BouncedAddresses {
  return {
    has: (value) => {
      if (blinds.size === 0) return false;
      const blind = blindIndex('email', value);
      return blind !== '' && blinds.has(blind);
    },
    blindIndexes: [...blinds],
  };
}

/** 반송 없음 — 단건 발송(관리자가 지목한 의도적 발송, 2026-08-13 결정)과 표시가 쓴다. */
export const NO_BOUNCED_ADDRESSES: BouncedAddresses = bouncedAddressesOf(new Set());

/**
 * 반송된 수신자의 발송 스냅샷 → 반송 주소.
 * - 칸 값 그대로 — 같은 칸(「a / b」 통째)을 다시 쓰는 대상과 대조한다.
 * - 주소 하나로 보낸 메일이 반송됐으면 그 주소도 — 다른 칸에 섞여 있어도 뺀다.
 *   여러 주소로 보낸 한 통의 반송은 어느 주소인지 알 수 없어(반송 세부를 읽지 않는다) 주소 단위로 확정하지
 *   않는다 — 확정하면 멀쩡한 주소까지 앞으로 계속 발송에서 빠진다.
 * 정규화 후 빈 값(주소 모양이 아님)은 대조할 수 없어 담지 않는다.
 */
export function bouncedAddressesFromSnapshots(
  snapshots: readonly (string | null)[],
): BouncedAddresses {
  const blinds = new Set<string>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    const blind = blindIndex('email', snapshot);
    if (blind) blinds.add(blind);
    const addresses = splitEmailAddresses(snapshot);
    if (addresses.length === 1) {
      const addressBlind = blindIndex('email', addresses[0]!);
      if (addressBlind) blinds.add(addressBlind);
    }
  }
  return bouncedAddressesOf(blinds);
}

/**
 * 이 설문의 반송 주소.
 *
 * 설문 스코프를 contact_targets 가 아니라 mail_campaigns.survey_id 로 잡는다 — 조사대상자 교체 업로드는
 * contact_targets 를 통째로 DELETE 하고 mail_recipients.contact_target_id 는 ON DELETE SET NULL 이라,
 * 대상 기준으로 좁히면 교체 직후 반송 이력이 사라진다. email_snapshot 은 대상 삭제와 무관하게 남는다.
 * 파티션은 가리지 않는다 — 반송은 주소의 속성이다.
 */
export async function loadBouncedAddresses(
  surveyId: string,
  executor: DbOrTx = db,
): Promise<BouncedAddresses> {
  const rows = await executor
    .selectDistinct({ emailSnapshot: mailRecipients.emailSnapshot })
    .from(mailRecipients)
    .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
    .where(and(eq(mailCampaigns.surveyId, surveyId), eq(mailRecipients.status, 'bounced')));
  return bouncedAddressesFromSnapshots(rows.map((r) => r.emailSnapshot));
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL 얼굴
// ─────────────────────────────────────────────────────────────────────────────

interface PiiColumns {
  fieldType: SQL;
  columnKey: SQL;
}

const PII_TABLE: PiiColumns = {
  fieldType: sql`${contactPii.fieldType}`,
  columnKey: sql`${contactPii.columnKey}`,
};

/** 원시 서브쿼리용 — `FROM contact_pii cp` */
const PII_ALIAS: PiiColumns = {
  fieldType: sql`cp.field_type`,
  columnKey: sql`cp.column_key`,
};

function candidateSql(cols: PiiColumns, order: MailEmailOrder): SQL {
  if (!order || order.length === 0) return sql`${cols.fieldType} = 'email'`;
  // ANY(${arr}) 바인딩은 길이 1 배열을 조용히 풀어 버린다 — 값마다 바인딩해 IN 으로 쓴다.
  return sql`(${cols.fieldType} = 'email' AND ${cols.columnKey} IN (${sql.join(
    order.map((key) => sql`${key}`),
    sql`, `,
  )}))`;
}

function orderSql(cols: PiiColumns, order: MailEmailOrder): SQL {
  if (!order || order.length === 0) return cols.columnKey;
  return sql`CASE ${cols.columnKey} ${sql.join(
    // 순위는 배열 인덱스라 리터럴로 쓴다 — 바인딩하면 CASE 결과가 text 로 추론되어 '10' < '2' 가 된다.
    order.map((key, rank) => sql`WHEN ${key} THEN ${sql.raw(String(rank))}`),
    sql` `,
  )} END`;
}

/** contact_pii 행이 발송 주소 후보인가 — 이메일 열이고, 순서가 지정된 설문이면 순위에 든 열. */
export function emailCandidateSql(order: MailEmailOrder): SQL {
  return candidateSql(PII_TABLE, order);
}

/** contact_pii 행의 발송 주소 순서 정렬식. 순위 밖 열은 emailCandidateSql 이 미리 거른다. */
export function emailOrderSql(order: MailEmailOrder): SQL {
  return orderSql(PII_TABLE, order);
}

/**
 * 대상에게 발송 주소 후보 열이 있는가 — 행 존재만 본다(복호화 실패·빈 값은 SQL 이 모른다).
 * 순위 밖 열에만 주소가 있는 대상은 발송되지 않으므로 「이메일 누락」으로 센다.
 */
export function hasEmailCandidateSql(
  order: MailEmailOrder,
  targetId: SQL = sql`${contactTargets.id}`,
): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM contact_pii cp
    WHERE cp.contact_target_id = ${targetId}
      AND ${candidateSql(PII_ALIAS, order)}
  )`;
}

function candidateBlindSql(
  order: MailEmailOrder,
  blinds: readonly string[],
  bounced: boolean,
  targetId: SQL,
): SQL {
  const inBlinds = sql`cp.blind_index IN (${sql.join(
    blinds.map((b) => sql`${b}`),
    sql`, `,
  )})`;
  return sql`EXISTS (
    SELECT 1 FROM contact_pii cp
    WHERE cp.contact_target_id = ${targetId}
      AND ${candidateSql(PII_ALIAS, order)}
      AND ${bounced ? inBlinds : sql`(cp.blind_index IS NULL OR NOT (${inBlinds}))`}
  )`;
}

/**
 * 반송 때문에 보낼 열이 남지 않은 대상 — 반송 칸이 있고, 반송 아닌 후보 칸이 없다. **칸 단위 근사**:
 * blind index 가 빈 칸(대조 불가)은 반송 아닌 칸으로 치고, 칸 안 주소가 하나씩 따로 반송된 칸은 놓친다.
 * 정확한 판정은 `resolveSendAddresses` — 사전 점검과 발송이 쓴다.
 */
export function allCandidatesBouncedSql(
  order: MailEmailOrder,
  bounced: BouncedAddresses,
  targetId: SQL = sql`${contactTargets.id}`,
): SQL {
  if (bounced.blindIndexes.length === 0) return sql`FALSE`;
  const blinds = bounced.blindIndexes;
  return sql`(${candidateBlindSql(order, blinds, true, targetId)} AND NOT ${candidateBlindSql(order, blinds, false, targetId)})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 얼굴
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailPiiRow {
  id: string;
  contactTargetId: string;
  columnKey: string;
  cipher: string;
  maskHint: string | null;
}

/**
 * 대상들의 발송 주소 후보 행을 (contact_target_id, 발송 주소 순서) 로 읽는다. 전 행을 돌려준다 —
 * 첫 칸이 비거나 복호화에 실패하면 다음 칸으로 넘어가므로 「첫 칸」 선택은 판정 쪽이 맡는다.
 * 트랜잭션 안팎 모두에서 쓰도록 executor 를 주입받는다.
 */
export async function selectEmailPiiRows(
  executor: DbOrTx,
  contactTargetIds: readonly string[],
  order: MailEmailOrder,
): Promise<EmailPiiRow[]> {
  if (contactTargetIds.length === 0) return [];
  return executor
    .select({
      id: contactPii.id,
      contactTargetId: contactPii.contactTargetId,
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
      maskHint: contactPii.maskHint,
    })
    .from(contactPii)
    .where(
      and(inArray(contactPii.contactTargetId, [...contactTargetIds]), emailCandidateSql(order)),
    )
    .orderBy(asc(contactPii.contactTargetId), asc(emailOrderSql(order)));
}

/**
 * selectEmailPiiRows 결과(정렬 보장)에서 대상마다 첫 행 — 순서상 첫 칸. 복호화하지 않는 표시(마스킹 힌트)용이다.
 * 발송 판정이 아니다 — 비거나 반송된 칸이어도 그대로 돌려준다.
 */
export function firstEmailRowByTarget<T extends { contactTargetId: string }>(
  rows: readonly T[],
): Map<string, T> {
  const first = new Map<string, T>();
  for (const row of rows) {
    if (!first.has(row.contactTargetId)) first.set(row.contactTargetId, row);
  }
  return first;
}

/** 후보 행(발송 주소 순서로 정렬된) → 대상별 칸 목록. 복호화 실패 칸은 value=null 로 남긴다. */
export function decryptSendAddressCells(
  rows: readonly { contactTargetId: string; columnKey: string; cipher: string }[],
): Map<string, SendAddressCell[]> {
  const cells = new Map<string, SendAddressCell[]>();
  for (const row of rows) {
    let value: string | null;
    try {
      value = decryptPii(row.cipher);
    } catch {
      value = null; // cipher 손상·키 불일치 — 판정이 건너뛴다
    }
    const list = cells.get(row.contactTargetId);
    if (list) list.push({ columnKey: row.columnKey, value });
    else cells.set(row.contactTargetId, [{ columnKey: row.columnKey, value }]);
  }
  return cells;
}

/** 대상 한 명의 발송 주소 칸들(발송 주소 순서대로). */
export async function loadSendAddressCells(
  executor: DbOrTx,
  contactTargetId: string,
  order: MailEmailOrder,
): Promise<SendAddressCell[]> {
  const rows = await selectEmailPiiRows(executor, [contactTargetId], order);
  return decryptSendAddressCells(rows).get(contactTargetId) ?? [];
}

/** 대상들의 발송 주소 해석 — 요청한 id 전부가 결과에 있다(후보 열이 없으면 missing). */
export async function resolveSendAddresses(
  executor: DbOrTx,
  contactTargetIds: readonly string[],
  order: MailEmailOrder,
  bounced: BouncedAddresses = NO_BOUNCED_ADDRESSES,
): Promise<Map<string, SendAddressResolution>> {
  const cells = decryptSendAddressCells(
    await selectEmailPiiRows(executor, contactTargetIds, order),
  );
  const result = new Map<string, SendAddressResolution>();
  for (const id of contactTargetIds) {
    result.set(
      id,
      resolveSendAddress(cells.get(id) ?? [], (v) => bounced.has(v)),
    );
  }
  return result;
}

/**
 * 조사 대상 한 명의 발송 주소(평문). 없으면 null. 미리보기 샘플·수신거부 화면이 쓴다.
 * 반송은 보지 않는다 — 순서상 보낼 수 있는 첫 주소이고, 단건 발송이 실제로 쓰는 주소와 같다.
 * 단체 발송은 반송된 칸을 건너뛰므로 다른 주소로 나갈 수 있다(2026-10-19 결정 — 표시는 그대로 둔다).
 */
export async function loadSendEmailForTarget(target: {
  id: string;
  surveyId: string;
  isTest: boolean;
}): Promise<string | null> {
  const order = await loadMailEmailOrder(target.surveyId, target.isTest);
  const resolved = (await resolveSendAddresses(db, [target.id], order)).get(target.id);
  return resolved?.kind === 'send' ? resolved.email : null;
}
