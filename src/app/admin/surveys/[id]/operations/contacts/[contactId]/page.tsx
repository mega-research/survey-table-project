import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContactDetailForm } from '@/components/operations/contacts/contact-detail-form';
import { getMailTemplatesBySurvey } from '@/features/mail/server/services/mail-templates.service';
import { attrsKeyOf } from '@/lib/operations/contacts';
import { extractSystemFieldKeys } from '@/lib/operations/contacts-shared';
import {
  getContactColumnScheme,
  getContactDetailById,
  getContactResultCodes,
  getEditableResponseIdForTarget,
  getMailRecipientsForTarget,
  getResponseEditLogs,
} from '@/lib/operations/contacts.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 단건 편집',
};

interface PageProps {
  params: Promise<{ id: string; contactId: string }>;
}

export default async function ContactDetailPage({ params }: PageProps) {
  const { id: surveyId, contactId } = await params;
  const scope = await getOperationsDataScope(surveyId);

  const detail = await getContactDetailById(contactId, scope);
  if (!detail || detail.contact.surveyId !== surveyId) notFound();

  // 완료·진행중·이탈 통틀어 최신 응답이 수정 대상. contactTargetId 미링크
  // 레거시 완료 건만 contact_targets.responseId 로 폴백한다 (레거시 링크는
  // 완료 시점에만 생기므로 completed 로 간주).
  const editable = await getEditableResponseIdForTarget(detail.contact.id, scope);
  const editableResponseId = editable?.id ?? detail.contact.responseId;
  const editableResponseCompleted = editable
    ? editable.status === 'completed'
    : detail.contact.responseId != null;

  const [scheme, resultCodes, mailHistory, editLogs, mailTemplates] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    getMailRecipientsForTarget(detail.contact.id, scope),
    getResponseEditLogs(editableResponseId, detail.contact.id),
    getMailTemplatesBySurvey(surveyId),
  ]);
  if (!scheme) notFound();

  const groupLabel = detail.contact.groupValue ?? '미지정';
  const companyKey = scheme.columns.find((c) => attrsKeyOf(c.source)?.includes('기업명'))?.source;
  const companyAttrsKey = companyKey ? attrsKeyOf(companyKey) : null;
  const companyName = companyAttrsKey ? detail.contact.attrs[companyAttrsKey] : null;

  const hasEmail = Object.values(detail.contact.piiDecrypted).some(
    (p) => p.fieldType === 'email' && p.plain.trim() !== '',
  );
  const mailSendDisabledReason = detail.contact.unsubscribedAt
    ? '수신거부된 대상입니다'
    : !hasEmail
      ? '이메일 정보가 없습니다'
      : null;
  const mailTemplateOptions = mailTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    fromName: t.fromName,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          조사 대상 단건 편집 — resid {detail.contact.resid}
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
        mailHistory={mailHistory}
        editLogs={editLogs}
        mailSend={{ templates: mailTemplateOptions, disabledReason: mailSendDisabledReason }}
        canReset={!(await isGuestViewer())}
        initial={{
          id: detail.contact.id,
          resid: detail.contact.resid,
          attrs: detail.contact.attrs,
          piiDecrypted: detail.contact.piiDecrypted,
          memo: detail.contact.memo,
          contactMethod: detail.contact.contactMethod,
          respondedAt: detail.contact.respondedAt,
          inviteToken: detail.contact.inviteToken,
          inviteCode: detail.contact.inviteCode,
          responseId: editableResponseId,
          responseCompleted: editableResponseCompleted,
          attempts: detail.attempts,
        }}
      />
    </main>
  );
}
