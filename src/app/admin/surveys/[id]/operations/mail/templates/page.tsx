import Link from 'next/link';

import { Plus } from 'lucide-react';

import { MailTemplateList } from '@/components/operations/mail-template/mail-template-list';
import { Button } from '@/components/ui/button';
import { getMailTemplatesBySurvey } from '@/features/mail/server/services/mail-templates.service';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MailTemplatesListPage({ params }: Props) {
  const { id: surveyId } = await params;
  const templates = await getMailTemplatesBySurvey(surveyId);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">메일 템플릿</h1>
          <p className="mt-1 text-sm text-gray-500">
            조사 대상 목록에 발송할 메일 템플릿을 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href={`/admin/surveys/${surveyId}/operations/mail/templates/new`}>
            <Plus className="mr-1.5 h-4 w-4" />
            새 템플릿
          </Link>
        </Button>
      </div>
      <MailTemplateList surveyId={surveyId} templates={templates} />
    </main>
  );
}
