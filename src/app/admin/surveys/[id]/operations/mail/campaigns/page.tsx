import Link from 'next/link';

import { Plus } from 'lucide-react';

import { CampaignsList } from '@/components/operations/mail-campaign/campaigns-list';
import { UnsubscribedSegment } from '@/components/operations/mail-campaign/unsubscribed-segment';
import { Button } from '@/components/ui/button';
import {
  listCampaignsForSurvey,
  listUnsubscribedContacts,
} from '@/lib/operations/campaigns.server';

const PAGE_SIZE = 20;
const UNSUB_PAGE_SIZE = 10;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; unsubPage?: string }>;
}

function parsePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function MailCampaignsListPage({ params, searchParams }: Props) {
  const { id: surveyId } = await params;
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const unsubPage = parsePage(sp.unsubPage);

  const [campaigns, unsubscribed] = await Promise.all([
    listCampaignsForSurvey({ surveyId, page, pageSize: PAGE_SIZE }),
    listUnsubscribedContacts({ surveyId, page: unsubPage, pageSize: UNSUB_PAGE_SIZE }),
  ]);

  return (
    <main className="mx-auto max-w-7xl space-y-10 px-6 py-8">
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">메일 캠페인</h1>
            <p className="mt-1 text-sm text-gray-500">
              컨택리스트로 단체 발송한 회차와 발송 현황을 관리합니다.
            </p>
          </div>
          <Button asChild>
            <Link href={`/admin/surveys/${surveyId}/operations/mail/campaigns/new`}>
              <Plus className="mr-1.5 h-4 w-4" />
              발송 등록
            </Link>
          </Button>
        </div>
        <CampaignsList
          surveyId={surveyId}
          rows={campaigns.rows}
          total={campaigns.total}
          page={campaigns.page}
          pageSize={PAGE_SIZE}
        />
      </section>

      <section id="unsubscribed">
        <UnsubscribedSegment
          surveyId={surveyId}
          rows={unsubscribed.rows}
          total={unsubscribed.total}
          page={unsubscribed.page}
          pageSize={UNSUB_PAGE_SIZE}
        />
      </section>
    </main>
  );
}
