'use client';

import { useRouter } from 'next/navigation';

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactsSortDir, ContactsSortKey } from '@/lib/operations/contacts-format';
import type { ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactsRow } from '@/shared/contracts/contacts-io';

import { operationsPaths } from '../operations-paths';

interface ContactsPageClientProps {
  surveyId: string;
  /** 이 콘솔의 주소 접두 — 행 클릭이 자기 트리 안에 머문다. */
  basePath: string;
  scheme: ContactColumnScheme;
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
  resultCodeOptions: ContactResultCode[];
}

/**
 * 조사 대상 표 + 행 클릭 라우팅. + 업로드 / + 조사 대상 추가 액션은 page.tsx 헤더에 있음.
 */
export function ContactsPageClient({
  surveyId,
  basePath,
  scheme,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  resultCodeOptions,
}: ContactsPageClientProps) {
  const router = useRouter();

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
      onRowClick={(row) => router.push(operationsPaths(basePath).contact(row.id))}
    />
  );
}
