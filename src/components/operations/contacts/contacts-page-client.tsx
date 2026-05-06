'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ContactsTable } from '@/components/operations/contacts/contacts-table';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import type { ContactsRow } from '@/lib/operations/contacts.server';

interface ContactsPageClientProps {
  surveyId: string;
  scheme: ContactColumnScheme;
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 호환성 prop — 본 컴포넌트는 사용 안 함. */
  systemFieldKeys?: { group?: string; email?: string; biz?: string };
}

export function ContactsPageClient({
  surveyId,
  scheme,
  rows,
  total,
  page,
  pageSize,
}: ContactsPageClientProps) {
  const router = useRouter();

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <Button
          size="sm"
          onClick={() => router.push(`/admin/surveys/${surveyId}/operations/contacts/new`)}
        >
          + 컨택 추가
        </Button>
      </div>

      <ContactsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        scheme={scheme}
        surveyId={surveyId}
        onRowClick={(row) =>
          router.push(`/admin/surveys/${surveyId}/operations/contacts/${row.id}`)
        }
      />
    </>
  );
}
