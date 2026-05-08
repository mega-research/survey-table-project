import { TemplateEditForm } from '@/components/operations/mail-template/template-edit-form';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewMailTemplatePage({ params }: Props) {
  const { id: surveyId } = await params;
  const fromDomain = process.env.RESEND_FROM_DOMAIN ?? '';

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">새 메일 템플릿</h1>
        <p className="mt-1 text-sm text-gray-500">컨택리스트에 발송할 메일 템플릿을 작성합니다.</p>
      </div>
      <TemplateEditForm surveyId={surveyId} fromDomain={fromDomain} />
    </main>
  );
}
