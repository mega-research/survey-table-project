'use client';

import { useRouter } from 'next/navigation';

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactsSortDir, ContactsSortKey } from '@/lib/operations/contacts';
import type { ContactsRow } from '@/server/shared/contacts.server';

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
      onRowClick={(row) =>
        router.push(`/admin/surveys/${surveyId}/operations/contacts/${row.id}`)
      }
    />
  );
}
