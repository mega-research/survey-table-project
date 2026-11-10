'use client';

import { useId, useMemo, useState } from 'react';

import { CornerLeftUp, Folder, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import { SURVEY_GROUP_MAX_DEPTH } from '@/shared/contracts/workspace-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import {
  type SurveyGroupRelocationBlock,
  findSurveyGroupPath,
  listSurveyGroupPathLabels,
  listSurveyGroupRelocationTargets,
} from '@/utils/survey-group-tree';

import { useRelocateSurveyGroup } from '../../queries/use-survey-groups';

/** 「최상위로」 줄의 선택 키 — 그룹 id(uuid)와 겹치지 않는다. */
const ROOT_KEY = 'root';

/** 꺼진 자리에 적는 이유. 자기 자신·자기 하위는 목록에 없어 문구가 필요 없다. */
function blockedReason(blocked: SurveyGroupRelocationBlock | null): string | null {
  if (blocked === 'current') return '지금 여기';
  if (blocked === 'too_deep') return `${SURVEY_GROUP_MAX_DEPTH}단계를 넘습니다`;
  return null;
}

/**
 * 그룹 옮기기 창 (3단계 시안 G4) — 그룹을 하위 그룹·담긴 설문째 옮길 자리를 고른다.
 *
 * 갈 자리는 라디오 트리다. 「최상위로」가 맨 위에 있고, 자기 자신과 그 하위는 목록에 없으며,
 * 지금 부모(「지금 여기」)와 옮기면 3단계를 넘는 자리는 **이유를 적은 채** 꺼져 있다 — 왜 못
 * 가는지 눌러 보지 않고 안다. 판정은 화면 밖 순수 함수(`listSurveyGroupRelocationTargets`)이고
 * 서버가 같은 판정을 다시 한다. 화면이 아는 것은 내게 보이는 그룹뿐이라, 켜져 있던 자리가
 * 서버에서 거부될 수 있다(안 보이는 하위 그룹이 있거나 그 사이 다른 팀원이 구조를 바꿨다).
 * 그때는 서버의 문구를 보이고, 다시 읽힌 그룹 목록으로 트리가 지금 구조가 된다(mutation 의
 * onSettled) — 고른 자리가 더는 갈 수 없는 자리면 선택이 풀린다.
 *
 * `groups` 는 그룹 목록 그대로 받는다(협업 그룹 포함). 다른 팀의 폴더는 옮길 자리가 아니라
 * 여기서 걸러 낸다.
 */
