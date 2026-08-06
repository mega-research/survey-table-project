import Link from 'next/link';

import { Activity, ArrowLeft, Eye, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { RefreshButton } from './refresh-button';
import { SurveyControlButtons } from './survey-control-buttons';

interface Props {
  surveyId: string;
  surveyTitle: string;
  /** 게스트(설문 단위 grant) 세션 — 설문 편집 등 admin 전용 버튼을 숨긴다. */
  isGuest: boolean;
  control: {
    isPaused: boolean;
    pausedMessage: string | null;
    testModeEnabled: boolean;
    testToken: string | null;
    accessIdentifier: string;
    testResponseCount: number;
    testTargetCount: number;
    firstTestInviteCode: string | null;
  };
}

/**
 * 운영 콘솔 공통 페이지 헤더.
 *
 * `/admin/surveys/[id]/operations/*` 라우트의 layout 에서 한 번만 마운트되어
 * 모든 하위 페이지(현황/응답 내역/보고서/조사 대상)가 동일한 상단을 공유한다.
 */
export function OperationsPageHeader({ surveyId, surveyTitle, isGuest, control }: Props) {
  return (
    <nav className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/admin/surveys">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              목록으로
            </Button>
          </Link>
          <div className="h-6 w-px bg-gray-300" />
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <h1 className="max-w-md truncate text-lg font-medium text-gray-900">{surveyTitle}</h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <RefreshButton />
          {/* 설문 중단은 어드민 전용. 테스트 모드는 게스트도 ON 일 때 링크 복사만 가능 —
              SurveyControlButtons 내부에서 isGuest 로 분기한다. */}
          <SurveyControlButtons surveyId={surveyId} initial={control} isGuest={isGuest} />
          <Link href={`/admin/surveys/${surveyId}/preview`}>
            <Button variant="outline" size="sm">
              <Eye className="mr-2 h-4 w-4" />
              설문 보기
            </Button>
          </Link>
          {!isGuest && (
            <Link href={`/admin/surveys/${surveyId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-2 h-4 w-4" />
                설문 편집
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
