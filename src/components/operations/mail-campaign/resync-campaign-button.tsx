'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { getErrorMessage } from '@/lib/get-error-message';
import { client } from '@/shared/lib/rpc';

interface Props {
  surveyId: string;
  campaignId: string;
}

/**
 * 발송 후 "진행중"에 멈춘 수신자를 Resend 실제 상태로 되묻는 수동 재조회 버튼.
 *
 * 자동 reconcile 은 발송 후 1m/5m/30m 3회뿐이라 그 이후 유실된 webhook 은 회수 수단이 없다.
 * 진행중이 0건이면 되물을 대상이 없으므로 호출부에서 버튼 자체를 숨긴다.
 */
export function ResyncCampaignButton({ surveyId, campaignId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      try {
        const { checked, updated } = await client.mail.campaigns.resync({
          surveyId,
          campaignId,
        });
        toast.success(
          updated > 0
            ? `${checked.toLocaleString('ko-KR')}건 조회 — ${updated.toLocaleString('ko-KR')}건 갱신했습니다.`
            : `${checked.toLocaleString('ko-KR')}건 조회 — Resend 쪽도 아직 결과가 없습니다.`,
        );
      } catch (err) {
        toast.error(getErrorMessage(err, '상태 재조회 실패'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isPending}>
      {isPending ? '재조회 중…' : '상태 재조회'}
    </Button>
  );
}