export function GroupRelocateDialog({
  group,
  groups,
  onClose,
}: {
  group: { id: string; name: string };
  groups: readonly SurveyGroupListItem[];
  onClose: () => void;
}) {
  const fieldName = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const relocateGroup = useRelocateSurveyGroup();

  const mine = useMemo(() => groups.filter((g) => g.foreignTeamName === null), [groups]);
  const { root, targets } = useMemo(
    () => listSurveyGroupRelocationTargets(mine, group.id, SURVEY_GROUP_MAX_DEPTH),
    [mine, group.id],
  );
  // 라디오의 읽어 주는 이름 — 같은 이름의 하위 그룹(「2025」)이 여러 상위 그룹 밑에 설 수 있다.
  const pathLabels = useMemo(() => listSurveyGroupPathLabels(mine), [mine]);
  const isGone = root.blocked === 'missing';
  const path = findSurveyGroupPath(mine, group.id);

  // 고른 자리는 **지금 구조에서 갈 수 있을 때만** 유효하다 — 목록이 다시 읽혀 그 자리가 꺼지면 풀린다.
  const selectedTarget = targets.find((t) => t.group.id === selectedKey && t.blocked === null);
  const destination: { parentGroupId: string | null; name: string | null } | null =
    selectedKey === ROOT_KEY && root.blocked === null
      ? { parentGroupId: null, name: null }
      : selectedTarget
        ? { parentGroupId: selectedTarget.group.id, name: selectedTarget.group.name }
        : null;

  async function submit() {
    if (!destination || relocateGroup.isPending) return;
    setError(null);
    try {
      await relocateGroup.mutateAsync({
        groupId: group.id,
        parentGroupId: destination.parentGroupId,
      });
      toast.success(
        destination.name === null
          ? `「${group.name}」 그룹을 최상위로 옮겼습니다`
          : `「${group.name}」 그룹을 「${destination.name}」 아래로 옮겼습니다`,
      );
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '그룹을 옮기지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>「{group.name}」 옮기기</DialogTitle>
          <DialogDescription>
            {path.length > 0 && `지금 위치: ${path.map((g) => g.name).join(' › ')} · `}
            하위 그룹과 담긴 설문이 함께 옮겨집니다
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex min-w-0 flex-col gap-4"
        >
          {isGone ? (
            <p className="rounded-[10px] bg-[#F5F5F7] px-4 py-3 text-[13px] leading-relaxed text-[#374151]">
              이 그룹을 찾을 수 없습니다. 다른 사람이 지웠을 수 있습니다 — 창을 닫고 목록을 다시
              확인해 주세요.
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="옮길 자리"
              className="-mx-2 flex max-h-[min(52vh,420px)] flex-col gap-0.5 overflow-y-auto px-2 py-0.5"
            >
              <DestinationRow
                fieldName={fieldName}
                value={ROOT_KEY}
                label="최상위로 옮기기"
                spokenLabel="최상위로 옮기기"
                depth={1}
                icon="root"
                reason={blockedReason(root.blocked)}
                disabled={root.blocked !== null}
                checked={destination?.parentGroupId === null}
                onSelect={setSelectedKey}
              />
              {targets.map((target) => (
                <DestinationRow
                  key={target.group.id}
                  fieldName={fieldName}
                  value={target.group.id}
                  label={target.group.name}
                  spokenLabel={pathLabels.get(target.group.id) ?? target.group.name}
                  depth={target.depth}
                  icon="folder"
                  reason={blockedReason(target.blocked)}
                  disabled={target.blocked !== null}
                  checked={destination?.parentGroupId === target.group.id}
                  onSelect={setSelectedKey}
                />
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="text-[13px] text-red-600">
              {error}
            </p>
          )}

          <DialogFooter className="sm:items-center sm:justify-between">
            {/* 고른 자리를 한 줄로 되읽어 준다 — 긴 트리에서 무엇을 골랐는지 버튼 옆에서 확인한다. */}
            <p aria-live="polite" className="min-w-0 truncate text-[13px] text-[#6E6E73]">
              {isGone
                ? ''
                : destination === null
                  ? '옮길 자리를 고르세요'
                  : destination.name === null
                    ? '최상위로 옮깁니다'
                    : `「${destination.name}」 아래로 옮깁니다`}
            </p>
            <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                취소
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={destination === null || relocateGroup.isPending}
              >
                {relocateGroup.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                옮기기
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 옮길 자리 한 줄 — 줄 전체가 라디오의 라벨이라 어디를 눌러도 골라진다.
 *
 * 꺼진 줄의 이유는 오른쪽에 글자로 적고 라디오의 설명(`aria-describedby`)으로 잇는다. 이름은
 * `aria-label` 로 따로 준다 — 라벨 안의 글자를 그대로 이름으로 쓰면 이유까지 이름에 섞인다.
 * 그 이름(`spokenLabel`)은 **경로**다(「이정운 › 2025」): 들여쓰기는 눈에만 보여서, 이름만 읽으면
 * 같은 이름의 하위 그룹 둘이 구별되지 않는다. 줄에 보이는 글자(`label`)는 이름 그대로다.
 */
function DestinationRow({
  fieldName,
  value,
  label,
  spokenLabel,
  depth,
  icon,
  reason,
  disabled,
  checked,
  onSelect,
}: {
  fieldName: string;
  value: string;
  label: string;
  spokenLabel: string;
  /** 들여쓰기 단계 — 뿌리가 1. */
  depth: number;
  icon: 'root' | 'folder';
  reason: string | null;
  disabled: boolean;
  checked: boolean;
  onSelect: (value: string) => void;
}) {
  const reasonId = useId();
  const Icon = icon === 'root' ? CornerLeftUp : Folder;

  return (
    <label
      style={{ paddingLeft: 12 + (depth - 1) * 24 }}
      className={cn(
        'flex min-h-10 items-center gap-3 rounded-[9px] py-2 pr-3 text-[14px] transition-colors',
        'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-[#2E4FCE]/40',
        disabled
          ? 'cursor-not-allowed text-[#8E8E93]'
          : checked
            ? 'cursor-pointer bg-[#EEF2FF] font-semibold text-[#1C1C1E]'
            : 'cursor-pointer text-[#1C1C1E] hover:bg-[#F5F5F7]',
      )}
    >
      <input
        type="radio"
        name={fieldName}
        value={value}
        aria-label={spokenLabel}
        aria-describedby={reason ? reasonId : undefined}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="h-4 w-4 shrink-0 accent-[#2E4FCE] outline-none"
      />
      <Icon
        aria-hidden
        className={cn('h-4 w-4 shrink-0', disabled ? 'text-[#C5C8D0]' : 'text-[#2743AE]')}
      />
      <span title={label} className="min-w-0 flex-1 truncate">
        {label}
      </span>
      {reason && (
        <span id={reasonId} className="shrink-0 text-[12.5px] font-normal text-[#6E6E73]">
          {reason}
        </span>
      )}
    </label>
  );
}
