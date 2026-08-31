'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

/** 실사 열람 화면의 탭 — 초대되면 **고정**이다(게스트의 화이트리스트에 해당하는 축이 없다). */
const TABS = [
  { slug: 'contacts', label: '조사 대상' },
  { slug: 'overview', label: '응답 현황' },
] as const;

interface Props {
  surveyId: string;
  title: string;
  /** 「연구1본부 - 1팀 · 소유 김새로」 (.pen 10-2 서브헤더). */
  teamName: string | null;
  ownerName: string | null;
}

/**
 * 설문 서브헤더 + 탭 (.pen FLOW 10-2, 역할 모델 v2 티켓 26).
 *
 * 게스트 콘솔의 짝(`guest-survey-header`)과 나란하지만 **탭 바가 조건 없이 둘을 그린다**.
 * 게스트는 설문마다 열린 탭이 달라 화이트리스트를 받아야 했지만, 실사는 초대되면 조사
 * 대상·응답 현황이 함께 열린다 — 그 고정성이 두 콘솔의 차이다.
 *
 * 강제는 여기가 아니라 각 페이지의 관문이다. 탭 바는 「어디로 갈 수 있는가」를 그릴 뿐이고,
 * 주소를 직접 쳐도 `assertFieldworkSurveyPageAccess` 가 같은 판정을 다시 한다.
 */
export function FieldworkSurveyHeader({ surveyId, title, teamName, ownerName }: Props) {
  const pathname = usePathname();
  const base = `/fieldwork/surveys/${surveyId}`;
  const subtitle = [teamName, ownerName ? `소유 ${ownerName}` : null].filter(Boolean).join(' · ');

  return (
    <div className="border-b border-[#E5E5EA] bg-white">
      <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-6 py-4">
        <Link
          href="/fieldwork"
          aria-label="실사 설문 목록으로"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold text-[#1C1C1E]">{title}</span>
          <span className="truncate text-[11.5px] text-[#9CA3AF]">{subtitle || '—'}</span>
        </div>

        <div className="flex-1" />

        <nav className="flex gap-1 rounded-[10px] bg-[#EEF0F4] p-[3px]">
          {TABS.map((tab) => {
            const href = `${base}/${tab.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={tab.slug}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[30px] items-center rounded-lg px-3 text-[12.5px] transition-colors',
                  active
                    ? 'bg-white font-semibold text-[#2743AE] shadow-sm'
                    : 'text-[#6E6E73] hover:text-[#3A3A3C]',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
