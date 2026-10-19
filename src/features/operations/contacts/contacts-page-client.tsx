'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { contactDetailHref } from '@/features/operations/contacts/contacts-list-return';
import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactsSortDir, ContactsSortKey } from '@/lib/operations/contacts-format';
import type { ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactAssignmentOption, ContactsRow } from '@/shared/contracts/contacts-io';

interface ContactsPageClientProps {
  surveyId: string;
  scheme: ContactColumnScheme;
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
  resultCodeOptions: ContactResultCode[];
  /** 「컨택원」 열 머리 필터 선택지 (컨택원 순서). 게스트는 빈 배열. */
  assignmentOptions?: ContactAssignmentOption[];
}

/**
 * 조사 대상 표 + 행 클릭 라우팅. + 업로드 / + 조사 대상 추가 액션은 page.tsx 헤더에 있음.
 */
export function ContactsPageClient({
  surveyId,
  scheme,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  resultCodeOptions,
  assignmentOptions = [],
}: ContactsPageClientProps) {
  const router = useRouter();
  // 지금 목록의 페이지·필터·정렬을 단건 편집으로 실어 가 「목록」이 이 화면으로 돌아오게 한다.
  const listQuery = useSearchParams().toString();

  return (
    <ContactsTable
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      scheme={scheme}
      sort={sort}
      dir={dir}
      surveyId={surveyId}
      resultCodeOptions={resultCodeOptions}
      assignmentOptions={assignmentOptions}
      onRowClick={(row) => router.push(contactDetailHref(surveyId, row.id, listQuery))}
    />
  );
}
