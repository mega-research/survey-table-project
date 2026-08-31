import 'server-only';

import { and, countDistinct, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import { decryptPiiForTargets } from '@/lib/crypto/contact-pii-repo';
import { attrsKeyOf, CONTACTS_PAGE_SIZE, piiKeyOf } from '@/lib/operations/contacts-format';
import { FILTER_SOURCE, type FilterClause } from '@/lib/operations/filter-shared';
import type { ContactColumnDef } from '@/shared/contracts/contacts';
import type {
  FieldworkContactColumn,
  FieldworkContactRow,
  FieldworkContactsPage,
} from '@/shared/contracts/workspace-io';

import { EXTERNAL_VIEWER_DATA_SCOPE } from '../data-scope';

import { getContactColumnScheme, getContactResultCodes, listContactsForSurvey } from './contacts';

/**
 * 실사의 「조사 대상」 화면 (.pen FLOW 10-2 · 스펙 §6, 티켓 26).
 *
 * **원본 전체를 본다** — 게스트의 마스킹본과 정반대다. 대리 실사라는 업무가 연락처를
 * 전제하므로 암호화 PII 를 복호해 보여주고(2026-08-25 결정), 대신 접근이 초대된 설문
 * 하나로 한정된다. `inviteToken` 이 행에 실리는 것도 같은 이유다: 게스트 행에서 그것을
 * 뺀 근거(「열람이 대리 응답이 된다」)가 여기서는 **목적**이다.
 *
 * 컬럼 스킴은 **라벨과 순서에만** 쓴다. 「실사용 컬럼 스킴 없음」이 결정의 문장이고,
 * 그 뜻은 실사에게 따로 설정할 스킴을 두지 않는다는 것이지 담당 연구원이 정한 배치를
 * 버린다는 것이 아니다 — 그래서 `hidden` 은 무시하고(원본 전체) 순서는 따른다. 스킴이
 * 없으면 데이터에 실제로 있는 attrs 키에서 만든다.
 *
 * 파티션은 **언제나 real** 이다(`EXTERNAL_VIEWER_DATA_SCOPE`) — 실사는 밖에서 실제
 * 연락처를 상대하므로 전역 테스트 모드를 따르지 않는다.
 */

export interface FieldworkContactsArgs {
  surveyId: string;
  page: number;
  /** 이름·번호·전화번호 검색 (.pen 툴바) — 전체 컬럼 검색으로 전개된다. */
  q?: string;
  /** 그룹 한 값으로 좁힘. 빈 값은 「전체」. */
  groupValue?: string;
  /** 최신 결과코드 한 값으로 좁힘. 빈 값은 「전체」. */
  resultCode?: string;
}

export async function listFieldworkContacts(
  args: FieldworkContactsArgs,
): Promise<FieldworkContactsPage> {
  const { surveyId } = args;
  const scope = EXTERNAL_VIEWER_DATA_SCOPE;

  const [scheme, resultCodes, groups, progress] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    listGroupValues(surveyId),
    countProgress(surveyId),
  ]);

  const result = await listContactsForSurvey({
    surveyId,
    scope,
    page: args.page,
    pageSize: CONTACTS_PAGE_SIZE,
    clauses: buildClauses(args),
    ...(args.groupValue ? { groupValue: args.groupValue } : {}),
    sort: 'resid',
    dir: 'asc',
  });

  const columns = visibleColumns(scheme?.columns ?? [], result.rows);
  // **복호는 페이지 단위로만** 한다(decryptPiiForTargets 주석) — 전량 복호는 비용도 크고
  // 화면에 그리지도 않는다. 실패한 항목은 결과에서 빠지고 칸은 「—」가 된다.
  const piiKeys = columns.flatMap((column) => {
    const key = piiKeyOf(column.source);
    return key ? [key] : [];
  });
  const decrypted = await decryptPiiForTargets(
    result.rows.map((row) => row.id),
    piiKeys,
  );

  return {
    columns: columns.map((column): FieldworkContactColumn => ({
      key: column.key,
      label: column.label,
    })),
    rows: result.rows.map((row): FieldworkContactRow => ({
      contactTargetId: row.id,
      resid: row.resid,
      cells: columns.map((column) => cellOf(column, row, decrypted.get(row.id) ?? {})),
      groupValue: row.groupValue,
      latestResultCode: row.latestResultCode,
      attemptCount: row.latestAttemptNo ?? 0,
      responseStatus: row.responseStatus,
      inviteToken: row.inviteToken,
    })),
    total: result.total,
    page: result.page,
    pageSize: CONTACTS_PAGE_SIZE,
    groups,
    // 코드 문자열만 건넨다 — 화면이 드롭다운 선택지로 쓰고, 저장은 그 값을 그대로 보낸다.
    // 톤·라벨은 실사 표에 없다(.pen 10-2 는 「최근 결과」를 평문으로 그린다).
    resultCodes: [...resultCodes]
      .sort((a, b) => a.order - b.order)
      .map((code) => code.code),
    progress,
  };
}

