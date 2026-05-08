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
 * 현황 콘솔 상단 탭 스트립.
 *
 * - "Field work" trigger hover/click → `응답 현황` / `응답자 목록` 드롭다운
 * - "보고서" 는 단일 페이지 링크 (`/operations/report`)
 * - "컨택" trigger hover/click → `컨택리스트` / `리스트 업로드` / `컬럼 설정` / `결과코드 설정` 드롭다운
 * - shadcn NavigationMenu primitive 가 hover/click/키보드 표준을 처리하며
 *   Trigger 의 ChevronDown 이 내장돼 있어 caret 마크업은 별도로 그리지 않는다.
 */
export function OperationsTabStrip({ surveyId }: OperationsTabStripProps) {
  const pathname = usePathname() ?? '';
  const operationsBase = `/admin/surveys/${surveyId}/operations`;
  const overviewHref = `${operationsBase}/overview`;
  const profilesHref = `${operationsBase}/profiles`;
  const isOverviewActive = pathname.startsWith(overviewHref);
  const isProfilesActive = pathname.startsWith(profilesHref);
  const isFieldworkActive = isOverviewActive || isProfilesActive;

  const contactsHref = `${operationsBase}/contacts`;
  const contactsUploadHref = `${operationsBase}/contacts/upload`;
  const contactsColumnsHref = `${operationsBase}/contacts/columns`;
  const contactsResultCodesHref = `${operationsBase}/contacts/result-codes`;
  const contactsMailTemplatesHref = `${operationsBase}/mail-templates`;
  const isContactsMailTemplatesActive = pathname.startsWith(contactsMailTemplatesHref);
  const isContactsRootActive =
    pathname === contactsHref ||
    (pathname.startsWith(`${contactsHref}/`) &&
     !pathname.startsWith(contactsUploadHref) &&
     !pathname.startsWith(contactsColumnsHref) &&
     !pathname.startsWith(contactsResultCodesHref));
  const isContactsUploadActive = pathname.startsWith(contactsUploadHref);
  const isContactsColumnsActive = pathname.startsWith(contactsColumnsHref);
  const isContactsResultCodesActive = pathname.startsWith(contactsResultCodesHref);
  const isContactsActive =
    isContactsRootActive ||
    isContactsUploadActive ||
    isContactsColumnsActive ||
    isContactsResultCodesActive ||
    isContactsMailTemplatesActive;

  const reportHref = `${operationsBase}/report`;
  const isReportActive = pathname.startsWith(reportHref);

  return (
    <div className="border-b border-gray-200 bg-white">
      <NavigationMenu className="mx-auto max-w-7xl justify-start px-6">
        <NavigationMenuList
          aria-label="현황 콘솔 메뉴"
          className="justify-start gap-1"
        >
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

          <NavigationMenuItem>
            <Link
              href={reportHref}
              aria-current={isReportActive ? 'page' : undefined}
              className={cn(
                'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors',
                isReportActive
                  ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              보고서
            </Link>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuTrigger
              className={cn(
                'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors hover:bg-transparent data-[state=open]:bg-transparent',
                isContactsActive
                  ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              컨택
            </NavigationMenuTrigger>
            <NavigationMenuContent className="min-w-[180px] p-1">
              <SubLink href={contactsHref} active={isContactsRootActive}>
                컨택리스트
              </SubLink>
              <SubLink href={contactsUploadHref} active={isContactsUploadActive}>
                리스트 업로드
              </SubLink>
              <SubLink href={contactsColumnsHref} active={isContactsColumnsActive}>
                컬럼 설정
              </SubLink>
              <SubLink href={contactsResultCodesHref} active={isContactsResultCodesActive}>
                결과코드 설정
              </SubLink>
              <SubLink href={contactsMailTemplatesHref} active={isContactsMailTemplatesActive}>
                메일 템플릿
              </SubLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
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

