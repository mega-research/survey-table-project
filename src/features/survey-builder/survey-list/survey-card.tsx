'use client';

import { useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ChartColumn,
  Clock,
  CopyPlus,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Globe,
  Link as LinkIcon,
  Loader2,
  Lock,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatLocalDate } from '@/lib/date-formatters';
import { getSurveyAccessUrl } from '@/lib/survey-url';
import { cn } from '@/lib/utils';
import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';
import { SURVEY_VISIBILITY_LABEL, type WorkScope } from '@/shared/contracts/workspace';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { ShareSettingsModal } from '../sharing/share-settings-modal';
import { GroupMoveSubmenu } from './groups/group-move-submenu';
import {
  type SurveyCardViewer,
  canEditSurveyCard,
  canManageSurveyAccessCard,
  canViewSurveyAnalyticsCard,
} from './survey-list-capability';

interface SurveyCardProps {
  survey: SurveyListItem;
  /** 지금 목록을 보고 있는 사람 — 버튼 노출 근사 셋이 함께 본다. */
  viewer: SurveyCardViewer;
  onDelete: (surveyId: string) => void;
  onDuplicate: (surveyId: string) => void;
  isDuplicating: boolean;
  /** 팀 범위에서만 채워진다 — 시스템 전체 보기·미배치에는 그룹 개념이 없다. */
  groups: readonly SurveyGroupListItem[];
  /** null 이면 케밥에서 「그룹 이동」 항목 자체를 그리지 않는다(핸들러 없는 자리는 안 만든다). */
  onMoveToGroup: ((surveyId: string, groupId: string | null) => void) | null;
}

/** 수정일 텍스트 접미사 — 내 설문이 아니면 작성자를, 남의 팀 설문이면 소유 팀을 잇는다. */
function modifiedDateSuffix(
  survey: SurveyListItem,
  scope: WorkScope,
  currentUserId: string | null,
): string {
  if (scope.kind !== 'team') return '';
  if (currentUserId !== null && survey.ownerUserId === currentUserId) return '';
  if (survey.teamId === scope.teamId) {
    return survey.ownerName ? ` · 작성자 ${survey.ownerName}` : '';
  }
  return survey.teamName ? ` · ${survey.teamName} 소유` : '';
}

/** 응답수 줄 — 시스템 전체 보기에서는 소유 팀/배치 대기를 앞세운다(.pen 6-2). */
function responseLine(survey: SurveyListItem, scope: WorkScope): string {
  const base = `전체 응답 ${survey.responseCount.toLocaleString('ko-KR')}건 · 완료 ${survey.completedResponseCount.toLocaleString('ko-KR')}건`;
  if (scope.kind !== 'system') return base;
  if (survey.assignmentStatus === 'assignment_pending') {
    return `배치 대기 · 전체 응답 ${survey.responseCount.toLocaleString('ko-KR')}건`;
  }
  return `${survey.teamName ?? '—'} · 전체 응답 ${survey.responseCount.toLocaleString('ko-KR')}건`;
}

/**
 * 설문 카드 (.pen FLOW 6 설문 카드 컴포넌트).
 *
 * 케밥 순서는 .pen 4-1 노트를 따른다 — 공유 설정 · 링크 복사 · 그룹 이동 · 삭제.
 * 「그룹 이동」은 콜백 게이트라 팀 범위가 아니면(시스템 전체 보기·미배치) onMoveToGroup 이
 * null 로 와서 항목 자체가 사라진다(핸들러 없는 자리는 안 만든다).
 * 문의 액션은 Plan 3 게이트로 미노출.
 * 수정·삭제·분석의 비활성은 근사(canEditSurveyCard·canViewSurveyAnalyticsCard)일 뿐이고
 * 강제는 서버 관문이 한다.
 */
