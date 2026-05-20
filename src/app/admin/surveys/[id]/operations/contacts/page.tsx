import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';
import { ContactsPageClient } from '@/components/operations/contacts/contacts-page-client';
import {
  attrsKeyOf,
  CONTACTS_PAGE_SIZE,
  CONTACTS_SORT_KEYS,
  effectiveSortKey,
  isAttrsSortKey,
  type ContactsSortKey,
} from '@/lib/operations/contacts';
import {
  getContactColumnScheme,
  getContactResultCodes,
  listContactsForSurvey,
} from '@/lib/operations/contacts.server';
import {
  parseClausesFromUrl,
  type ColumnCandidate,
} from '@/lib/operations/contacts-filters.server';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 목록',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function ContactsPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  // page / sort / dir 파싱 — 다중 조건 필터 전환과 함께 normalizeContactListArgs 가 제거되어 인라인 처리.
  const pageRaw = Number(sp.page);
  const parsedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const dir = sp.dir === 'desc' ? ('desc' as const) : ('asc' as const);

  // 스킴 + resultCodes 병렬 로드
  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId),
    getContactResultCodes(surveyId),
  ]);

  // sort key — hidden 컬럼이면 'resid' 폴백 (URL 직접 조작 가드)
  const visibleAttrsKeys = new Set(
    (scheme?.columns ?? [])
      .filter((c) => !c.hidden)
      .map((c) => attrsKeyOf(c.source))
      .filter((k): k is string => k != null),
  );

  // sort key normalize: 시스템 키 whitelist OR attrs.* (길이 제한)
  // CONTACTS_SORT_KEYS / isAttrsSortKey 는 contacts.ts export 를 그대로 참조해 drift 방지.
  function normalizeSortKey(value: string | undefined): ContactsSortKey {
    if (!value) return 'resid';
    if (isAttrsSortKey(value) && value.length <= 200) return value;
    return (CONTACTS_SORT_KEYS as readonly string[]).includes(value)
      ? (value as ContactsSortKey)
      : 'resid';
  }

  const safeSort = effectiveSortKey(normalizeSortKey(sp.sort), visibleAttrsKeys);

  // 컬럼 후보: system.resid / system.contact_result / system.web + attrs.* + pii.*
  // system.email_count / system.contact_owner 는 placeholder 라 제외
  const columnCandidates: ColumnCandidate[] = (scheme?.columns ?? [])
    .filter(
      (c) =>
        c.source === 'system.resid' ||
        c.source === 'system.contact_result' ||
        c.source === 'system.web' ||
        c.source.startsWith('attrs.') ||
        c.source.startsWith('pii.'),
    )
    .map((c) => ({ source: c.source, label: c.label, piiType: c.piiType }));

  const clauses = parseClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates, resultCodes);

  const { rows, total, page: clampedPage } = await listContactsForSurvey({
    surveyId,
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
              <Button asChild>
                <Link href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}>
                  엑셀 업로드
                </Link>
              </Button>
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
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}>+ 업로드</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="px-5 py-4 space-y-4">
          <ContactsFilterBar
            surveyId={surveyId}
            initialClauses={clauses.map((c) => ({
              op: c.op,
              source: c.condition.source,
              value: c.condition.value,
            }))}
            columnCandidates={columnCandidates}
            resultCodeOptions={resultCodes}
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
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
