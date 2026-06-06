import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CampaignWizard } from '@/components/operations/mail-campaign/campaign-wizard';
import type { CampaignFilterSnapshot } from '@/db/schema/schema-types';
import { getMailTemplatesBySurvey } from '@/features/mail/server/services/mail-templates.service';
import {
  CAMPAIGN_SORT_KEYS,
  previewCampaignCandidates,
  type CampaignSortDir,
  type CampaignSortKey,
} from '@/lib/operations/campaigns.server';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
} from '@/lib/operations/contacts.server';
import { parseClausesFromUrl } from '@/lib/operations/contacts-filters.server';

const PAGE_SIZE = 20;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    templateId?: string;
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    unresponded?: string;
    sort?: string;
    dir?: string;
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
            단체 메일을 보내려면 발송할 메일 템플릿이 1개 이상 필요합니다.
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

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId),
    getContactResultCodes(surveyId),
  ]);
  const columnCandidates = buildColumnCandidates(scheme);
  const clauses = parseClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates, resultCodes);
  const unrespondedOnly = sp.unresponded === '1';

  const sort: CampaignSortKey = CAMPAIGN_SORT_KEYS.includes(sp.sort as CampaignSortKey)
    ? (sp.sort as CampaignSortKey)
    : 'resid';
  const dir: CampaignSortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const candidates = await previewCampaignCandidates({
    surveyId,
    clauses,
    unrespondedOnly,
    sort,
    dir,
    page: parsePage(sp.page),
    pageSize: PAGE_SIZE,
  });

  const currentFilter: CampaignFilterSnapshot = {
    clauses: clauses.map((c) => ({
      source: c.condition.source,
      value: c.condition.value,
      op: c.op,
    })),
    unrespondedOnly,
  };
  const initialClauses = clauses.map((c) => ({
    op: c.op,
    source: c.condition.source,
    value: c.condition.value,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <Link
          href={`/admin/surveys/${surveyId}/operations/mail/campaigns`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 단체 발송
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">새 단체 메일</h1>
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
        currentFilter={currentFilter}
        initialTemplateId={sp.templateId}
        columnCandidates={columnCandidates}
        resultCodeOptions={resultCodes}
        initialClauses={initialClauses}
        sort={sort}
        dir={dir}
      />
    </main>
  );
}
