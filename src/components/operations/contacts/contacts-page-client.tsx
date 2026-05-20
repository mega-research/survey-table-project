'use client';

import { useRouter } from 'next/navigation';

import { ContactsTable } from '@/components/operations/contacts/contacts-table';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import type { ContactsSortDir, ContactsSortKey } from '@/lib/operations/contacts';
import type { ContactsRow } from '@/lib/operations/contacts.server';

interface ContactsPageClientProps {
  surveyId: string;
  scheme: ContactColumnScheme;
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
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
      onRowClick={(row) =>
        router.push(`/admin/surveys/${surveyId}/operations/contacts/${row.id}`)
      }
    />
  );
}
