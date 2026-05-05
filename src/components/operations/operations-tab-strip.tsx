'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu';
import { cn } from '@/lib/utils';

interface OperationsTabStripProps {
  surveyId: string;
}

/**
 * 현황 콘솔 상단 탭 스트립 (슬라이스 2 — Field work 드롭다운 추가).
 *
 * - "Field work ▼" hover/click → `응답 현황` / `응답자 목록` 드롭다운
 * - "보고서" / "컨택 ▼" 는 시각만 비활성 (`aria-disabled`)
 * - 활성 메뉴 항목은 `aria-current="page"`
 *
 * shadcn NavigationMenu primitive 가 데스크톱 hover + 모바일 click +
 * 키보드(Tab/Enter/Esc/화살표) 표준을 처리한다. Trigger 의 ChevronDown 은
 * primitive 에 내장되어 있어 caret 마크업은 불필요.
 */
export function OperationsTabStrip({ surveyId }: OperationsTabStripProps) {
  const pathname = usePathname() ?? '';
  const operationsBase = `/admin/surveys/${surveyId}/operations`;
  const isOperations = pathname.startsWith(operationsBase);

  if (!isOperations) {
    return null;
  }

  const overviewHref = `${operationsBase}/overview`;
  const profilesHref = `${operationsBase}/profiles`;
  const isOverviewActive = pathname.startsWith(overviewHref);
  const isProfilesActive = pathname.startsWith(profilesHref);
  const isFieldworkActive = isOverviewActive || isProfilesActive;

  return (
    <div className="border-b border-gray-200 bg-white">
      <NavigationMenu className="mx-auto max-w-7xl px-6">
        <NavigationMenuList aria-label="현황 콘솔 메뉴" className="gap-1">
          <NavigationMenuItem>
            <NavigationMenuTrigger
              className={cn(
                'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors hover:bg-transparent data-[state=open]:bg-transparent',
                isFieldworkActive
                  ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              Field work
            </NavigationMenuTrigger>
            <NavigationMenuContent className="min-w-[180px] p-1">
              <SubLink href={overviewHref} active={isOverviewActive}>
                응답 현황
              </SubLink>
              <SubLink href={profilesHref} active={isProfilesActive}>
                응답자 목록
              </SubLink>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <TabDisabled>보고서</TabDisabled>
          <TabDisabled withCaret>컨택</TabDisabled>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  );
}

interface SubLinkProps {
  href: string;
  active: boolean;
  children: React.ReactNode;
}

function SubLink({ href, active, children }: SubLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block rounded px-3 py-2 text-sm',
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-50',
      )}
    >
      {children}
    </Link>
  );
}

interface TabDisabledProps {
  children: React.ReactNode;
  withCaret?: boolean;
}

function TabDisabled({ children, withCaret }: TabDisabledProps) {
  return (
    <span
      aria-disabled="true"
      className="flex cursor-not-allowed items-center gap-1 border-b-2 border-transparent px-4 py-3 text-sm text-slate-400"
    >
      {children}
      {withCaret && <span aria-hidden="true">▼</span>}
    </span>
  );
}
