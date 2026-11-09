'use client';

import { useRef, useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ChartColumn,
  CircleStop,
  Clock,
  CopyPlus,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Globe,
  Link as LinkIcon,
  Loader2,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  Share2,
  Star,
  Tag,
  TextCursorInput,
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
import { Popover, PopoverContent } from '@/components/ui/popover';
import { formatLocalDate } from '@/lib/date-formatters';
import { getSurveyAccessUrl } from '@/lib/survey-url';
import { cn } from '@/lib/utils';
import { type SurveyListItem, surveyCardTitle } from '@/shared/contracts/survey-builder-io';
import { SURVEY_VISIBILITY_LABEL, type WorkScope } from '@/shared/contracts/workspace';
import type { PersonalTagItem, SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { ShareSettingsModal } from '../sharing/share-settings-modal';
import { CardTitleDialog } from './card-title-dialog';
import { GroupMoveSubmenu } from './groups/group-move-submenu';
import { ACTIVE_TAG_LABEL_CLASS, PersonalTagLabel } from './personal-tag-label';
import { resolveCardTags } from './personal-tags';
import {
  type SurveyCardViewer,
  canDeleteSurveyCard,
  canEditSurveyCard,
  canManageSurveyAccessCard,
  canManageSurveyGroupCard,
} from './survey-list-capability';
import { TagPickerPanel } from './tag-picker';

/**
 * 카드의 내 태그 — 나에게만 보이는 개인 표시(티켓 07). 낙관적 갱신·연타 처리는 목록 화면의
 * `useSetTagLink`·`useCreatePersonalTag` 가 진다.
 */
export interface CardTagging {
  /** 이 설문에 붙인 내 태그 id — 붙인 순서(목록 페이지 항목의 `myTagIds`). */
  myTagIds: readonly string[];
  /** 내 태그 전부 — 이름·색은 여기서 찾는다. */
  tags: readonly PersonalTagItem[];
  onToggle: (tagId: string, on: boolean) => void;
  onCreate: (name: string) => Promise<PersonalTagItem | null>;
  /** 걸린 검색 칩(티켓 09) — 같은 태그는 연한 파랑으로 맨 앞에 선다. */
  activeTagIds: readonly string[];
  /** 걸리지 않은 카드 태그를 눌렀다 — 그 태그를 검색 칩으로 더한다. */
  onFilterByTag: (tagId: string) => void;
}

interface SurveyCardProps {
  survey: SurveyListItem;
  /** 내가 별을 켰는가 — 나에게만 보이는 개인 표시(티켓 06). */
  isFavorite: boolean;
  /** 바라는 상태를 올린다. 낙관적 갱신·연타 처리는 목록 화면의 `useSetFavorite` 가 진다. */
  onFavoriteChange: (on: boolean) => void;
  tagging: CardTagging;
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

/** 수정일 텍스트 접미사 — 내 설문이 아니면 소유자를, 남의 팀 설문이면 소유 팀을 잇는다. */
function modifiedDateSuffix(
  survey: SurveyListItem,
  scope: WorkScope,
  currentUserId: string | null,
): string {
  if (scope.kind !== 'team') return '';
  if (currentUserId !== null && survey.ownerUserId === currentUserId) return '';
  if (survey.teamId === scope.teamId) {
    return survey.ownerName ? ` · 소유자 ${survey.ownerName}` : '';
  }
  return survey.teamName ? ` · ${survey.teamName} 소유` : '';
}

/**
 * 응답수 줄 — 시스템 전체 보기에서는 소유 팀/배치 대기를 앞세운다(.pen 6-2).
 *
 * 전체 응답 수는 싣지 않는다 — 그 숫자를 보고 비어 있는 설문으로 오해하는 일이 잦아 온라인 응답
 * 완료와 실사 완료 처리 두 숫자만 보인다.
 */
function responseLine(survey: SurveyListItem, scope: WorkScope): string {
  const base = `온라인 응답 완료 ${survey.completedResponseCount.toLocaleString('ko-KR')}건 · 실사 완료 처리 ${survey.fieldworkCompletedCount.toLocaleString('ko-KR')}건`;
  if (scope.kind !== 'system') return base;
  if (survey.assignmentStatus === 'assignment_pending') return `배치 대기 · ${base}`;
  return `${survey.teamName ?? '—'} · ${base}`;
}

/**
 * 설문 카드 (.pen FLOW 6 설문 카드 컴포넌트).
 *
 * 케밥 순서는 .pen 4-1 노트를 따른다 — 초대 · 링크 복사 · 그룹 이동 · 삭제.
 * 「초대」의 화면 용어만 그것이고 코드·도메인 어휘는 그대로 sharing 이다 — 모달 네 블록 중
 * 셋이 사람을 들이는 일이라 「공유 설정」이 실제 내용보다 좁게 읽혔다. 아이콘을 편지로 두지
 * 않는 것이 이 라벨의 계약이다: 이 초대는 **메일을 보내지 않는다**(계정에 자격을 부여할 뿐).
 * 「그룹 이동」은 콜백 게이트라 팀 범위가 아니면(시스템 전체 보기·미배치) onMoveToGroup 이
 * null 로 와서 항목 자체가 사라진다(핸들러 없는 자리는 안 만든다).
 * 문의 버튼은 자리만 잡아 둔다 — 문의 기능이 아직 없어 언제나 비활성이다.
 * 분석·문의는 당분간 언제나 비활성이다. 수정·삭제·그룹 이동의 비활성은 근사(canEditSurveyCard·
 * canDeleteSurveyCard·canManageSurveyGroupCard — 서버 열이 셋 다 달라 근사도 셋이다)일 뿐이고
 * 강제는 서버 관문이 한다.
 */
export function SurveyCard({
  survey,
  isFavorite,
  onFavoriteChange,
  tagging,
  viewer,
  onDelete,
  onDuplicate,
  isDuplicating,
  groups,
  onMoveToGroup,
}: SurveyCardProps) {
  const { scope, currentUserId } = viewer;
  const canEdit = canEditSurveyCard(survey, viewer);
  // 삭제·그룹 이동은 편집과 열이 다르다 — 한 값으로 묶으면 눌렀을 때 거부되는 버튼이 열린다.
  const canDelete = canDeleteSurveyCard(survey, viewer);
  const canMoveGroup = canManageSurveyGroupCard(survey, viewer);
  // 공개 범위 변경은 survey.manageAccess — 팀원은 편집은 되지만 여기는 잠긴다.
  const canManageAccess = canManageSurveyAccessCard(survey, viewer);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [cardTitleOpen, setCardTitleOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  // 케밥 「태그」로 열 때 — 메뉴가 닫히며 포커스를 케밥으로 돌려놓으면 막 열린 태그 창이 바깥
  // 포커스로 보고 닫힌다. 메뉴가 닫힌 뒤에 연다.
  const openTagsAfterMenu = useRef(false);
  const tagsAnchorRef = useRef<HTMLDivElement>(null);
  const cardTags = resolveCardTags(tagging.myTagIds, tagging.tags, tagging.activeTagIds);
  const activeTagIds = new Set(tagging.activeTagIds);
  const displayTitle = surveyCardTitle(survey);
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
    <div className="group/card flex w-full flex-col gap-[11px] rounded-[14px] border border-[#E5E5EA] bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#E0E7FF]">
            <FileText className="h-[21px] w-[21px] text-[#2743AE]" />
          </span>
          {/* 목업은 긴 제목을 두 줄로 보여준다 — 한 줄 말줄임이면 비슷한 제목끼리 구별이 안 된다. */}
          {/* 카드 제목(0140)을 보이고, 응답자가 보는 설문지 제목이 다르면 툴팁으로 남긴다. */}
          <h3
            title={displayTitle !== survey.title ? `설문지 제목: ${survey.title}` : undefined}
            className="line-clamp-2 min-w-0 text-[16px] leading-[1.35] font-semibold break-keep text-[#1C1C1E]"
          >
            {displayTitle}
          </h3>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* 별은 늘 보인다 — 편집 권한과 무관하게 볼 수 있는 설문이면 켤 수 있다(관문 survey.view). */}
          <button
            type="button"
            aria-pressed={isFavorite}
            aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            onClick={() => onFavoriteChange(!isFavorite)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md hover:bg-[#F5F5F7] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
              isFavorite ? 'text-[#F5A524]' : 'text-[#9CA3AF] hover:text-[#1C1C1E]',
            )}
          >
            <Star className={cn('h-4 w-4', isFavorite && 'fill-current')} />
          </button>
          <DropdownMenu
            onOpenChangeComplete={(open) => {
              // 메뉴가 다 닫힌 뒤에 태그 창을 연다 — 닫히는 중에 열면 메뉴의 닫힘 처리가 창을 바깥 누름으로 닫는다.
              if (open || !openTagsAfterMenu.current) return;
              openTagsAfterMenu.current = false;
              setTagsOpen(true);
            }}
          >
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="더보기"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9CA3AF] hover:bg-[#F5F5F7] hover:text-[#1C1C1E]"
                />
              }
            >
              <EllipsisVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // 태그 창으로 넘어갈 때는 포커스를 케밥 단추로 돌려보내지 않는다(창의 검색 칸이 가져간다).
              finalFocus={() => !openTagsAfterMenu.current}
            >
              <DropdownMenuItem
                disabled={!canEdit}
                render={<Link href={`/surveys/${survey.id}/edit`} />}
              >
                <Pencil className="h-3.5 w-3.5" />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} onClick={() => setCardTitleOpen(true)}>
                <TextCursorInput className="h-3.5 w-3.5" />
                카드 제목 변경
              </DropdownMenuItem>
              {/* 내 태그 — 볼 수 있으면 붙일 수 있다(관문 survey.view). 카드 태그 줄과 같은 창을 연다. */}
              <DropdownMenuItem onClick={() => (openTagsAfterMenu.current = true)}>
                <Tag className="h-3.5 w-3.5" />
                태그
              </DropdownMenuItem>
              {/* 공유 설정 모달을 연다 — 공개 범위·참여자·클라이언트·실사를 함께 다루므로 「초대」가 아니라 「공유」다. */}
              <DropdownMenuItem onClick={() => setSharingOpen(true)}>
                <Share2 className="h-3.5 w-3.5" />
                공유
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}${surveyUrl}`);
                  toast.success('링크가 복사되었습니다');
                }}
              >
                <LinkIcon className="h-3.5 w-3.5" />
                링크 복사
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href={surveyUrl} target="_blank" />}>
                <ExternalLink className="h-3.5 w-3.5" />
                설문 열기
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isDuplicating} onClick={() => onDuplicate(survey.id)}>
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
                  disabled={!canMoveGroup}
                  onMove={(groupId) => onMoveToGroup(survey.id, groupId)}
                />
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canDelete}
                className="text-red-600 data-[highlighted]:text-red-600"
                onClick={() => onDelete(survey.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 태그 창은 응답 수 줄 + 태그 줄 묶음 아래에 붙는다(시안 F6 ①). 태그 줄이 없을 때(태그 0개)도
          같은 자리에서 열리게 묶음 전체를 기준점으로 둔다. */}
      <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
        <div ref={tagsAnchorRef} className="flex flex-col gap-2">
          <p className="min-w-0 truncate text-[14px] text-[#6E6E73]">
            {responseLine(survey, scope)}
          </p>
          {/* 카드 태그 줄 — 최대 2개 + 「+N」, 회색 바탕 + 색 점. 걸린 검색 칩과 같은 태그는 연한 파랑으로
                맨 앞에 서고(티켓 09), 다른 태그를 누르면 그 태그가 검색 칩으로 더해진다. 「+N」과 줄의 빈 자리는
                태그 창을 연다 — 키보드로는 「태그 편집」 단추(「+N」 자리, 없으면 마우스를 올리면 보이는 연필). */}
          {cardTags.shown.length === 0 ? (
            // 태그가 없어도 태그 줄 높이는 늘 둔다 — 같은 줄의 다른 카드에 태그가 있을 때 이 카드만 가운데가
            // 비어 보이지 않게, 모든 카드가 같은 뼈대를 갖는다. 「+ 태그」는 마우스를 올리거나 포커스가 오면 보인다.
            <div className="flex h-7 items-center">
              <button
                type="button"
                aria-label="태그 추가"
                onClick={() => setTagsOpen(true)}
                className={cn(
                  '-ml-1 flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[12.5px] text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1C1C1E] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
                  tagsOpen ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
                )}
              >
                <Plus className="h-3 w-3" />
                태그
              </button>
            </div>
          ) : (
            <div
              role="group"
              aria-label="내 태그"
              onClick={(event) => {
                if (event.target === event.currentTarget) setTagsOpen(true);
              }}
              className={cn(
                '-mx-1 flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 hover:bg-[#F5F5F7]',
                tagsOpen && 'ring-2 ring-[#2E4FCE]/40',
              )}
            >
              {cardTags.shown.map((t) =>
                activeTagIds.has(t.id) ? (
                  <PersonalTagLabel
                    key={t.id}
                    tag={t}
                    className={cn('min-w-0 cursor-default', ACTIVE_TAG_LABEL_CLASS)}
                  />
                ) : (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`${t.name} 태그로 거르기`}
                    title={`「${t.name}」 태그로 거르기`}
                    onClick={() => tagging.onFilterByTag(t.id)}
                    className="flex min-w-0 rounded-md focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none"
                  >
                    <PersonalTagLabel
                      tag={t}
                      className="min-w-0 hover:bg-[#E5E5EA] hover:text-[#1C1C1E]"
                    />
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="태그 편집"
                aria-expanded={tagsOpen}
                onClick={() => setTagsOpen(true)}
                className={cn(
                  'flex h-6 shrink-0 items-center rounded-md px-1.5 text-[12.5px] leading-5 text-[#6E6E73] hover:bg-[#E5E5EA] hover:text-[#1C1C1E] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
                  cardTags.hiddenCount > 0
                    ? 'bg-[#F2F2F7]'
                    : tagsOpen
                      ? 'opacity-100'
                      : 'opacity-0 group-hover/card:opacity-100',
                )}
              >
                {cardTags.hiddenCount > 0 ? (
                  `+${cardTags.hiddenCount}`
                ) : (
                  <Pencil aria-hidden className="h-3 w-3" />
                )}
              </button>
            </div>
          )}
        </div>
        <PopoverContent
          anchor={tagsAnchorRef}
          align="start"
          className="w-[300px] overflow-hidden p-0"
          // 첫 포커스는 칩의 × 가 아니라 검색 칸이다(칸이 autoFocus).
          initialFocus={false}
        >
          <TagPickerPanel
            attachedIds={tagging.myTagIds}
            tags={tagging.tags}
            onToggle={tagging.onToggle}
            onCreate={tagging.onCreate}
          />
        </PopoverContent>
      </Popover>

      {/* 수정일·배지·액션 줄은 카드 바닥에 붙는다 — 그리드가 같은 줄 카드 높이를 맞추므로, 제목이 한 줄인
          카드도 두 줄인 이웃과 이 묶음의 위치가 같다(태그 줄은 늘 자리를 차지해 차이를 만들지 않는다). */}
      <div className="mt-auto flex flex-col gap-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] text-[#9CA3AF]">
            수정일: {formatLocalDate(survey.updatedAt)}
            {modifiedDateSuffix(survey, scope, currentUserId)}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* 종료 배지(ADR-0030) — 진행중·작성중에는 달지 않는다. 대부분의 카드가 같은 배지를
              달면 아무것도 말하지 않게 되고, 눈에 띄어야 하는 것은 「더는 응답을 받지 않는다」
              하나다. 공개/비공개보다 앞에 두는 것도 그래서다. */}
            {survey.status === 'closed' && (
              <span className="flex items-center gap-[5px] rounded-full bg-[#F1F5F9] px-[11px] py-1 text-[13px] font-medium text-[#475569]">
                <CircleStop className="h-3 w-3" />
                종료
              </span>
            )}
            {survey.isPublic ? (
              <span className="flex items-center gap-[5px] rounded-full bg-[#E8F6EE] px-[11px] py-1 text-[13px] font-medium text-[#1D8A4E]">
                <Globe className="h-3 w-3" />
                공개
              </span>
            ) : (
              <span className="flex items-center gap-[5px] rounded-full bg-[#FEF3C7] px-[11px] py-1 text-[13px] font-medium text-[#D97706]">
                <Lock className="h-3 w-3" />
                비공개
              </span>
            )}
            {isPending ? (
              <span className="flex items-center gap-[5px] rounded-full bg-[#FEF3C7] px-[11px] py-1 text-[13px] font-medium text-[#D97706]">
                <Clock className="h-3 w-3" />
                배치 대기
              </span>
            ) : survey.visibility === 'invite_only' ? (
              <span className="flex items-center gap-[5px] rounded-full bg-[#F5F5F7] px-[11px] py-1 text-[13px] font-medium text-[#6E6E73]">
                <Lock className="h-3 w-3" />
                {SURVEY_VISIBILITY_LABEL.invite_only}
              </span>
            ) : null}
          </div>
        </div>

        {/* 액션 순서 — 수정 · 현황 · 분석 · 문의(.pen 설문 카드의 문의·분석 순서를 바꿨다). 구분선은 없다. */}
        <div className="flex gap-1.5 pt-1.5">
          <CardActionLink
            href={`/surveys/${survey.id}/edit`}
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="수정"
            disabled={!canEdit}
          />
          <CardActionLink
            href={`/surveys/${survey.id}/operations/overview`}
            icon={<Activity className="h-3.5 w-3.5" />}
            label="현황"
          />
          {/* 분석은 당분간 막아 둔다. 다시 열 때는 href 를 되돌리고 canViewSurveyAnalyticsCard 로
            비활성을 정한다(분석 화면이 responses.view 를 요구해 팀원에게는 404 다). */}
          <CardActionLink
            icon={<ChartColumn className="h-3.5 w-3.5" />}
            label="분석"
            disabledReason="분석 기능은 준비 중입니다"
          />
          <CardActionLink
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            label="문의"
            disabledReason="문의 기능은 준비 중입니다"
          />
        </div>
      </div>

      {cardTitleOpen && (
        <CardTitleDialog
          surveyId={survey.id}
          surveyTitle={survey.title}
          cardTitle={survey.cardTitle}
          onClose={() => setCardTitleOpen(false)}
        />
      )}
      {sharingOpen && (
        <ShareSettingsModal
          surveyId={survey.id}
          surveyTitle={displayTitle}
          visibility={survey.visibility}
          canManageAccess={canManageAccess}
          currentOwnerName={survey.ownerName}
          currentOwnerUserId={survey.ownerUserId}
          ownerTeamName={survey.teamName}
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
  disabledReason,
}: {
  /** 없으면 갈 곳이 아직 없는 버튼이다 — 비활성으로 그린다. */
  href?: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  /** 비활성 이유 — 마우스를 올리면 보인다. */
  disabledReason?: string;
}) {
  if (disabled || href === undefined) {
    return (
      <span
        className="flex h-9 flex-1 cursor-not-allowed items-center justify-center gap-[5px] rounded-[9px] border border-[#E5E5EA] text-[13px] text-[#C7C7CC]"
        aria-disabled
        title={disabledReason}
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
        'flex h-9 flex-1 items-center justify-center gap-[5px] rounded-[9px] border border-[#E5E5EA] text-[13px] text-[#374151] transition-colors',
        'hover:bg-[#F5F5F7]',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
