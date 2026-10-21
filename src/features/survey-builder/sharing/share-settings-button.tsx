'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SurveyVisibility } from '@/shared/contracts/workspace';

import { ShareSettingsModal } from './share-settings-modal';

interface Props {
  surveyId: string;
  surveyTitle: string;
  visibility: SurveyVisibility;
  /** 서버가 판정한 `survey.manageAccess` — 운영 레이아웃은 근사가 아니라 판정 결과를 준다. */
  canManageAccess: boolean;
  currentOwnerName: string | null;
  currentOwnerUserId: string | null;
  ownerTeamName: string | null;
}

/**
 * 운영 헤더의 「공유」 — 설문 카드 케밥의 「공유」와 같은 모달을 연다.
 *
 * 운영 콘솔(operations 묶음)은 이 묶음을 import 할 수 없어 라우트가 이 버튼을 헤더의
 * `shareAction` 자리에 끼운다. 모달이 바꾸는 공개 범위·소유자는 레이아웃이 RSC 로 읽어 준
 * 값이라 닫을 때 `router.refresh()` 로 다시 읽는다 — 안 그러면 다시 열었을 때 옛 범위가 보인다.
 */
export function ShareSettingsButton(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Share2 className="mr-2 h-4 w-4" />
        공유
      </Button>
      {open && (
        <ShareSettingsModal
          {...props}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
