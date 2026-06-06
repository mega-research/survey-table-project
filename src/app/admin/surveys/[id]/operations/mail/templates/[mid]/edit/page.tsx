import { notFound } from 'next/navigation';

import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/components/operations/mail-template/variable-catalog';
import { getMailTemplate } from '@/features/mail/server/services/mail-templates.service';
import { requireAuth } from '@/lib/auth';

interface Props {
  params: Promise<{ id: string; mid: string }>;
}

export default async function EditMailTemplatePage({ params }: Props) {
  const { id: surveyId, mid: templateId } = await params;
  const template = await getMailTemplate(surveyId, templateId);
  if (!template) notFound();

  const fromDomain = process.env['RESEND_FROM_DOMAIN'] ?? '';
  const catalog = await getVariableCatalog(surveyId);
  const user = await requireAuth();

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
