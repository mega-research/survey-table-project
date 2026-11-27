import { asc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { decryptSharedSecret, encryptSharedSecret } from '@/lib/crypto/aes';
import { questions as questionsTable } from '@/db/schema';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { logger } from '@/lib/logger';
import { resolveClientResponseColumnKeys } from '@/lib/operations/client-response-columns-format';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { answerKeyOf, entryKeyOf } from '@/lib/operations/profile-columns-format';
import {
  PROFILES_PAGE_SIZE,
  type StatusFilter,
  type StepLocation,
  buildStepLocationMap,
  formatTotalTime,
  mapStatusPill,
  normalizeListArgs,
} from '@/lib/operations/profiles-format';
import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';
import { FIELDWORK_SHARE_ALL } from '@/server/fieldwork-share-scope';
import {
  getActiveClientLinkResponseColumns,
  getClientLinkResponseColumns,
  loadClientResponseColumnMaterial,
} from '@/server/read-models/client-response-columns';
import { getQuestionGroupsBySurvey } from '@/server/read-models/survey-structure';
import type { ProfilesRow } from '@/shared/contracts/operations-io';
import type {
  ClientResponseCell,
  ClientResponseRow,
  ClientResponsesPage,
} from '@/shared/contracts/workspace-io';

import { loadProfileAnswerValues } from './profile-answer-values';
import { listResponsesForProfiles } from './profiles';

/**
 * 클라이언트 링크의 응답 내역 — **보기 전용 투영** (`.scratch/client-link-response-list` 티켓 03).
 *
 * 내부 응답 내역의 행(`ProfilesRow`)에는 응답 id·조사 대상 id·IP 해시·명단 값 전체·이어 넘길 값
 * 전체가 실려 있다. 그것을 클라이언트 컴포넌트에 넘기면 화면에 열로 그리지 않아도 RSC payload
 * 로 나간다. 그래서 여기서 **표시 값만 남긴 새 행**을 만든다 — 조사 대상 마스킹본
 * (`read-models/guest-contacts`)과 같은 계약이다. 「무엇을 안 그리는가」가 아니라 「무엇이 오지
 * 않는가」가 이 모듈의 전부다.
 *
 * 목록 자체는 내부와 **같은 조회**(`listResponsesForProfiles`)다 — 접수 순번·상태 필터·삭제 제외가
 * 한 벌이어야 응답 현황 KPI 와 숫자가 갈리지 않는다. 파티션은 언제나 실데이터다.
 *
 * 좁히기는 상태 하나뿐이다. 값 검색·헤더 필터·정렬 변경은 없다 — 고르지 않은 열의 값으로
 * 검색하거나 정렬할 수 있으면 숨긴 값이 결과 순서·건수로 드러난다. 휴지통 보기도 없다(복원은
 * 클라이언트의 일이 아니다).
 */

export interface ClientResponsesOptions {
  /**
   * 관문이 승인한 링크(`ClientLinkPageViewer.linkId`). 열 설정과 응답 조회 키를 이 링크로 묶는다 — 설문 id 로
   * 「지금 활성인 링크」를 다시 찾으면 그사이 링크가 바뀌었을 때 남의 링크 설정이 적용된다. 생략하면 설문의
   * 활성 링크를 읽는다(링크 세션이 없는 호출 — 테스트·내부 미리보기).
   */
  linkId?: string;
  /**
   * 행마다 조회 키(`viewId`)를 싣는다 — 「응답 조회」 칩(`responseView`)이 열린 링크에서만 켠다. 키는 응답 id 가
   * 아니라 이 링크에서만 풀리는 암호문이다(`encodeClientResponseViewKey`). **응답 id 는 응답자의 쓰기 권한이다**
   * — 진행 중 실응답의 답 저장(`saveDraft`)이 응답 id 하나로 지난다. `linkId` 가 없으면 켤 수 없다.
   */
  viewKeys?: boolean;
}

/** 관문이 승인한 링크가 그사이 닫혔다 — 그 요청은 진행하지 않는다(화면은 notFound, 내려받기는 404). */
export class ClientLinkGoneError extends Error {
  constructor() {
    super('client link closed during request');
    this.name = 'ClientLinkGoneError';
  }
}

export async function listClientResponses(
  surveyId: string,
  params: { page?: string; status?: string },
  options: ClientResponsesOptions = {},
): Promise<ClientResponsesPage> {
  const args = normalizeListArgs({
    ...(params.page !== undefined ? { page: params.page } : {}),
    // 휴지통 보기는 없다 — 그 값은 전체로 접는다.
    ...(params.status !== undefined && params.status !== 'deleted'
      ? { status: params.status }
      : {}),
  });
  const built = await buildClientResponses(surveyId, {
    page: args.page,
    pageSize: PROFILES_PAGE_SIZE,
    status: args.status,
    linkId: options.linkId,
    viewKeys: options.viewKeys === true,
  });
  return { ...built, pageSize: PROFILES_PAGE_SIZE, status: args.status };
}

/** 엑셀 내려받기의 한 번 상한 — 내부 내보내기(`MAX_EXPORT_RESPONSES`)와 같은 값이다. */
export const CLIENT_RESPONSES_EXPORT_LIMIT = 10_000;

export type ClientResponsesExport =
  | { kind: 'ok'; columns: string[]; rows: ClientResponseRow[] }
  | { kind: 'too_many'; total: number };

/**
 * 엑셀 내려받기의 재료 — 화면(`listClientResponses`)과 **같은 열·같은 칸 규칙**의 전체 행. 좁히기는
 * 화면에서 고른 상태 하나뿐이다(페이지만 없다). 조회 키는 싣지 않는다.
 *
 * 상한 판정을 **먼저** 한다 — 한 행짜리 조회로 건수만 보고, 넘으면 행·응답값을 읽지 않고 돌아간다.
 */
export async function listClientResponsesForExport(
  surveyId: string,
  params: { status?: string },
  options: { linkId: string },
): Promise<ClientResponsesExport> {
  const args = normalizeListArgs({
    ...(params.status !== undefined && params.status !== 'deleted' ? { status: params.status } : {}),
  });
  const { total } = await listResponsesForProfiles(profilesArgs(surveyId, 1, 1, args.status));
  if (total > CLIENT_RESPONSES_EXPORT_LIMIT) return { kind: 'too_many', total };
  const built = await buildClientResponses(surveyId, {
    page: 1,
    pageSize: CLIENT_RESPONSES_EXPORT_LIMIT,
    status: args.status,
    linkId: options.linkId,
    viewKeys: false,
  });
  if (built.total > CLIENT_RESPONSES_EXPORT_LIMIT) return { kind: 'too_many', total: built.total };
  return { kind: 'ok', columns: built.columns, rows: built.rows };
}

/** 엑셀 한 칸 — 화면의 칸을 글자로 접는다(상태는 라벨 + 진행 위치, 빈 칸은 빈 글자). */
export function clientResponseCellText(cell: ClientResponseCell): string {
  if (cell.kind === 'status') return cell.sub ? `${cell.label} · ${cell.sub}` : cell.label;
  return cell.text ?? '';
}

// ── 응답 조회 키 ────────────────────────────────────────────────────────────────
// 클라이언트 주소·payload 에 응답 id 를 싣지 않는다 — 응답 id 는 진행 중 실응답의 쓰기 권한이다
// (공개 답 저장이 응답 id 하나로 지난다). 키는 `<링크 id>:<응답 id>` 를 인증 암호화(AES-GCM, 공유 비밀
// 키)한 것이라 이 서버만 풀고, 다른 링크의 세션으로는 풀어도 링크가 맞지 않아 거부된다 — 링크를 닫고 새로
// 발급하면 옛 키는 전부 죽는다.

const VIEW_KEY_SEP = ':';

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
}

