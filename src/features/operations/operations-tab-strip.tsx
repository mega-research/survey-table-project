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
import type { SurveyCapability } from '@/shared/contracts/workspace';

import { mailCostPath, operationsPaths } from './operations-paths';

interface OperationsTabStripProps {
  /** 이 콘솔의 주소 접두 — 내부는 `/surveys/<id>/operations`, 외주 실사 링크는 자기 트리(ADR-0026). */
  basePath: string;
  /**
   * 이 주체가 이 설문에서 할 수 있는 일 — 탭 노출의 정본이다.
   *
   * 각 탭의 요구는 그 탭이 여는 leaf 페이지의 관문과 **같아야** 한다. 갈리면 「메뉴엔 있는데
   * 누르면 404」가 된다 — 예전 `isGuest` 불리언 아래에서 팀 공개 설문의 팀원이 실제로
   * 그랬다(응답 내역·조사 대상·메일 탭이 보이는데 전부 not_found).
   */
  capabilities: ReadonlySet<SurveyCapability>;
  /**
   * 내부 전용 자리를 그릴 것인가 — 문항 수요·비용 정산.
   *
   * 쿼터는 두 셸에 다 서되 **여는 화면이 다르다**: 내부는 플랜 편집 + 현황판, 링크 셸은
   * 읽기 전용 현황판 하나다(이름도 「쿼터 현황」으로 갈린다). 주소는 같은 조각(`/quota`)이고
   * 어느 화면인지는 각 트리의 page 가 정한다.
   *
   * capability 로 물을 수 없는 **다른 축**이다: 그 화면들은 설문 단위 권한이 아니라 내부 계정
   * 여부(`requireAdminPage`)가 지키고, 외주 링크 주체는 `operations.view` 를 갖고도 거기
   * 닿지 못한다. 「무엇을 할 수 있는가」와 「어느 셸에 있는가」를 갈라 두는 것이 불리언
   * 하나로 둘을 겸하던 자리의 교훈이다.
   */
  internalShell?: boolean;
  /** 조사표가 붙은 설문인가 — 문항 수요 탭은 이때만 낸다. */
  hasSurveyDocument?: boolean;
  /**
   * 보여 줄 쿼터가 있는 설문인가 — **링크 셸의 「쿼터 현황」 탭만** 이 값을 본다.
   *
   * 링크 셸의 쿼터는 읽기 전용 현황판이라 쿼터가 없는 설문에서는 빈 안내뿐이다. 그런 탭을
   * 세워 두지 않는다. 내부 셸은 이 값과 무관하게 언제나 그린다 — 거기가 쿼터를 **만드는**
   * 자리라 없을 때 감추면 만들 길이 사라진다. 기본값이 true 인 것도 그래서다(주지 않으면
   * 종전대로 선다).
   */
  hasQuota?: boolean;
}

/**
 * 현황 콘솔 상단 탭 스트립.
 *
 * - "실사 현황" trigger hover/click → `응답 현황` / `응답 내역` 드롭다운
 * - "진척 보고" 는 단일 페이지 링크 (`/operations/report`)
 * - "조사 대상" trigger hover/click → `조사 대상 목록` / `조사 대상 업로드` / `컬럼 설정` / `결과코드 설정` 드롭다운
 * - "메일" trigger → `템플릿` / `단체 발송` / `비용 정산` 드롭다운 (수신거부자는 단체 발송 페이지 하단 세그먼트)
 * - "쿼터" 는 단일 페이지 링크 (`/operations/quota`) — 링크 셸에서는 「쿼터 현황」(읽기 전용 현황판)이고
 *   쿼터가 없는 설문에서는 서지 않는다
 * - "문항 수요" 는 조사표가 붙은 설문에서만 나타난다 — 다른 설문에서는 쓸 일이 없는 탭이다
 * - shadcn NavigationMenu primitive 가 hover/click/키보드 표준을 처리하며
 *   Trigger 의 ChevronDown 이 내장돼 있어 caret 마크업은 별도로 그리지 않는다.
 */
