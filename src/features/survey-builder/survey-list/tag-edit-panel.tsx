'use client';

import { type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Check, MoreHorizontal, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLatestRef } from '@/hooks/use-latest-ref';
import { cn } from '@/lib/utils';
import {
  PERSONAL_TAG_COLOR_LABEL,
  PERSONAL_TAG_MESSAGE,
  PERSONAL_TAG_NAME_MAX_LENGTH,
  personalTagColorValues,
} from '@/shared/contracts/workspace';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import {
  useDeletePersonalTag,
  useMyPersonalTags,
  useUpdatePersonalTag,
} from '../queries/use-personal-marks';
import { PERSONAL_TAG_SWATCH_CLASS, resolveTagRename } from './personal-tags';

interface TagEditPanelProps {
  /** 고칠 태그 — 내 태그(`mine`)의 한 줄. 패널은 같은 id 의 최신 값을 캐시에서 다시 읽는다. */
  tag: PersonalTagItem;
  /** 닫기 — Enter 로 이름을 저장했을 때·Esc·지운 뒤에 부른다. 바깥 클릭으로 닫는 것은 부르는 쪽 몫. */
  onClose: () => void;
}

/**
 * 태그 편집 패널 (설문 즐겨찾기·태그 티켓 08, 시안 F6 ③④) — 태그 창의 줄 「⋯」와 「# 태그」
 * 목록(티켓 09)의 줄 「⋯」가 함께 쓴다. 자리 잡기(팝오버)는 부르는 쪽이 한다 — `TagEditMenu` 가
 * 「⋯」 단추 + 팝오버까지 묶은 꼴이다.
 *
 * - 이름 칸: Enter·바깥 클릭으로 저장, Esc 로 취소. 다른 내 태그와 겹치거나(공백·대소문자 무시)
 *   비었으면 칸 아래 문구를 보이고 보내지 않는다. 20자를 넘는 입력은 받지 않는다.
 * - 색 8개: 누르면 바로 저장(따로 확인 없음). 지금 색은 `aria-pressed` + 체크.
 * - 삭제: 한 번 묻는다 — 붙어 있던 설문 수(`mine` 의 linkCount, 볼 수 없게 된 설문 포함)와 함께.
 *
 * 저장은 내 태그 캐시를 바로 고치므로 카드 태그 줄·검색 칩이 같은 이름·색으로 따라온다.
 */
