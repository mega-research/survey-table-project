import { TemplateEditForm } from '@/features/operations/mail-template/template-edit-form';
import { getVariableCatalog } from '@/server/read-models/variable-catalog';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewMailTemplatePage({ params }: Props) {
  const { id: surveyId } = await params;
  // 관문이 첫 await 다 — 종전에는 변수 카탈로그 조회가 인증보다 먼저 돌았다 (티켓 10).
  // 템플릿 작성은 발송 준비 표면이라 mail.send 를 요구한다.
  const user = await assertSurveyConsolePageAccess(surveyId, 'mail.send');
  const fromDomain = process.env['RESEND_FROM_DOMAIN'] ?? '';
  const catalog = await getVariableCatalog(surveyId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">새 메일 템플릿</h1>
        <p className="mt-1 text-sm text-gray-500">조사 대상 목록에 발송할 메일 템플릿을 작성합니다.</p>
      </div>
      <TemplateEditForm
        surveyId={surveyId}
        fromDomain={fromDomain}
        catalog={catalog}
        currentUserEmail={user.email ?? ''}
      />
    </main>
  );
}
