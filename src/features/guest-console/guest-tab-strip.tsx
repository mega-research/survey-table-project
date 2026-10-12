'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import { cn } from '@/lib/utils';
import type { SurveyGuestTabs } from '@/shared/contracts/workspace';

import { allowedGuestTabs, guestConsoleHref } from './guest-vocabulary';

interface Props {
  /** 이 열람 화면의 주소 접두 — 탭 링크가 그 아래로 간다(화면은 자기 주소를 모른다). */
  basePath: string;
  tabs: SurveyGuestTabs;
  /**
   * 탭 줄 오른쪽 끝의 한 줄 — 조사 기간·진행 상태.
   *
   * 화면 머리는 운영 콘솔의 것을 그대로 쓰는데 거기에는 이 자리가 없다. 클라이언트 링크는
   * 설문이 중단돼도 열려 있으므로(ADR-0029) 「지금 멈춰 있다」를 화면이 말해 줄 곳이 필요하다.
   */
  meta?: string;
}

/**
 * 클라이언트 링크 콘솔의 탭 줄 — **운영 콘솔 탭 스트립과 같은 얼굴**이다.
 *
 * 운영 콘솔의 `OperationsTabStrip` 을 그대로 쓰지 못하는 이유는 탭을 여는 축이 달라서다.
 * 저쪽은 capability 로 묻고(진척 보고가 `contacts.view`, 쿼터가 내부 셸), 이쪽은 연구원이 켠
 * **탭 화이트리스트**로 묻는다 — 클라이언트 링크의 열은 둘뿐이라 capability 로는 네 탭을
 * 가를 수 없다. 축을 섞으려고 가짜 capability 를 넘기면 화면이 판정을 속이게 되므로, 판정은
 * 이쪽 어휘(`allowedGuestTabs`)로 하고 **모양만** 맞춘다. 클래스가 저쪽의 단일 링크 탭
 * (진척 보고·쿼터)과 같은 것이 그 약속이다.
 *
 * **허용 탭만 그린다** — 잠긴 탭을 흐리게 두지 않는다(서버 관문이 같은 판정을 주소 축에서 한
 * 번 더 한다). 설문 미리보기는 탭이 아니라 화면 머리의 「설문 보기」가 연다.
 *
 * 클라이언트 컴포넌트인 이유는 활성 탭 표시 하나뿐이다.
 */
export function GuestTabStrip({ basePath, tabs, meta }: Props) {
  const segment = useSelectedLayoutSegment();
  const links = allowedGuestTabs(tabs);

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6">
        <nav aria-label="현황 메뉴" className="flex gap-1 overflow-x-auto">
          {links.map((link) => {
            const active = segment === link.segment;
            return (
              <Link
                key={link.segment}
                href={guestConsoleHref(basePath, link.segment)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-auto shrink-0 items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors',
                  active
                    ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        {meta && <p className="shrink-0 py-3 text-xs text-slate-500">{meta}</p>}
      </div>
    </div>
  );
}