export function TagEditPanel({ tag, onClose }: TagEditPanelProps) {
  const nameId = useId();
  const messageId = useId();
  const { data } = useMyPersonalTags();
  const tags = data?.tags ?? [tag];
  const current = tags.find((t) => t.id === tag.id) ?? tag;
  const updateTag = useUpdatePersonalTag();
  const deleteTag = useDeletePersonalTag();

  const [draft, setDraft] = useState(current.name);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 마지막으로 보낸 이름 — Enter·바깥 클릭·blur 가 겹쳐도 같은 이름을 두 번 보내지 않는다. */
  const sentNameRef = useRef(current.name);
  /** Esc 로 버린 뒤 같은 이벤트 안에서 오는 blur·바깥 클릭이 버린 이름을 보내지 않게 바로 쓴다. */
  const draftRef = useRef(draft);

  async function commitName(closeOnSuccess: boolean) {
    const decision = resolveTagRename(draftRef.current, current, tags);
    if (decision.kind === 'unchanged') {
      if (closeOnSuccess) onClose();
      return;
    }
    if (decision.kind === 'invalid') {
      setMessage(decision.message);
      return;
    }
    if (decision.name === sentNameRef.current) return;
    sentNameRef.current = decision.name;
    const result = await updateTag(current.id, { name: decision.name });
    if (result.ok) {
      if (closeOnSuccess) onClose();
      return;
    }
    // 거부되면 같은 이름을 다시 보낼 수 있게 한다.
    sentNameRef.current = current.name;
    if (result.nameError) setMessage(result.nameError);
  }

  // 바깥 클릭 저장 — 태그 창의 줄은 누를 때 포커스를 옮기지 않아(칸 포커스를 지키려고) blur 가
  // 오지 않는다. 그래서 패널 밖을 누르는 순간을 직접 본다. 확인 대화상자는 패널 밖에 그려진다.
  const commitOutsideRef = useLatestRef(() => void commitName(false));
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[role="alertdialog"]')) return;
      commitOutsideRef.current();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [commitOutsideRef]);

  function handleChange(next: string) {
    if ([...next.trim()].length > PERSONAL_TAG_NAME_MAX_LENGTH) {
      setMessage(PERSONAL_TAG_MESSAGE.too_long);
      return;
    }
    setDraft(next);
    draftRef.current = next;
    const decision = resolveTagRename(next, current, tags);
    // 겹침은 치는 동안 바로 알린다. 빈 이름은 저장하려 할 때만.
    setMessage(
      decision.kind === 'invalid' && decision.reason === 'taken' ? decision.message : null,
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitName(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(current.name);
      draftRef.current = current.name;
      setMessage(null);
      onClose();
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    const ok = await deleteTag(current.id);
    setDeleting(false);
    if (ok) {
      setConfirmOpen(false);
      onClose();
    }
  }

  return (
    <div ref={rootRef} className="flex w-[220px] flex-col gap-1 p-1.5">
      <label htmlFor={nameId} className="sr-only">
        태그 이름
      </label>
      <input
        id={nameId}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void commitName(false)}
        aria-invalid={message !== null}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          'h-8 w-full rounded-md border border-[#2E4FCE] bg-white px-2 text-[13.5px] text-[#1C1C1E] outline-none focus:ring-2 focus:ring-[#2E4FCE]/25',
          message && 'border-[#D93025] focus:ring-[#D93025]/20',
        )}
      />
      {message && (
        <p id={messageId} role="alert" className="px-1 text-[12px] text-[#D93025]">
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-[#D93025] hover:bg-[#FDECEC] focus-visible:ring-2 focus-visible:ring-[#D93025]/30 focus-visible:outline-none"
      >
        <Trash2 aria-hidden className="h-3.5 w-3.5" />
        삭제
      </button>

      <div className="my-0.5 border-t border-[#E5E5EA]" />
      <p id={`${nameId}-colors`} className="px-2 text-[11.5px] text-[#8E8E93]">
        색
      </p>
      <div role="group" aria-labelledby={`${nameId}-colors`} className="flex flex-col">
        {personalTagColorValues.map((color) => {
          const pressed = current.color === color;
          return (
            <button
              key={color}
              type="button"
              aria-pressed={pressed}
              onClick={() => {
                if (!pressed) void updateTag(current.id, { color });
              }}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-[#1C1C1E] hover:bg-[#F2F2F7] focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/30 focus-visible:outline-none',
                pressed && 'bg-[#F2F4FB]',
              )}
            >
              <span
                aria-hidden
                className={cn('h-4 w-4 shrink-0 rounded border', PERSONAL_TAG_SWATCH_CLASS[color])}
              />
              {PERSONAL_TAG_COLOR_LABEL[color]}
              {pressed && <Check aria-hidden className="ml-auto h-4 w-4 text-[#2E4FCE]" />}
            </button>
          );
        })}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>「{current.name}」 태그를 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>
              붙어 있던 설문 {current.linkCount}건에서 떨어지고, 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                // 지우기가 끝난 뒤 닫는다 — 실패하면 대화상자가 남아 다시 누를 수 있다.
                event.preventDefault();
                void confirmDelete();
              }}
              className="bg-[#D93025] text-white hover:bg-[#B3261E]"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface TagEditMenuProps {
  tag: PersonalTagItem;
  /** 이 태그의 패널이 열려 있는가 — 한 번에 한 태그만 열리게 부르는 쪽이 하나의 상태로 쥔다. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  /**
   * 패널이 옆에 설 상자 — 「⋯」가 든 목록(태그 창·「# 태그」 목록) 전체. 주면 패널은 이 상자의 좌우
   * 바깥에, 높이는 「⋯」 줄에 맞춰 선다. 「⋯」 단추 옆에 세우면 오른쪽 자리가 모자라 왼쪽으로 뒤집힐 때
   * 목록 위를 덮는다(1280·1600 실측 — 태그 이름과 바닥 안내가 가려졌다).
   */
  besideRef?: RefObject<HTMLElement | null>;
}

/**
 * 줄 끝 「⋯」 단추 + 옆에 뜨는 편집 패널. 줄에 마우스를 올렸을 때만 보이게 하는 것은 부르는 쪽의
 * `className`(예: `opacity-0 group-hover/row:opacity-100`)이다 — 열려 있거나 포커스가 오면 늘 보인다.
 */
export function TagEditMenu({ tag, open, onOpenChange, className, besideRef }: TagEditMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 가상 기준점 — 가로는 목록 상자, 세로는 「⋯」 줄. 펼칠 때마다 다시 잰다(목록 안 스크롤을 따라간다).
  const besideAnchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const row = triggerRef.current?.getBoundingClientRect() ?? new DOMRect();
          const box = besideRef?.current?.getBoundingClientRect();
          return box ? besideAnchorRect(box, row) : row;
        },
        // 스크롤 따라가기의 기준 요소 — 목록 안 스크롤에도 다시 잰다.
        get contextElement() {
          return triggerRef.current ?? undefined;
        },
      },
    }),
    [besideRef],
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {besideRef && <PopoverAnchor virtualRef={besideAnchor} />}
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${tag.name} 편집`}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#6E6E73] hover:bg-[#E5E5EA] hover:text-[#1C1C1E] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#2E4FCE]/40 focus-visible:outline-none',
            className,
            open && 'bg-[#E5E8F5] text-[#2E4FCE] opacity-100',
          )}
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-auto p-0">
        <TagEditPanel tag={tag} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}

type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

/** 가로는 상자(`box`), 세로는 줄(`row`)인 사각형 — 패널을 목록 전체의 옆, 그 줄 높이에 세운다. */
function besideAnchorRect(box: RectLike, row: RectLike): DOMRect {
  return new DOMRect(box.left, row.top, box.width, row.height);
}
