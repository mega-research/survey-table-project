import { asc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { hydrateProfileColumns } from '@/lib/operations/profile-columns-format';
import {
  PROFILES_PAGE_SIZE,
  type StepLocation,
  buildStepLocationMap,
  formatTotalTime,
  mapStatusPill,
  normalizeListArgs,
} from '@/lib/operations/profiles-format';
import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import { getProfileColumnScheme } from '@/server/read-models/profile-column-scheme';
import { getQuestionGroupsBySurvey } from '@/server/read-models/survey-structure';
import type { ProfilesRow } from '@/shared/contracts/operations-io';
import type { ClientResponseCell, ClientResponsesPage } from '@/shared/contracts/workspace-io';

import { getSurveyContactStats } from './contact-stats';
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

/**
 * 열 — 지금은 고정이다. 클라이언트용 열 설정은 티켓 04 가 링크 행에 세운다.
 *
 * 순번 · 상태(진행 위치 포함, 2026-10-27 사용자 결정) · 시작 · 종료 · 소요시간.
 */
const DEFAULT_COLUMN_KEYS: readonly string[] = [
  'sys.idx',
  'sys.status',
  'sys.startedAt',
  'sys.completedAt',
  'sys.totalSeconds',
];

export async function listClientResponses(
  surveyId: string,
  params: { page?: string; status?: string },
): Promise<ClientResponsesPage> {
  const args = normalizeListArgs({
    ...(params.page !== undefined ? { page: params.page } : {}),
    // 휴지통 보기는 없다 — 그 값은 전체로 접는다.
    ...(params.status !== undefined && params.status !== 'deleted'
      ? { status: params.status }
      : {}),
  });
  const scope = EXTERNAL_VIEWER_DATA_SCOPE;

  const [contactScheme, profileScheme, { hasContacts }] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getProfileColumnScheme(surveyId),
    getSurveyContactStats(surveyId, scope),
  ]);
  // 라벨은 내부 응답 내역의 것을 쓴다 — 연구원이 내부에서 고친 이름이 클라이언트에게도 간다.
  const labels = new Map(
    hydrateProfileColumns(contactScheme, profileScheme).map((c) => [c.key, c.label]),
  );
  // 번호(ID) 열은 조사 대상이 있는 설문에서만 선다 — 내부 표·엑셀 내보내기와 같은 규칙.
  const keys = DEFAULT_COLUMN_KEYS.filter((key) => key !== 'sys.resid' || hasContacts);

  const [{ rows, total, page }, qs, groups] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      scope,
      pageSize: PROFILES_PAGE_SIZE,
      page: args.page,
      status: args.status,
      sort: 'idx',
      dir: 'desc',
      view: 'active',
      clauses: [],
    }),
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

  return {
    columns: keys.map((key) => labels.get(key) ?? key),
    rows: rows.map((row) => ({
      idx: row.idx,
      cells: keys.map((key) => cellOf(key, row, stepLocations, totalSteps)),
    })),
    total,
    page,
    pageSize: PROFILES_PAGE_SIZE,
    status: args.status,
  };
}

function text(value: string | null): ClientResponseCell {
  return { kind: 'text', text: value };
}

/** 한 칸 — 내부 표(`ProfilesTable`)가 같은 열을 그리는 규칙을 문자열로 옮긴다. */
function cellOf(
  key: string,
  row: ProfilesRow,
  stepLocations: ReadonlyMap<string, StepLocation>,
  totalSteps: number,
): ClientResponseCell {
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
