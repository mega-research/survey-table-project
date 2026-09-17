'use client';

import Link from 'next/link';

import { LogoutButton } from './logout-button';

interface Props {
  name: string;
  /** 소속 표시 — 게스트는 기관, 실사는 업체. 없으면 이름만 보여준다. */
  affiliation?: string | null;
  /** 유형 배지 문구 (게스트·실사). */
  badge: string;
  /** 아바타 이미지 URL. 없으면 이름 첫 글자. */
  image?: string | null;
}

/**
 * 게스트·실사 홈 헤더바의 사용자 메뉴 (.pen FLOW 5-2·10-1).
 *
 * 두 콘솔이 서로를 import 하지 않는 독립 묶음이라(PRD 의존 방향) 공용 구역에 둔다.
 * 내부 계정은 사이드바 하단 프로필 메뉴로 같은 자리를 대신하며 그것은 티켓 08 소관이다.
 *
 * 프로필은 세 유형 공통 화면이라 /admin/profile 로 간다 — `/admin` 아래지만 내부 전용이
 * 아니다(ACCOUNT_PAGES).
 */
export function AccountMenu({ name, affiliation, badge, image }: Props) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full bg-[#E0E7FF] text-[11.5px] font-semibold text-[#2743AE]"
      >
        {image ? (
          // R2 공개 URL 이라 next/image 최적화 대상이 아니다(원격 도메인 설정 불필요).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          name.slice(0, 1)
        )}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[13px] font-semibold text-[#1C1C1E]">
          {affiliation ? `${name} · ${affiliation}` : name}
        </span>
        <span className="text-[11px] text-[#9CA3AF]">{badge}</span>
      </span>
      <Link
        href="/admin/profile"
        className="ml-2 text-[12.5px] text-[#6E6E73] underline-offset-2 hover:text-[#1C1C1E] hover:underline"
      >
        프로필 수정
      </Link>
      <LogoutButton />
    </div>
  );
}
