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
 * - "실사 현황" trigger hover/click → `응답 현황` / `응답 내역` 드롭다운
 * - "진척 보고" 는 단일 페이지 링크 (`/operations/report`)
 * - "조사 대상" trigger hover/click → `조사 대상 목록` / `조사 대상 업로드` / `컬럼 설정` / `결과코드 설정` 드롭다운
 * - "메일" trigger → `템플릿` / `단체 발송` / `비용 정산` 드롭다운 (수신거부자는 단체 발송 페이지 하단 세그먼트)
 * - "쿼터" 는 단일 페이지 링크 (`/operations/quota`)
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
    isContactsResultCodesActive;

  const mailBase = `${operationsBase}/mail`;
  const mailCampaignsHref = `${mailBase}/campaigns`;
  const mailTemplatesHref = `${mailBase}/templates`;
  // 비용 정산은 인스턴스 전체 단위라 글로벌 페이지로 라우팅.
  const mailCostHref = '/admin/billing/mail-cost';
  const isMailCampaignsActive = pathname.startsWith(mailCampaignsHref);
  const isMailTemplatesActive = pathname.startsWith(mailTemplatesHref);
  const isMailActive = isMailCampaignsActive || isMailTemplatesActive;

  const reportHref = `${operationsBase}/report`;
  const isReportActive = pathname.startsWith(reportHref);

  const quotaHref = `${operationsBase}/quota`;
  const isQuotaActive = pathname.startsWith(quotaHref);

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
              실사 현황
            </NavigationMenuTrigger>
            <NavigationMenuContent className="min-w-[180px] p-1">
              <SubLink href={overviewHref} active={isOverviewActive}>
                응답 현황
              </SubLink>
              <SubLink href={profilesHref} active={isProfilesActive}>
                응답 내역
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
              진척 보고
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
              조사 대상
            </NavigationMenuTrigger>
            <NavigationMenuContent className="min-w-[180px] p-1">
              <SubLink href={contactsHref} active={isContactsRootActive}>
                조사 대상 목록
              </SubLink>
              <SubLink href={contactsUploadHref} active={isContactsUploadActive}>
                조사 대상 업로드
              </SubLink>
              <SubLink href={contactsColumnsHref} active={isContactsColumnsActive}>
                컬럼 설정
              </SubLink>
              <SubLink href={contactsResultCodesHref} active={isContactsResultCodesActive}>
                결과코드 설정
              </SubLink>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuTrigger
              className={cn(
                'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors hover:bg-transparent data-[state=open]:bg-transparent',
                isMailActive
                  ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              메일
            </NavigationMenuTrigger>
            <NavigationMenuContent className="min-w-[180px] p-1">
              <SubLink href={mailTemplatesHref} active={isMailTemplatesActive}>
                템플릿
              </SubLink>
              <SubLink href={mailCampaignsHref} active={isMailCampaignsActive}>
                단체 발송
              </SubLink>
              <SubLink href={mailCostHref} active={false}>
                비용 정산
              </SubLink>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <Link
              href={quotaHref}
              aria-current={isQuotaActive ? 'page' : undefined}
              className={cn(
                'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors',
                isQuotaActive
                  ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              쿼터
            </Link>
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

