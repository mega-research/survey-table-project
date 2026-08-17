import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ContactUploadAction } from '@/components/operations/contacts/contact-upload-action';
import { ContactsDownloadDialog } from '@/components/operations/contacts/contacts-download-dialog';
import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';
import { ContactsPageClient } from '@/components/operations/contacts/contacts-page-client';
import {
  attrsKeyOf,
  CONTACTS_PAGE_SIZE,
  effectiveSortKey,
  normalizeSortKey,
} from '@/lib/operations/contacts';
import { buildDownloadCandidates } from '@/lib/operations/contacts-export';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
  listContactsForSurvey,
} from '@/lib/operations/contacts.server';
import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  type FilterClause,
} from '@/lib/operations/contacts-filters.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

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
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);

  // page / sort / dir 파싱 — 다중 조건 필터 전환과 함께 normalizeContactListArgs 가 제거되어 인라인 처리.
  const pageRaw = Number(sp.page);
  const parsedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const dir = sp.dir === 'desc' ? ('desc' as const) : ('asc' as const);

  // 스킴 + resultCodes 병렬 로드
  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
  ]);

  // sort key — hidden 컬럼이면 'resid' 폴백 (URL 직접 조작 가드)
  const visibleAttrsKeys = new Set(
    (scheme?.columns ?? [])
      .filter((c) => !c.hidden)
      .map((c) => attrsKeyOf(c.source))
      .filter((k): k is string => k != null),
  );

  const safeSort = effectiveSortKey(normalizeSortKey(sp.sort), visibleAttrsKeys);

  const columnCandidates = buildColumnCandidates(scheme);

  const builderClauses = parseClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates, resultCodes);
  const headerClauses = parseHeaderFiltersFromUrl(
    sp.hcol,
    sp.hm,
    sp.hv,
    columnCandidates,
    resultCodes,
  );
  // UI 가 상호배타를 강제하므로 정상 흐름에선 한쪽만 존재.
  // URL 직접 조작으로 둘 다 있으면 AND 결합으로 무해하게 처리.
  const clauses: FilterClause[] = [
    ...builderClauses,
    ...headerClauses.map((c, i) => ({
      condition: c.condition,
      op: builderClauses.length === 0 && i === 0 ? null : ('AND' as const),
    })),
  ];

  const { rows, total, page: clampedPage } = await listContactsForSurvey({
    surveyId,
    scope,
    pageSize: CONTACTS_PAGE_SIZE,
    clauses,
    page: parsedPage,
    sort: safeSort,
    dir,
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
          <Button asChild size="sm">
            <Link href={`/admin/surveys/${surveyId}/operations/contacts/new`}>+ 조사 대상 추가</Link>
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
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