/**
 * 툴바의 두 필터를 DSL 절로 옮긴다.
 *
 * 그룹은 여기 없다 — 필터 소스가 컬럼 스킴 위에 서 있어 그룹(행 자체의 속성)은 자리가
 * 없다. `listContactsForSurvey` 의 `groupValue` 인자가 그 축이다.
 */
function buildClauses(args: FieldworkContactsArgs): FilterClause[] {
  const clauses: FilterClause[] = [];
  const q = args.q?.trim();
  if (q) {
    // 전체 컬럼 검색 — attrs ILIKE + pii blind index exact 를 서버가 OR 로 전개한다.
    // 실사에게 pii 검색이 열려 있는 것은 원본 열람과 같은 근거다(전화번호로 찾는다).
    clauses.push({
      condition: { source: FILTER_SOURCE.ALL, mode: 'any', value: q },
      op: null,
    });
  }
  if (args.resultCode) {
    clauses.push({
      condition: { source: FILTER_SOURCE.CONTACT_RESULT, mode: 'enum', value: args.resultCode },
      op: clauses.length === 0 ? null : 'AND',
    });
  }
  return clauses;
}

/**
 * 그릴 컬럼 — 스킴의 순서를 따르되 **`hidden` 은 무시한다**(원본 전체).
 *
 * 스킴이 없거나 attrs 를 다 담지 못한 설문에서는 실제 데이터의 키로 메운다 — 업로드만
 * 하고 컬럼을 정리하지 않은 설문에서 실사가 빈 표를 보면 안 된다.
 */
function visibleColumns(
  columns: readonly ContactColumnDef[],
  rows: readonly SourceRow[],
): ContactColumnDef[] {
  const ordered = columns
    .filter((column) => !HIDDEN_SOURCES.has(column.source))
    .slice()
    .sort((a, b) => a.order - b.order);

  const known = new Set(
    ordered.flatMap((column) => {
      const key = attrsKeyOf(column.source);
      return key ? [key] : [];
    }),
  );
  const extras = [...new Set(rows.flatMap((row) => Object.keys(row.attrs)))]
    .filter((key) => !known.has(key))
    .sort()
    .map((key, index): ContactColumnDef => ({
      key,
      label: key,
      source: `attrs.${key}`,
      order: ordered.length + index,
    }));

  return [...ordered, ...extras];
}

/**
 * 실사 표에서 빼는 컬럼.
 *
 * 메일 축은 실사에게 항상 차단이라(스펙 §8) 열조차 두지 않는다. `contact_owner` 는 운영
 * 콘솔에서도 자리만 있는 컬럼이다 — 실사 표에서까지 빈 열을 그릴 이유가 없다.
 */
const HIDDEN_SOURCES = new Set(['system.email_count', 'system.contact_owner']);

type SourceRow = Awaited<ReturnType<typeof listContactsForSurvey>>['rows'][number];

/** 한 칸의 표시 문자열 — 값이 없으면 null 이고 화면이 「—」로 그린다. */
function cellOf(
  column: ContactColumnDef,
  row: SourceRow,
  plainPii: Record<string, string>,
): string | null {
  const attrsKey = attrsKeyOf(column.source);
  if (attrsKey !== null) return row.attrs[attrsKey] ?? null;

  const piiKey = piiKeyOf(column.source);
  // **복호된 원문**이다 — 게스트 투영이 마스킹 힌트를 쓰는 자리와 정확히 대칭이다.
  // 복호에 실패한 항목은 맵에 없어 「—」가 된다(상세 화면의 readonly 처리와 달리 편집
  // 경로가 아니라 안전하다).
  if (piiKey !== null) return plainPii[piiKey] ?? null;

  switch (column.source) {
    case 'system.resid':
      return String(row.resid);
    case 'system.contact_result':
      return row.latestResultCode;
    default:
      // 응답 상태·그룹·시도는 행이 따로 들고 있어 화면이 전용 열로 그린다(.pen 10-2).
      return null;
  }
}

/** 그룹 드롭다운 선택지 — 이 설문에 실제로 있는 값만, 없으면 빈 배열. */
async function listGroupValues(surveyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupValue: contactTargets.groupValue })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, false),
        isNotNull(contactTargets.groupValue),
      ),
    )
    .orderBy(contactTargets.groupValue);
  return rows.flatMap((row) => (row.groupValue ? [row.groupValue] : []));
}

/**
 * 진척 배지 「완료 117 / 전체 142」 (.pen 툴바).
 *
 * **필터와 무관한 설문 전체 수**다 — 검색어를 넣었다고 목표가 줄지 않는다. 완료는 컨택에
 * 매칭된 완료 응답 수이고, 분모는 조사 대상 수다.
 */
async function countProgress(surveyId: string): Promise<{ completed: number; total: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: countDistinct(
        sql`case when ${surveyResponses.status} = 'completed' then ${contactTargets.id} end`,
      ),
    })
    .from(contactTargets)
    .leftJoin(
      surveyResponses,
      and(
        eq(surveyResponses.contactTargetId, contactTargets.id),
        eq(surveyResponses.isTest, false),
      ),
    )
    .where(and(eq(contactTargets.surveyId, surveyId), eq(contactTargets.isTest, false)));
  return { total: row?.total ?? 0, completed: row?.completed ?? 0 };
}
