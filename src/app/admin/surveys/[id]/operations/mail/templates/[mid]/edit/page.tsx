import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/features/operations/mail-template/template-edit-form';
import { requirePageUser } from '@/lib/auth/require-page-user';
import { getMailTemplate } from '@/server/mail/services/templates';
import { getVariableCatalog } from '@/server/read-models/variable-catalog';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  // 미들웨어를 통과한 무권한 세션을 거른다 — 이 설문에 접근할 수 있는 계정만.
  await requireSurveyConsolePage(surveyId);
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env['RESEND_FROM_DOMAIN'] ?? '';
  const catalog = await getVariableCatalog(surveyId);
  const user = await requirePageUser();

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
