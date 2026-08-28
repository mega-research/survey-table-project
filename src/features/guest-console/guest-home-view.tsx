import Link from 'next/link';

import { BarChart3, FileText } from 'lucide-react';

import type { GuestSurveyCardRow } from '@/shared/contracts/workspace-io';

import { GuestEmptyState } from './guest-empty-state';

import {
  allowedGuestTabs,
  firstGuestTabSegment,
  GUEST_PREVIEW_LABEL,
  GUEST_PREVIEW_SEGMENT,
  GUEST_SURVEY_LIFECYCLE_LABEL,
  guestPeriodLabel,
} from './guest-vocabulary';

interface Props {
  surveys: GuestSurveyCardRow[];
}

/**
 * 게스트 홈 — 부여된 설문 카드 목록 (.pen FLOW 5-2, 역할 모델 v2 티켓 22).
 *
 * 목록에 있는 것이 곧 볼 수 있는 것 전부다. 카드가 「열람 가능」 필로 허용 탭을 미리
 * 보여주는 것이 이 화면의 요점이다 — 1계정 N설문이고 **설문마다 허용 탭이 다르므로**,
 * 들어가 봐야 무엇이 열려 있는지 아는 화면은 클라이언트를 헤매게 한다.
 *
 * 서버 컴포넌트다 — 필터도 정렬도 없어 클라이언트 상태가 없다.
 */
export function GuestHomeView({ surveys }: Props) {
  return (
    <main className="mx-auto max-w-[900px] px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-[22px] font-semibold text-[#1C1C1E]">열람 가능한 조사</h1>
        <p className="text-[13px] text-[#6E6E73]">
          담당 연구원이 부여한 설문의 미리보기와 현황을 볼 수 있습니다.
        </p>
      </div>

      {surveys.length === 0 ? (
        <div className="mt-6">
          <GuestEmptyState
            title="부여된 설문이 없습니다."
            description="담당 연구원이 설문을 부여하면 여기에 표시됩니다."
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {surveys.map((survey) => (
            <GuestSurveyCard key={survey.surveyId} survey={survey} />
          ))}
        </div>
      )}
    </main>
  );
}

function GuestSurveyCard({ survey }: { survey: GuestSurveyCardRow }) {
  const tabs = allowedGuestTabs(survey.tabs);
  const firstTab = firstGuestTabSegment(survey.tabs);
  const base = `/guest/surveys/${survey.surveyId}`;

  return (
    <article className="flex flex-col gap-3 rounded-[14px] border border-[#E5E5EA] bg-white p-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-[15px] font-semibold text-[#1C1C1E]">{survey.title}</h2>
          <p className="text-[12.5px] text-[#6E6E73]">
            {guestPeriodLabel(survey.publishedAt, survey.endDate)} ·{' '}
            {GUEST_SURVEY_LIFECYCLE_LABEL[survey.lifecycle]}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#9CA3AF]">열람 가능</span>
          {tabs.length === 0 ? (
            <span className="text-[11px] text-[#9CA3AF]">설문 미리보기만</span>
          ) : (
            tabs.map((tab) => (
              <span
                key={tab.segment}
                className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-medium text-[#2743AE]"
              >
                {tab.label}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`${base}/${GUEST_PREVIEW_SEGMENT}`}
          className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[#E5E5EA] bg-white px-3.5 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
        >
          <FileText className="h-3.5 w-3.5" />
          {GUEST_PREVIEW_LABEL}
        </Link>
        {/* 허용 탭이 하나도 없으면 「현황 보기」를 그리지 않는다 — 눌러도 404 인 버튼은 안 만든다. */}
        {firstTab !== null && (
          <Link
            href={`${base}/${firstTab}`}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-3.5 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            현황 보기
          </Link>
        )}
      </div>
    </article>
  );
}
