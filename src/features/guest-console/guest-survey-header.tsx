'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import { ArrowLeft, Eye } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SurveyGuestTabs } from '@/shared/contracts/workspace';
import type { GuestSurveyLifecycle } from '@/shared/contracts/workspace-io';

import {
  allowedGuestTabs,
  GUEST_PREVIEW_LABEL,
  GUEST_PREVIEW_SEGMENT,
  GUEST_SURVEY_LIFECYCLE_LABEL,
  guestPeriodLabel,
} from './guest-vocabulary';

interface Props {
  surveyId: string;
  title: string;
  publishedAt: Date | null;
  endDate: Date | null;
  lifecycle: GuestSurveyLifecycle;
  tabs: SurveyGuestTabs;
}

/**
 * 열람 화면의 서브헤더 + 탭 바 (.pen FLOW 5-3, 역할 모델 v2 티켓 22).
 *
 * **탭 바가 허용 탭만 그리는 것이 화면의 계약**이다 — 비활성으로 흐려 두지 않는다.
 * .pen 노트가 「분석 페이지·엑셀 다운로드·응답 상세·컨택 원본·메일은 **존재 자체가 보이지
 * 않고** 서버에서도 차단된다」라고 적은 대로, 잠긴 탭은 그리지 않는다. 서버 관문
 * (`assertGuestSurveyPageAccess`)이 같은 판정을 주소 축에서 한 번 더 한다.
 *
 * 클라이언트 컴포넌트인 이유는 활성 탭 표시 하나뿐이다 — `useSelectedLayoutSegment` 가
 * 레이아웃 아래 어느 세그먼트가 열렸는지 알려준다(경로 문자열 비교보다 정확하다).
 *
 * 「읽기 전용」 배지는 장식이 아니라 안내다. 게스트가 보는 미리보기는 응답을 저장하지
 * 않으므로, 그 사실을 화면이 먼저 말하지 않으면 클라이언트가 테스트 응답을 남긴 줄 안다.
 */
export function GuestSurveyHeader({
  surveyId,
  title,
  publishedAt,
  endDate,
  lifecycle,
  tabs,
}: Props) {
  const segment = useSelectedLayoutSegment();
  const base = `/guest/surveys/${surveyId}`;
  const links = [
    { segment: GUEST_PREVIEW_SEGMENT, label: GUEST_PREVIEW_LABEL },
    ...allowedGuestTabs(tabs),
  ];

  return (
    <div className="border-b border-[#E5E5EA] bg-white px-6 pt-4">
      <div className="mx-auto flex max-w-7xl flex-col gap-3">
        <div className="flex items-start gap-3">
          <Link
            href="/guest"
            aria-label="열람 가능한 조사 목록으로"
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[16.5px] font-semibold text-[#1C1C1E]">{title}</h1>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-medium text-[#475569]">
                <Eye className="h-3 w-3" />
                읽기 전용
              </span>
            </div>
            <p className="text-[12.5px] text-[#6E6E73]">
              {guestPeriodLabel(publishedAt, endDate)} · {GUEST_SURVEY_LIFECYCLE_LABEL[lifecycle]}
            </p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto">
          {links.map((link) => {
            const active = segment === link.segment;
            return (
              <Link
                key={link.segment}
                href={`${base}/${link.segment}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 border-b-2 px-3 pb-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-[#2E4FCE] text-[#1C1C1E]'
                    : 'border-transparent text-[#6E6E73] hover:text-[#1C1C1E]',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
