'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ContactEditModal } from '@/components/operations/contacts/contact-edit-modal';
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
  /** 컬럼 스킴에 매핑된 시스템 필드의 attrs key (그룹/이메일/사업자번호). 추가/편집 시 동기화용. */
  systemFieldKeys?: {
    group?: string;
    email?: string;
    biz?: string;
  };
}

type ModalState = { mode: 'add' } | { mode: 'edit'; row: ContactsRow } | null;

export function ContactsPageClient({
  surveyId,
  scheme,
  rows,
  total,
  page,
  pageSize,
  systemFieldKeys,
}: ContactsPageClientProps) {
  const [modal, setModal] = useState<ModalState>(null);

  function close() {
    setModal(null);
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <Button size="sm" onClick={() => setModal({ mode: 'add' })}>
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
        onRowClick={(row) => setModal({ mode: 'edit', row })}
      />

      {modal?.mode === 'add' && (
        <ContactEditModal
          surveyId={surveyId}
          scheme={scheme}
          systemFieldKeys={systemFieldKeys}
          onClose={close}
        />
      )}
      {modal?.mode === 'edit' && (
        <ContactEditModal
          surveyId={surveyId}
          scheme={scheme}
          systemFieldKeys={systemFieldKeys}
          initial={{ id: modal.row.id, attrs: modal.row.attrs }}
          onClose={close}
        />
      )}
    </>
  );
}