/** 조회 키 만들기 — `v1:<base64>` 를 주소에 실을 수 있게 `v1.<base64url>` 로 바꾼다. */
export function encodeClientResponseViewKey(linkId: string, responseId: string): string {
  const token = encryptSharedSecret(`${linkId}${VIEW_KEY_SEP}${responseId}`);
  const sep = token.indexOf(':');
  return `${token.slice(0, sep)}.${toBase64Url(token.slice(sep + 1))}`;
}

/** 조회 키 풀기 — 이 링크의 키가 아니거나 위조·손상이면 null(사유를 가르지 않는다). */
export function decodeClientResponseViewKey(linkId: string, key: string): string | null {
  const dot = key.indexOf('.');
  if (dot <= 0 || key.length > 512) return null;
  let plain: string;
  try {
    plain = decryptSharedSecret(`${key.slice(0, dot)}:${fromBase64Url(key.slice(dot + 1))}`);
  } catch {
    return null;
  }
  const sep = plain.indexOf(VIEW_KEY_SEP);
  if (sep < 0 || plain.slice(0, sep) !== linkId) return null;
  const responseId = plain.slice(sep + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(responseId)
    ? responseId
    : null;
}

function profilesArgs(surveyId: string, page: number, pageSize: number, status: StatusFilter) {
  return {
    surveyId,
    scope: EXTERNAL_VIEWER_DATA_SCOPE,
    // 클라이언트 링크에는 담당 범위 축이 없다 — 설문 전체(ADR-0029, ADR-0035).
    share: FIELDWORK_SHARE_ALL,
    pageSize,
    page,
    status,
    sort: 'idx' as const,
    dir: 'desc' as const,
    view: 'active' as const,
    clauses: [],
  };
}

async function buildClientResponses(
  surveyId: string,
  args: {
    page: number;
    pageSize: number;
    status: StatusFilter;
    linkId: string | undefined;
    viewKeys: boolean;
  },
): Promise<{ columns: string[]; rows: ClientResponseRow[]; total: number; page: number }> {
  // 열은 링크 행의 설정이다(티켓 04) — 연구원이 「열 설정」에서 고른 것. 저장된 키를 **지금 구조로
  // 다시 거른다**: 저장 뒤 문항이 지워지거나 암호화로 바뀌었거나 행을 손으로 고쳤으면 그 열은
  // 여기서 빠진다. 허용 판정은 저장과 같은 한 함수다.
  const [material, saved] = await Promise.all([
    loadClientResponseColumnMaterial(surveyId),
    args.linkId !== undefined
      ? getClientLinkResponseColumns(surveyId, args.linkId)
      : getActiveClientLinkResponseColumns(surveyId),
  ]);
  if (saved === null) throw new ClientLinkGoneError();
  const { keys: resolved, dropped } = resolveClientResponseColumnKeys(saved.keys, material.sources);
  if (dropped.length > 0) {
    logger.warn(
      { surveyId, keys: dropped },
      'client response columns dropped on read — not allowed or gone',
    );
  }
  // 번호(ID) 열은 조사 대상이 있는 설문에서만 선다 — 내부 표·엑셀 내보내기와 같은 규칙.
  const keys = resolved.filter((key) => key !== 'sys.resid' || material.hasContacts);
  // 라벨은 내부 응답 내역의 것을 쓴다 — 연구원이 내부에서 고친 이름이 클라이언트에게도 간다.
  const labels = new Map(material.candidates.map((c) => [c.key, c.label]));
  const answerKeys = keys.filter((key) => answerKeyOf(key) !== null);

  const [{ rows, total, page }, qs, groups] = await Promise.all([
    listResponsesForProfiles(profilesArgs(surveyId, args.page, args.pageSize, args.status)),
    // 진행 위치(Qx)를 문항 번호로 바꾸는 재료 — 내부 응답 내역 화면과 같은 필드다.
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
        type: questionsTable.type,
        groupId: questionsTable.groupId,
        questionCode: questionsTable.questionCode,
        pageBreakBefore: questionsTable.pageBreakBefore,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
    getQuestionGroupsBySurvey(surveyId),
  ]);
  const stepLocations = buildStepLocationMap(qs, groups);
  const totalSteps = qs.length;
  // 응답값 열은 그 페이지 행만 읽는다(내부와 같은 로더). 암호화 저장 칸은 허용 판정이 이미 뺐다 —
  // 그래도 **저장값이 암호문인 칸은 비운다**: 허용 판정은 지금 문항 설정을 보므로, 개인정보 저장을 나중에
  // 끈 문항의 옛 응답은 암호문으로 남아 있고 이 로더가 그것을 푼다(게스트 목록 엑셀과 같은 그물).
  const encrypted = new Set<string>();
  const answerValues =
    answerKeys.length > 0
      ? await loadProfileAnswerValues(
          rows.map((r) => r.id),
          answerKeys,
          undefined,
          (responseId, columnKey) => encrypted.add(`${responseId}\u0000${columnKey}`),
        )
      : {};
  for (const cell of encrypted) {
    const [responseId, columnKey] = cell.split('\u0000') as [string, string];
    const values = answerValues[responseId];
    if (values) delete values[columnKey];
  }
  const linkId = args.linkId;
  const withKeys = args.viewKeys && linkId !== undefined;

  return {
    columns: keys.map((key) => labels.get(key) ?? key),
    rows: rows.map((row) => ({
      idx: row.idx,
      ...(withKeys ? { viewId: encodeClientResponseViewKey(linkId, row.id) } : {}),
      cells: keys.map((key) =>
        cellOf(key, row, stepLocations, totalSteps, answerValues[row.id] ?? {}),
      ),
    })),
    total,
    page,
  };
}

function text(value: string | null): ClientResponseCell {
  return { kind: 'text', text: value };
}

/**
 * 한 칸 — 내부 표(`ProfilesTable`)가 같은 열을 그리는 규칙을 문자열로 옮긴다. 허용 판정을 지난
 * 키만 온다 — 모르는 키는 빈 칸이다.
 */
function cellOf(
  key: string,
  row: ProfilesRow,
  stepLocations: ReadonlyMap<string, StepLocation>,
  totalSteps: number,
  answers: Readonly<Record<string, string>>,
): ClientResponseCell {
  // 고른 열의 값만 꺼낸다 — 행의 명단 값·이어 넘길 값 전체는 이 함수 밖으로 나가지 않는다.
  const entryName = entryKeyOf(key);
  if (entryName !== null) return text(row.entryParams?.[entryName] || null);
  if (key.startsWith('attrs.')) return text(row.attrs?.[key.slice('attrs.'.length)] || null);
  if (answerKeyOf(key) !== null) return text(answers[key] || null);
  switch (key) {
    case 'sys.idx':
      return text(String(row.idx));
    case 'sys.resid':
      return text(row.resid === null ? null : String(row.resid));
    case 'sys.group':
      return text(row.groupValue ?? '공개링크');
    case 'sys.platform':
      return text(formatPlatformKo(row.platform));
    case 'sys.browser':
      return text(row.browser ?? 'Other');
    case 'sys.status': {
      const location = row.currentStepId ? stepLocations.get(row.currentStepId) : undefined;
      const pill = mapStatusPill({
        status: row.status,
        visibleStepIndex: row.visibleStepIndex,
        visibleStepTotal: row.visibleStepTotal,
        totalQuestions: totalSteps,
        qNumber: location?.qNumber ?? null,
      });
      return {
        kind: 'status',
        label: pill.label,
        tone: pill.tone,
        ...(pill.sub !== undefined ? { sub: pill.sub } : {}),
      };
    }
    case 'sys.startedAt':
      return text(formatLocalDateTime(row.startedAt));
    case 'sys.completedAt':
      return text(
        row.status === 'in_progress'
          ? '진행 중'
          : row.completedAt === null
            ? null
            : formatLocalDateTime(row.completedAt),
      );
    case 'sys.totalSeconds':
      return text(formatTotalTime(row.totalSeconds, row.status));
    default:
      return text(null);
  }
}
