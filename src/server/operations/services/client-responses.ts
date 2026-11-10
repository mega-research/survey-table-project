import { asc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import { formatLocalDateTime } from '@/lib/date-formatters';
import { logger } from '@/lib/logger';
import { resolveClientResponseColumnKeys } from '@/lib/operations/client-response-columns-format';
import { formatPlatformKo } from '@/lib/operations/parse-ua';
import { answerKeyOf, entryKeyOf } from '@/lib/operations/profile-columns-format';
import {
  PROFILES_PAGE_SIZE,
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
  loadClientResponseColumnMaterial,
} from '@/server/read-models/client-response-columns';
import { getQuestionGroupsBySurvey } from '@/server/read-models/survey-structure';
import type { ProfilesRow } from '@/shared/contracts/operations-io';
import type { ClientResponseCell, ClientResponsesPage } from '@/shared/contracts/workspace-io';

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

  // 열은 링크 행의 설정이다(티켓 04) — 연구원이 「열 설정」에서 고른 것. 저장된 키를 **지금 구조로
  // 다시 거른다**: 저장 뒤 문항이 지워지거나 암호화로 바뀌었거나 행을 손으로 고쳤으면 그 열은
  // 여기서 빠진다. 허용 판정은 저장과 같은 한 함수다.
  const [material, saved] = await Promise.all([
    loadClientResponseColumnMaterial(surveyId),
    getActiveClientLinkResponseColumns(surveyId),
  ]);
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
    listResponsesForProfiles({
      surveyId,
      scope,
      // 클라이언트 링크에는 담당 범위 축이 없다 — 설문 전체(ADR-0029, ADR-0035).
      share: FIELDWORK_SHARE_ALL,
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
  // 응답값 열은 그 페이지 행만 읽는다(내부와 같은 로더). 암호화 저장 칸은 허용 판정이 이미 뺐다 —
  // 이 로더는 암호문을 복호화하므로, 판정을 거치지 않은 키를 여기 넘기면 평문이 나간다.
  const answerValues =
    answerKeys.length > 0
      ? await loadProfileAnswerValues(
          rows.map((r) => r.id),
          answerKeys,
        )
      : {};

  return {
    columns: keys.map((key) => labels.get(key) ?? key),
    rows: rows.map((row) => ({
      idx: row.idx,
      cells: keys.map((key) =>
        cellOf(key, row, stepLocations, totalSteps, answerValues[row.id] ?? {}),
      ),
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
