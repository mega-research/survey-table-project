import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/features/operations/empty-state';
import { ContactUploadAction } from '@/features/operations/contacts/contact-upload-action';
import { ContactsDownloadDialog } from '@/features/operations/contacts/contacts-download-dialog';
import { ContactsFilterBar } from '@/features/operations/contacts/contacts-filter-bar';
import { ContactsPageClient } from '@/features/operations/contacts/contacts-page-client';
import {
  contactDetailHref,
  listQueryFromSearchParams,
} from '@/features/operations/contacts/contacts-list-return';
import { resolveContactListSort } from '@/lib/contacts/default-sort';
import { CONTACTS_PAGE_SIZE, visiblePiiColumnKeys } from '@/lib/operations/contacts-format';
import { buildDownloadCandidates } from '@/lib/operations/contacts-export-format';
import { listContactsForSurvey } from '@/server/read-models/contacts';
import {
  contactFilterInputFromUrl,
  loadContactFilterContext,
  resolveContactFilter,
} from '@/server/read-models/contact-filter-resolution';
import { getOperationsDataScope } from '@/server/data-scope';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 목록',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    hcol?: string | string[];
    hm?: string | string[];
    hv?: string | string[];
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function ContactsPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  // 이 화면은 개인정보 평문을 싣는다 — 미들웨어를 통과한 무권한 세션을 여기서 한 번 더 거른다.
  await requireSurveyConsolePage(surveyId);
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);

  // page / sort / dir 파싱 — 다중 조건 필터 전환과 함께 normalizeContactListArgs 가 제거되어 인라인 처리.
  const pageRaw = Number(sp.page);
  const parsedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const dir = sp.dir === 'desc' ? ('desc' as const) : ('asc' as const);

  // 스킴·결과코드·컨택원·필터 후보 — 게스트면 컨택원 열·후보·선택지가 빠져 있다.
  const isGuest = await isGuestViewer();
  const filterCtx = await loadContactFilterContext(surveyId, scope, {
    isGuest,
    surface: 'contacts',
  });
  const { scheme, resultCodes, assignmentOptions, columnCandidates } = filterCtx;

  // sort key — 주소에 정렬이 없으면 컬럼 설정의 기본 정렬 열(없으면 시스템ID),
  // 있으면 그 값(hidden 컬럼이면 'resid' 폴백 — URL 직접 조작 가드).
  const requestedSort = resolveContactListSort(sp.sort, scheme);
  const safeSort = isGuest && requestedSort === 'owner' ? 'resid' : requestedSort;

  const filter = await resolveContactFilter(filterCtx, contactFilterInputFromUrl(sp), {
    mode: 'read',
  });
  const { builderClauses, clauses } = filter;

  const { rows, total, page: clampedPage } = await listContactsForSurvey({
    surveyId,
    scope,
    pageSize: CONTACTS_PAGE_SIZE,
    filter,
    page: parsedPage,
    sort: safeSort,
    dir,
    includeAssignment: !isGuest,
    // 표시 중인 개인정보 열은 가리지 않고 보인다 — 이 목록을 여는 계정(관리자·실사 게스트)은
    // 행을 눌러 상세에서 이미 평문을 본다(2026-11-11 결정). 보기 전용 게스트는 이 경로에 못 온다.
    plainPiiKeys: visiblePiiColumnKeys(scheme),
  });

  if (!scheme) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">조사 대상 목록</h2>
        </div>
        <Card>
          <CardContent className="px-5 py-4">
            <EmptyState
              message="아직 업로드된 조사 대상이 없습니다"
              description="엑셀 파일을 업로드해 명단을 적재하세요."
            />
            <div className="mt-4 flex justify-center">
              <ContactUploadAction
                href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}
                label="엑셀 업로드"
                disabled={scope === 'test'}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const hasFilter = clauses.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">조사 대상 목록</h2>
          <p className="text-sm text-slate-500">총 {total.toLocaleString('ko-KR')}건</p>
        </div>
        <div className="flex items-center gap-2">
          <ContactsDownloadDialog
            surveyId={surveyId}
            candidates={buildDownloadCandidates(scheme)}
          />
          <ContactUploadAction
            href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}
            label="+ 업로드"
            disabled={scope === 'test'}
          />
          {/* 이월 응답은 명단과 다른 경로다 — 명단 업로드의 replace 는 개별 링크를 재발급한다. */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/surveys/${surveyId}/operations/contacts/prior-answers`}>
              이월 응답 임포트
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={contactDetailHref(surveyId, 'new', listQueryFromSearchParams(sp))}>
              + 조사 대상 추가
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="px-5 py-4 space-y-4">
          <ContactsFilterBar
            surveyId={surveyId}
            initialClauses={builderClauses.map((c) => ({
              op: c.op,
              source: c.condition.source,
              value: c.condition.value,
            }))}
            columnCandidates={columnCandidates}
            resultCodeOptions={resultCodes}
            assignmentOptions={assignmentOptions}
            columnsSettingsHref={`/admin/surveys/${surveyId}/operations/contacts/columns`}
          />
          {rows.length === 0 ? (
            <EmptyState
              message={hasFilter ? '검색 결과가 없습니다' : '조사 대상이 없습니다'}
              description={hasFilter ? '필터를 변경해 보세요.' : '엑셀로 명단을 업로드하세요.'}
            />
          ) : (
            <ContactsPageClient
              rows={rows}
              total={total}
              page={clampedPage}
              pageSize={CONTACTS_PAGE_SIZE}
              scheme={scheme}
              surveyId={surveyId}
              sort={safeSort}
              dir={dir}
              resultCodeOptions={resultCodes}
              assignmentOptions={assignmentOptions}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
