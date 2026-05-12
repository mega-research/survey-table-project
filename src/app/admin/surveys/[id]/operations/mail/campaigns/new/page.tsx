import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CampaignWizard } from '@/components/operations/mail-campaign/campaign-wizard';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import { getMailTemplatesBySurvey } from '@/data/mail-templates';
import { previewCampaignCandidates } from '@/lib/operations/campaigns.server';

const PAGE_SIZE = 20;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    templateId?: string;
    q?: string;
    unresponded?: string;
    page?: string;
  }>;
}

function parsePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function NewCampaignPage({ params, searchParams }: Props) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  const templates = await getMailTemplatesBySurvey(surveyId);
  if (templates.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <h1 className="text-lg font-semibold text-slate-900">먼저 메일 템플릿을 만드세요.</h1>
          <p className="mt-2 text-sm text-slate-500">
            캠페인을 보내려면 발송할 메일 템플릿이 1개 이상 필요합니다.
          </p>
          <Link
            href={`/admin/surveys/${surveyId}/operations/mail/templates/new`}
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            템플릿 만들러 가기 →
          </Link>
        </div>
      </main>
    );
  }

  // templateId 미지정이면 첫 템플릿으로 redirect — URL 일관성 유지
  if (!sp.templateId) {
    redirect(
      `/admin/surveys/${surveyId}/operations/mail/campaigns/new?templateId=${templates[0]!.id}`,
    );
  }

  const filter: CampaignFilterSnapshot = {
    q: sp.q ?? '',
    qfield: 'all',
    unrespondedOnly: sp.unresponded === '1',
  };

  const candidates = await previewCampaignCandidates({
    surveyId,
    filter,
    page: parsePage(sp.page),
    pageSize: PAGE_SIZE,
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <Link
          href={`/admin/surveys/${surveyId}/operations/mail/campaigns`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 캠페인 목록
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">새 캠페인</h1>
        <p className="mt-1 text-sm text-gray-500">
          템플릿을 고르고, 수신자를 필터링한 뒤, 명단을 확정해 발송을 시작합니다.
        </p>
      </div>

      <CampaignWizard
        surveyId={surveyId}
        templates={templates}
        candidates={{
          rows: candidates.rows,
          total: candidates.total,
          page: candidates.page,
          pageSize: PAGE_SIZE,
        }}
        currentFilter={filter}
        initialTemplateId={sp.templateId}
      />
    </main>
  );
}
