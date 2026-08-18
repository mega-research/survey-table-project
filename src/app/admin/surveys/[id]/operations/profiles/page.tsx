import type { Metadata } from 'next';
import Link from 'next/link';

import { asc, eq } from 'drizzle-orm';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ProfilesFilterBar } from '@/components/operations/profiles/profiles-filter-bar';
import { ProfilesTable } from '@/components/operations/profiles/profiles-table';
import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import { getSurveyContactStats } from '@/lib/operations/contact-stats.server';
import {
  PROFILES_PAGE_SIZE,
  buildStepLocationMap,
  hasActiveFilters,
  normalizeListArgs,
} from '@/lib/operations/profiles';
import { listResponsesForProfiles } from '@/lib/operations/profiles.server';
import {
  hydrateProfileColumns,
  visibleProfileColumns,
} from '@/lib/operations/profile-columns';
import { getProfileColumnScheme } from '@/lib/operations/profile-columns.server';
import { decryptPiiForTargets } from '@/lib/crypto/contact-pii-repo';
import { getContactColumnScheme, buildColumnCandidates } from '@/lib/operations/contacts.server';
import { parseProfilesCondition, PROFILES_EXTRA_CANDIDATES } from '@/lib/operations/profiles-filters.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

export const metadata: Metadata = {
  title: '현황 - 응답 내역',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string;
    col?: string;
    status?: string;
    sort?: string;
    dir?: string;
  }>;
}

/**
 * 운영 콘솔 응답 내역 페이지.
 *
 * 서버 페이지네이션 + URL state 동기화. 0건 케이스 분기:
 *  - 필터 활성 → ProfilesTable 의 "검색 결과가 없습니다" EmptyState
 *  - 필터 없는데도 0건 → 페이지 단의 "아직 응답이 없습니다"
 */
export default async function ProfilesPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  const args = normalizeListArgs(sp);
  const [scope, isGuest] = await Promise.all([getOperationsDataScope(surveyId), isGuestViewer()]);

  const [contactScheme, profileScheme] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getProfileColumnScheme(surveyId),
  ]);
  // 표시 컬럼 스킴 — NULL(미설정)이면 hydrate 가 기본 스킴(기존 9컬럼)을 만든다.
  const displayColumns = visibleProfileColumns(
    hydrateProfileColumns(contactScheme, profileScheme),
  );
  const columnCandidates = [
    ...PROFILES_EXTRA_CANDIDATES,
    ...buildColumnCandidates(contactScheme).filter(
      (c) =>
        c.source === 'system.resid' ||
        c.source.startsWith('attrs.') ||
        c.source.startsWith('pii.'),
    ),
  ];
  const condition = parseProfilesCondition(args.col, args.q, columnCandidates);

  // 번호(ID) 열 노출 판정 — 엑셀 내보내기와 조건부 규칙 공유(설문 설정 기준, 매칭 무관).
  // 목록 쿼리보다 먼저 조회해 고아 sort(컨택 없는데 ?sort=resid 잔존 URL)를 순번 정렬로 폴백한다.
  const { hasContacts } = await getSurveyContactStats(surveyId, scope);
  const sort = !hasContacts && args.sort === 'resid' ? 'idx' : args.sort;

  const [{ rows, total, page: clampedPage }, qs, groups] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      scope,
      pageSize: PROFILES_PAGE_SIZE,
      page: args.page,
      status: args.status,
      sort,
      dir: args.dir,
      view: args.view,
      condition,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
        type: questionsTable.type,
        groupId: questionsTable.groupId,
        questionCode: questionsTable.questionCode,
        // 그룹 없이 pageBreakBefore 로만 페이지를 나누는 설문에서 이 필드가 빠지면
        // buildRenderSteps 가 전체를 한 페이지로 계산해 stepLocations 매칭이 전부 미스난다
        pageBreakBefore: questionsTable.pageBreakBefore,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
    getQuestionGroupsBySurvey(surveyId),
  ]);

  // 표시 스킴의 pii.* 컬럼만 현재 페이지 행 단위로 일괄 복호화.
  const piiKeys = displayColumns
    .filter((c) => c.key.startsWith('pii.'))
    .map((c) => c.key.slice('pii.'.length));
  const piiTargetIds = rows
    .map((r) => r.contactTargetId)
    .filter((id): id is string => id !== null);
  const piiByTarget =
    piiKeys.length > 0 && piiTargetIds.length > 0
      ? Object.fromEntries(await decryptPiiForTargets(piiTargetIds, piiKeys))
      : {};

  // currentStepId(페이지 step ID) → 대표 질문 order/번호 역매핑. 진행중 응답의 N/M·Qx 표기에 사용.
  const stepLocations = Object.fromEntries(buildStepLocationMap(qs, groups));
  const totalSteps = qs.length;

  const hasFilter = hasActiveFilters(sp);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {args.view === 'deleted' ? '삭제된 응답' : '응답 내역'}
          </h2>
          <p className="text-sm text-slate-500">
            {args.view === 'deleted'
              ? `삭제된 응답 — ${total.toLocaleString('ko-KR')}건. 복원하면 통계에 다시 포함됩니다.`
              : `응답자별 세션 트래킹 — ${total.toLocaleString('ko-KR')}건`}
          </p>
        </div>
        {!isGuest && (
          <Button asChild variant="outline">
            <Link href={`/admin/surveys/${surveyId}/operations/profiles/columns`}>
              컬럼 설정
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="px-5 py-4">
          <div className="mb-4">
            <ProfilesFilterBar
              initialSource={args.col}
              initialValue={args.q}
              initialStatus={args.status}
              columnCandidates={columnCandidates}
            />
          </div>

          {total === 0 && !hasFilter ? (
            <EmptyState
              message={args.view === 'deleted' ? '삭제된 응답이 없습니다' : '아직 응답이 없습니다'}
              description={args.view === 'deleted' ? '응답을 삭제하면 여기에 모입니다' : '응답이 들어오면 여기에 표시됩니다'}
            />
          ) : (
            <ProfilesTable
              rows={rows}
              total={total}
              page={clampedPage}
              pageSize={PROFILES_PAGE_SIZE}
              sort={sort}
              dir={args.dir}
              stepLocations={stepLocations}
              totalSteps={totalSteps}
              surveyId={surveyId}
              view={args.view}
              hasContacts={hasContacts}
              isGuest={isGuest}
              columnScheme={displayColumns}
              piiByTarget={piiByTarget}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
