'use client';

import { useId } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { MobilePieceIssue } from '@/features/survey-builder/lib/mobile-piece-diagnostics';
import {
  MOBILE_PIECE_COLUMNS_PER_VIEW_MAX,
  MOBILE_PIECE_COLUMNS_PER_VIEW_MIN,
  resolveMobilePieceColumnsPerView,
} from '@/types/mobile-table-display';

import { ScaleBarIssueAlert } from './scale-bar-issue-alert';

/**
 * 조각 좌우 반전 · 조각 한 화면 칸 수 — 원본 행 상세 설정의 셋째·넷째 항목(CONTEXT.md).
 *
 * ── 배선과 규칙 ──
 * - 둘 다 **휴대폰 화면의 원본 표 조각에만** 적용된다. PC 표·응답값·변수명은 그대로다.
 * - 값은 스토어의 문항 필드 둘이다(`mobileDrilldownReverseColumns` · `mobileDrilldownColumnsPerView`). 끌 때는
 *   키를 지우지 않고 false · null 을 적는다 — 문항 부분 수정은 키가 없으면 「그대로 두기」로 읽는다.
 * - 칸 수 범위는 어휘 상수(`@/types/mobile-table-display`)가 정한다.
 * - 경고는 진단(`diagnoseMobilePieceArrangement`)이 응답 화면과 같은 판정으로 낸 사유를 그대로 보인다.
 * - 어느 표시 방식에서 보일지는 부르는 쪽(모바일 표시 방식 설정)이 정한다.
 */

interface MobilePieceArrangementFieldsProps {
  reverseColumns: boolean;
  columnsPerView: number | null;
  onChange: (patch: { reverseColumns?: boolean; columnsPerView?: number | null }) => void;
  issues?: readonly MobilePieceIssue[] | undefined;
}

/** 선택 상자의 「비움」 값 — 칸 수가 없음을 글자 값 하나로 적는다 */
const OFF = 'off';

const COUNT_OPTIONS = Array.from(
  { length: MOBILE_PIECE_COLUMNS_PER_VIEW_MAX - MOBILE_PIECE_COLUMNS_PER_VIEW_MIN + 1 },
  (_, index) => MOBILE_PIECE_COLUMNS_PER_VIEW_MIN + index,
);

/** 닫힌 상자에 보일 글자 — Base UI Select 는 `items` 가 없으면 값(off·6)을 그대로 그린다 */
const COUNT_ITEMS = [
  { value: OFF, label: '비움' },
  ...COUNT_OPTIONS.map((option) => ({ value: String(option), label: `${option}칸` })),
];

export function MobilePieceArrangementFields({
  reverseColumns,
  columnsPerView,
  onChange,
  issues = [],
}: MobilePieceArrangementFieldsProps) {
  const id = useId();
  const count = resolveMobilePieceColumnsPerView(columnsPerView);

  return (
    <div className="space-y-3 border-t border-gray-200 pt-3 sm:col-span-2">
      <p className="text-xs text-gray-600">
        아래 둘은 휴대폰 화면의 원본 표 조각에만 적용됩니다. PC 표, 응답값, 변수명은 그대로입니다.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-reverse`}>좌우 반전</Label>
            <Switch
              id={`${id}-reverse`}
              aria-describedby={`${id}-reverse-help`}
              checked={reverseColumns}
              onCheckedChange={(on) => onChange({ reverseColumns: on })}
            />
          </div>
          <p id={`${id}-reverse-help`} className="text-xs text-gray-500">
            칸의 순서를 뒤집어 그립니다(⓪ → ⑩ 표가 ⑩ → ⓪ 으로). 「평균에서 제외」를 표시한 칸은 끝에
            그대로 둡니다.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-per-view`}>한 화면에 보일 칸 수</Label>
          <Select
            items={COUNT_ITEMS}
            value={count === null ? OFF : String(count)}
            onValueChange={(next) => {
              if (next === null) return;
              onChange({ columnsPerView: next === OFF ? null : Number(next) });
            }}
          >
            <SelectTrigger id={`${id}-per-view`} aria-describedby={`${id}-per-view-help`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OFF}>비움 — PC 표의 열 폭 그대로</SelectItem>
              {COUNT_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}칸
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${id}-per-view-help`} className="text-xs text-gray-500">
            화면 폭을 이 수로 나눠 칸 폭을 정합니다. 11점 척도에 6칸이면 처음 화면에 가운데 점수까지
            보입니다. 칸이 누르기 어렵게 좁아지는 작은 폰(폭 320px 급)에서는 칸 수를 줄여 보입니다.
            보기 칸만 있는 행에 적용됩니다.
          </p>
        </div>
      </div>
      <ScaleBarIssueAlert
        title="일부 행은 설정이 적용되지 않고 지금 모양으로 보입니다"
        issues={issues}
      />
    </div>
  );
}
