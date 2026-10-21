'use client';

import { SurveyStatusControl } from './survey-status-control';
import { TestModeControl } from './test-mode-control';

interface Props {
  surveyId: string;
  initial: {
    isPaused: boolean;
    pausedMessage: string | null;
    isClosed: boolean;
    testModeEnabled: boolean;
    testViewInBrowser: boolean;
    testToken: string | null;
    accessIdentifier: string;
    testResponseCount: number;
    testTargetCount: number;
    firstTestInviteCode: string | null;
  };
}

/**
 * 운영 헤더의 설문 제어 버튼 둘 — 테스트 모드 · 설문 중단/종료.
 *
 * 둘 다 같은 모양이다: 버튼은 지금 상태를 말하고 메뉴만 열며, 바꾸는 일은 메뉴 안 토글이 한다.
 * - 테스트 모드: TestModeControl (설문 편집 헤더와 공용).
 * - 중단·종료: SurveyStatusControl — 독립인 두 축(ADR-0030)을 한 메뉴의 토글 둘로 둔다.
 */
export function SurveyControlButtons({ surveyId, initial }: Props) {
  return (
    <>
      <TestModeControl surveyId={surveyId} initial={initial} />
      <SurveyStatusControl
        surveyId={surveyId}
        initial={{
          isPaused: initial.isPaused,
          pausedMessage: initial.pausedMessage,
          isClosed: initial.isClosed,
        }}
      />
    </>
  );
}
