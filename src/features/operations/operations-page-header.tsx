import Link from 'next/link';

import { Activity, ArrowLeft, Eye, Pencil } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { Button } from '@/components/ui/button';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import {
  adminSurveyEditPath,
  adminSurveyListPath,
  adminSurveyPreviewPath,
} from './operations-paths';
import { RefreshButton } from './refresh-button';
import { SurveyControlButtons } from './survey-control-buttons';

interface Props {
  surveyId: string;
  surveyTitle: string;
  /**
   * 이 주체가 이 설문에서 할 수 있는 일 — 설문 단위 액션의 노출을 정한다.
   *
   * 설문 중단·테스트 모드·설문 편집은 전부 `survey.edit` 하나다. 예전에는 「게스트인가」로
   * 물었는데, 그 값은 admin 구역에서 언제나 false 라(비내부 계정은 레이아웃이 자기 홈으로
   * 되돌린다) 실제로는 아무것도 가리지 않았고 `survey.edit` 없는 팀원에게 누르면 실패하는
   * 버튼을 보여 주고 있었다.
   */
  capabilities: ReadonlySet<SurveyCapability>;
  /**
   * 내부 전용 자리를 그릴 것인가 — 목록으로·설문 보기·로그아웃.
   *
   * 탭 스트립과 **같은 축**이다(거기 주석 참조). capability 로 물을 수 없다: 설문 목록과 빌더
   * 미리보기는 admin 주소이고 로그아웃은 계정 동작이라, 외주 실사 링크 주체는 `survey.view` 를
   * 갖고도 그 셋에 닿지 못한다. 예전 `isGuest` 가 하던 은폐를 이 축이 잇는다 — 둘 중 한쪽만
   * 축을 가지면 링크 콘솔에서 헤더만 admin 링크를 그린다.
   */
  internalShell?: boolean;
  /**
   * 헤더 오른쪽 끝에 덧붙일 것 — 셸마다 다른 「나가기」가 여기로 온다.
   *
   * 계정 셸은 `LogoutButton`(`internalShell`)이고 외주 실사 링크 셸은 쿠키 하나를 지우는
   * 다른 동작이라, 헤더가 그 둘을 알면 운영 콘솔이 링크 모델을 import 하게 된다. 슬롯으로
   * 받으면 헤더는 자리만 알고 무엇이 오는지는 모른다.
   */
  trailing?: React.ReactNode;
  /**
   * 설문 제어 상태 — `survey.edit` 를 가진 주체에게만 쓰인다.
   *
   * 없을 수 있는 것이 계약이다: 외주 실사 링크 셸은 중단·테스트 모드 버튼을 그리지 않으므로
   * 그 재료를 읽을 이유가 없다(읽으면 화면에 쓰이지 않는 왕복이 하나 는다).
   */
  control?: {
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
export function OperationsPageHeader({
  surveyId,
  surveyTitle,
  capabilities,
  internalShell = true,
  trailing,
  control,
}: Props) {
  const canEdit = capabilities.has('survey.edit');
  return (
    <nav className="border-b border-gray-200 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-4">
          {internalShell && (
            <>
              <Link href={adminSurveyListPath()}>
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  목록으로
                </Button>
              </Link>
              <div className="h-6 w-px bg-gray-300" />
            </>
          )}
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <h1 className="max-w-md truncate text-lg font-medium text-gray-900">{surveyTitle}</h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <RefreshButton />
          {/* 설문 중단·테스트 모드는 설문을 고칠 수 있는 주체만 */}
          {canEdit && control && <SurveyControlButtons surveyId={surveyId} initial={control} />}
          {internalShell && (
            <Link href={adminSurveyPreviewPath(surveyId)}>
              <Button variant="outline" size="sm">
                <Eye className="mr-2 h-4 w-4" />
                설문 보기
              </Button>
            </Link>
          )}
          {canEdit && (
            <Link href={adminSurveyEditPath(surveyId)}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-2 h-4 w-4" />
                설문 편집
              </Button>
            </Link>
          )}
          {/* 로그아웃은 계정 동작이다 — 링크 세션의 「나가기」는 쿠키를 지우는 다른 일이다. */}
          {internalShell && <LogoutButton iconOnly />}
          {trailing}
        </div>
      </div>
    </nav>
  );
}
