import Link from 'next/link';

import { Mail } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import type { MailTemplate } from '@/db/schema/mail';

import { DeleteTemplateButton } from './delete-template-button';

interface Props {
  surveyId: string;
  templates: MailTemplate[];
}

export function MailTemplateList({ surveyId, templates }: Props) {
  if (templates.length === 0) {
    return (
      <Card className="border-dashed">
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <Mail className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">아직 등록된 메일 템플릿이 없습니다.</p>
          <Link
            href={`/admin/surveys/${surveyId}/operations/mail/templates/new`}
            className="mt-3 text-sm font-medium text-blue-500 hover:text-blue-600"
          >
            첫 템플릿 만들기 →
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
            <th className="px-6 py-3">이름</th>
            <th className="px-6 py-3">제목</th>
            <th className="px-6 py-3">최근 수정</th>
            <th className="w-20 px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr
              key={t.id}
              className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
            >
              <td className="px-6 py-4 font-medium text-gray-900">
                <Link
                  href={`/admin/surveys/${surveyId}/operations/mail/templates/${t.id}/edit`}
                  className="hover:text-blue-500"
                >
                  {t.name}
                </Link>
              </td>
              <td className="max-w-md truncate px-6 py-4 text-gray-600">{t.subject || '—'}</td>
              <td className="px-6 py-4 text-gray-500"><LocalDateTime value={t.updatedAt} /></td>
              <td className="px-4 py-4 text-right">
                <DeleteTemplateButton
                  surveyId={surveyId}
                  templateId={t.id}
                  templateName={t.name}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
