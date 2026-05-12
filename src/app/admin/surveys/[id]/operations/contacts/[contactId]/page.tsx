import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContactDetailForm } from '@/components/operations/contacts/contact-detail-form';
import { attrsKeyOf } from '@/lib/operations/contacts';
import { extractSystemFieldKeys } from '@/lib/operations/contacts-shared';
import {
  getContactColumnScheme,
  getContactDetailById,
  getContactResultCodes,
} from '@/lib/operations/contacts.server';

export const metadata: Metadata = {
  title: '현황 - 컨택 단건 편집',
};

interface PageProps {
  params: Promise<{ id: string; contactId: string }>;
}

export default async function ContactDetailPage({ params }: PageProps) {
  const { id: surveyId, contactId } = await params;

  const detail = await getContactDetailById(contactId);
  if (!detail || detail.contact.surveyId !== surveyId) notFound();

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId),
    getContactResultCodes(surveyId),
  ]);
  if (!scheme) notFound();

  const groupLabel = detail.contact.groupValue ?? '미지정';
  const companyKey = scheme.columns.find((c) => attrsKeyOf(c.source)?.includes('기업명'))?.source;
  const companyAttrsKey = companyKey ? attrsKeyOf(companyKey) : null;
  const companyName = companyAttrsKey ? detail.contact.attrs[companyAttrsKey] : null;

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          컨택 단건 편집 — resid {detail.contact.resid}
        </h2>
        <p className="text-sm text-slate-500">
          {groupLabel}
          {companyName ? ` · ${companyName}` : ''}
        </p>
      </div>

      <ContactDetailForm
        surveyId={surveyId}
        scheme={scheme}
        resultCodes={resultCodes}
        systemFieldKeys={extractSystemFieldKeys(scheme)}
        initial={{
          id: detail.contact.id,
          resid: detail.contact.resid,
          attrs: detail.contact.attrs,
          piiDecrypted: detail.contact.piiDecrypted,
          memo: detail.contact.memo,
          contactMethod: detail.contact.contactMethod,
          respondedAt: detail.contact.respondedAt,
          inviteToken: detail.contact.inviteToken,
          attempts: detail.attempts,
        }}
      />
    </main>
  );
}
