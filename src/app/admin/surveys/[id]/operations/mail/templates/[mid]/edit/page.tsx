import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/features/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/server/read-models/variable-catalog';
import { getMailTemplate } from '@/server/mail/services/templates';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  // 관문이 첫 await 다 — 종전에는 템플릿 조회가 인증보다 먼저 돌았다 (티켓 10).
  // 템플릿 편집은 발송 준비 표면이라 mail.send 를 요구한다.
  const user = await assertSurveyConsolePageAccess(surveyId, 'mail.send');
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env['RESEND_FROM_DOMAIN'] ?? '';
  const catalog = await getVariableCatalog(surveyId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">메일 템플릿 편집</h1>
        <p className="mt-1 text-sm text-gray-500">{template.name}</p>
      </div>
      <TemplateEditForm
        surveyId={surveyId}
        fromDomain={fromDomain}
        catalog={catalog}
        template={template}
        currentUserEmail={user.email ?? ''}
      />
    </main>
  );
}