export function OperationsTabStrip({
  basePath,
  capabilities,
  internalShell = true,
  hasSurveyDocument = false,
  hasQuota = true,
}: OperationsTabStripProps) {
  const pathname = usePathname() ?? '';
  const paths = operationsPaths(basePath);
  const can = (capability: SurveyCapability) => capabilities.has(capability);

  // 요구 capability 는 leaf 페이지의 관문에서 그대로 옮긴 것이다 — 진척 보고가
  // operations.view 가 아니라 contacts.view 인 것이 특히 헷갈리는 자리다.
  const canOverview = can('operations.view');
  const canProfiles = can('responses.view');
  const canContacts = can('contacts.view');
  const canManageContacts = can('contacts.manage');
  const canMail = can('mail.view');
  const overviewHref = paths.overview;
  const profilesHref = paths.profiles;
  const isOverviewActive = pathname.startsWith(overviewHref);
  const isProfilesActive = pathname.startsWith(profilesHref);
  const isFieldworkActive = isOverviewActive || isProfilesActive;

  const contactsHref = paths.contacts;
  const contactsUploadHref = paths.contactsUpload;
  const contactsColumnsHref = paths.contactsColumns;
  const contactsResultCodesHref = paths.contactsResultCodes;
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

  const mailCampaignsHref = paths.mailCampaigns;
  const mailTemplatesHref = paths.mailTemplates;
  // 비용 정산은 인스턴스 전체 단위라 글로벌 페이지로 라우팅.
  const mailCostHref = mailCostPath();
  const isMailCampaignsActive = pathname.startsWith(mailCampaignsHref);
  const isMailTemplatesActive = pathname.startsWith(mailTemplatesHref);
  const isMailActive = isMailCampaignsActive || isMailTemplatesActive;

  const reportHref = paths.report;
  const isReportActive = pathname.startsWith(reportHref);

  const quotaHref = paths.quota;
  const isQuotaActive = pathname.startsWith(quotaHref);

  const demandHref = paths.demand;
  const isDemandActive = pathname.startsWith(demandHref);

  return (
    <div className="border-b border-gray-200 bg-white">
      <NavigationMenu className="mx-auto max-w-7xl justify-start px-6">
        <NavigationMenuList
          aria-label="현황 콘솔 메뉴"
          className="justify-start gap-1"
        >
          {(canOverview || canProfiles) && (
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
              {canOverview && (
                <SubLink href={overviewHref} active={isOverviewActive}>
                  응답 현황
                </SubLink>
              )}
              {canProfiles && (
                <SubLink href={profilesHref} active={isProfilesActive}>
                  응답 내역
                </SubLink>
              )}
            </NavigationMenuContent>
          </NavigationMenuItem>
          )}

          {canContacts && (
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
          )}

          {(canContacts || canManageContacts) && (
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
              {canContacts && (
                <SubLink href={contactsHref} active={isContactsRootActive}>
                  조사 대상 목록
                </SubLink>
              )}
              {canManageContacts && (
                <>
                  <SubLink href={contactsUploadHref} active={isContactsUploadActive}>
                    조사 대상 업로드
                  </SubLink>
                  <SubLink href={contactsColumnsHref} active={isContactsColumnsActive}>
                    컬럼 설정
                  </SubLink>
                  <SubLink href={contactsResultCodesHref} active={isContactsResultCodesActive}>
                    결과코드 설정
                  </SubLink>
                </>
              )}
            </NavigationMenuContent>
          </NavigationMenuItem>
          )}

          {canMail && (
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
              {internalShell && (
                <SubLink href={mailCostHref} active={false}>
                  비용 정산
                </SubLink>
              )}
            </NavigationMenuContent>
          </NavigationMenuItem>
          )}

          {internalShell && canOverview && hasSurveyDocument && (
            <NavigationMenuItem>
              <Link
                href={demandHref}
                aria-current={isDemandActive ? 'page' : undefined}
                className={cn(
                  'flex h-auto items-center gap-1 rounded-none border-b-2 bg-transparent px-4 py-3 text-sm transition-colors',
                  isDemandActive
                    ? 'border-blue-600 font-semibold text-blue-600 hover:text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900',
                )}
              >
                문항 수요
              </Link>
            </NavigationMenuItem>
          )}

          {canOverview && (internalShell || hasQuota) && (
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
                {internalShell ? '쿼터' : '쿼터 현황'}
              </Link>
            </NavigationMenuItem>
          )}
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

