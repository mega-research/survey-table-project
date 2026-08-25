import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CampaignWizard } from '@/features/operations/mail-campaign/campaign-wizard';
import type { CampaignFilterSnapshot } from '@/shared/contracts/mail';
import { getMailTemplatesBySurvey } from '@/server/mail/services/templates';
import {
  CAMPAIGN_SORT_KEYS,
  previewCampaignCandidates,
  type CampaignSortDir,
  type CampaignSortKey,
} from '@/server/mail/services/campaigns-read';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
} from '@/server/read-models/contacts';
import { parseClausesFromUrl } from '@/server/read-models/contacts-filters';
import { getOperationsDataScope } from '@/server/data-scope.server';
import { parseHeaderFiltersFromUrl } from '@/server/read-models/contacts-filters';
import type { FilterClause } from '@/lib/operations/filter-shared';
import { buildTemplateRedirectQuery } from '@/lib/operations/campaign-wizard-url';
import { CAMPAIGN_HEADER_FILTER_COLUMNS } from '@/lib/operations/filter-shared';
import {
  parseHeaderFilterEntries,
  type HeaderFilterEntry,
} from '@/features/operations/filters/header-filter-url';

const PAGE_SIZE = 20;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    templateId?: string;
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    hcol?: string | string[];
    hm?: string | string[];
    hv?: string | string[];
    unresponded?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

function toParamList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * searchParams 의 hcol/hm/hv → 스냅샷 엔트리. 직렬화 형상과 모드 검증은
 * parseHeaderFilterEntries 한 곳에만 두기 위해 URLSearchParams 로 되돌려 통과시킨다.
 */
function buildHeaderSnapshot(
  hcol: string | string[] | undefined,
  hm: string | string[] | undefined,
  hv: string | string[] | undefined,
): HeaderFilterEntry[] {
  const params = new URLSearchParams();
  for (const v of toParamList(hcol)) params.append('hcol', v);
  for (const v of toParamList(hm)) params.append('hm', v);
  for (const v of toParamList(hv)) params.append('hv', v);
  return parseHeaderFilterEntries(params);
}

function parsePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function NewCampaignPage({ params, searchParams }: Props) {
  const { id: surveyId } = await params;
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);

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

  // templateId 미지정이면 첫 템플릿으로 redirect — URL 일관성 유지.
  // 기존 쿼리는 보존한다 (재발송 동선의 필터·자동선택 유실 방지 — 헬퍼 주석 참조).
  if (!sp.templateId) {
    redirect(
      `/admin/surveys/${surveyId}/operations/mail/campaigns/new?${buildTemplateRedirectQuery(
        sp,
        templates[0]!.id,
      )}`,
    );
  }

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
  ]);
  const columnCandidates = buildColumnCandidates(scheme);
  const builderClauses = parseClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates, resultCodes);
  // 미리보기 표는 고정 컬럼이라 깔때기 후보도 스킴과 무관하게 고정 목록을 얹는다.
  const headerCandidates = [
    ...columnCandidates,
    ...CAMPAIGN_HEADER_FILTER_COLUMNS.filter(
      (c) => !columnCandidates.some((cc) => cc.source === c.source),
    ),
  ];
  const headerClauses = parseHeaderFiltersFromUrl(
    sp.hcol,
    sp.hm,
    sp.hv,
    headerCandidates,
    resultCodes,
  );
  // 조사 대상 목록과 같은 결합 규칙 — UI 는 상호배타지만 URL 직접 조작 시 AND 로 무해 처리.
  const clauses: FilterClause[] = [
    ...builderClauses,
    ...headerClauses.map((c, i) => ({
      condition: c.condition,
      op: builderClauses.length === 0 && i === 0 ? null : ('AND' as const),
    })),
  ];
  const unrespondedOnly = sp.unresponded === '1';

  const sort: CampaignSortKey = CAMPAIGN_SORT_KEYS.includes(sp.sort as CampaignSortKey)
    ? (sp.sort as CampaignSortKey)
    : 'resid';
  const dir: CampaignSortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const candidates = await previewCampaignCandidates({
    surveyId,
    scope,
    clauses,
    unrespondedOnly,
    sort,
    dir,
    page: parsePage(sp.page),
    pageSize: PAGE_SIZE,
  });

  // 스냅샷은 빌더/깔때기를 따로 담는다 — 깔때기의 in 모드 다중값은 {source,value,op}
  // 삼중항으로 표현할 수 없어 URL 과 동형인 hcol/hm/hv 를 그대로 보존한다.
  // 유효 절만 담기도록 파싱을 통과한 source 집합으로 원본 엔트리를 거른다.
  const validHeaderSources = new Set(headerClauses.map((c) => c.condition.source));
  const headerSnapshot = buildHeaderSnapshot(sp.hcol, sp.hm, sp.hv).filter((e) =>
    validHeaderSources.has(e.source),
  );
  const currentFilter: CampaignFilterSnapshot = {
    clauses: builderClauses.map((c) => ({
      source: c.condition.source,
      value: c.condition.value,
      op: c.op,
    })),
    ...(headerSnapshot.length > 0 ? { headerClauses: headerSnapshot } : {}),
    unrespondedOnly,
  };
  const initialClauses = builderClauses.map((c) => ({
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
          exclusions: candidates.exclusions,
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