export function SurveyCard({
  survey,
  viewer,
  onDelete,
  onDuplicate,
  isDuplicating,
  groups,
  onMoveToGroup,
}: SurveyCardProps) {
  const { scope, currentUserId } = viewer;
  const canEdit = canEditSurveyCard(survey, viewer);
  // 분석 화면은 responses.view 까지 요구한다 — 팀원은 못 들어가므로 버튼도 잠근다.
  const canViewAnalytics = canViewSurveyAnalyticsCard(survey, viewer);
  // 공개 범위 변경은 survey.manageAccess — 팀원은 편집은 되지만 여기는 잠긴다.
  const canManageAccess = canManageSurveyAccessCard(survey, viewer);
  const [sharingOpen, setSharingOpen] = useState(false);
  const isPending = survey.assignmentStatus === 'assignment_pending';
  const surveyUrl = getSurveyAccessUrl(
    {
      id: survey.id,
      slug: survey.slug,
      privateToken: survey.privateToken,
      settings: { isPublic: survey.isPublic },
    },
    '',
  );

  return (
    <div className="flex w-full flex-col gap-[9px] rounded-[14px] border border-[#E5E5EA] bg-white p-[18px]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#E0E7FF]">
            <FileText className="h-[21px] w-[21px] text-[#2743AE]" />
          </span>
          <h3 className="min-w-0 truncate text-[14.5px] font-semibold text-[#1C1C1E]">
            {survey.title}
          </h3>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="더보기"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9CA3AF] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]"
            >
              <EllipsisVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild disabled={!canEdit}>
              <Link href={`/admin/surveys/${survey.id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                수정
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSharingOpen(true)}>
              <Share2 className="h-3.5 w-3.5" />
              공유 설정
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                navigator.clipboard.writeText(`${window.location.origin}${surveyUrl}`);
                toast.success('링크가 복사되었습니다');
              }}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              링크 복사
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={surveyUrl} target="_blank">
                <ExternalLink className="h-3.5 w-3.5" />
                설문 열기
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isDuplicating} onSelect={() => onDuplicate(survey.id)}>
              {isDuplicating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CopyPlus className="h-3.5 w-3.5" />
              )}
              복제
            </DropdownMenuItem>
            {onMoveToGroup && (
              <GroupMoveSubmenu
                groups={groups}
                currentGroupId={survey.surveyGroupId}
                disabled={!canEdit}
                onMove={(groupId) => onMoveToGroup(survey.id, groupId)}
              />
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canEdit}
              className="text-red-600 focus:text-red-600"
              onSelect={() => onDelete(survey.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="truncate text-[12.5px] text-[#6E6E73]">{responseLine(survey, scope)}</p>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-[#9CA3AF]">
          수정일: {formatLocalDate(survey.updatedAt)}
          {modifiedDateSuffix(survey, scope, currentUserId)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {survey.isPublic ? (
            <span className="flex items-center gap-1 rounded-full bg-[#E8F6EE] px-2 py-0.5 text-[11px] font-medium text-[#1D8A4E]">
              <Globe className="h-3 w-3" />
              공개
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#D97706]">
              <Lock className="h-3 w-3" />
              비공개
            </span>
          )}
          {isPending ? (
            <span className="flex items-center gap-1 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#D97706]">
              <Clock className="h-3 w-3" />
              배치 대기
            </span>
          ) : survey.visibility === 'invite_only' ? (
            <span className="flex items-center gap-1 rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-medium text-[#6E6E73]">
              <Lock className="h-3 w-3" />
              {SURVEY_VISIBILITY_LABEL.invite_only}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex gap-1.5 border-t border-[#F0F0F2] pt-3">
        <CardActionLink
          href={`/admin/surveys/${survey.id}/edit`}
          icon={<Pencil className="h-3 w-3" />}
          label="수정"
          disabled={!canEdit}
        />
        <CardActionLink
          href={`/admin/surveys/${survey.id}/operations/overview`}
          icon={<Activity className="h-3 w-3" />}
          label="현황"
        />
        <CardActionLink
          href={`/admin/surveys/${survey.id}/analytics`}
          icon={<ChartColumn className="h-3 w-3" />}
          label="분석"
          disabled={!canViewAnalytics}
        />
      </div>

      {sharingOpen && (
        <ShareSettingsModal
          surveyId={survey.id}
          surveyTitle={survey.title}
          visibility={survey.visibility}
          canManageAccess={canManageAccess}
          currentOwnerName={survey.ownerName}
          onClose={() => setSharingOpen(false)}
        />
      )}
    </div>
  );
}

function CardActionLink({
  href,
  icon,
  label,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="flex h-8 flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-[9px] border border-[#E5E5EA] text-[12px] text-[#C7C7CC]"
        aria-disabled
      >
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        'flex h-8 flex-1 items-center justify-center gap-1 rounded-[9px] border border-[#E5E5EA] text-[12px] text-[#374151] transition-colors',
        'hover:bg-[#F5F5F7]',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
