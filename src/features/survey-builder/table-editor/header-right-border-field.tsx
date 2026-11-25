'use client';

import { useId } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface HeaderRightBorderFieldProps {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  /** 한 칸이 아니라 머리글 전체에 적용하는 자리(전체 헤더 스타일) — 설명 글이 달라진다 */
  bulk?: boolean | undefined;
}

/**
 * 머리글 「오른쪽 세로선 숨김」 스위치 — 다단계 헤더 칸 · 한 줄 머리글의 열 · 전체 헤더 스타일이 함께 쓴다.
 * 본문 칸의 같은 이름 옵션(`TableCell.hideRightBorder`)과 같은 규칙이다: 응답 화면·미리보기에서만 선을
 * 지우고 편집 화면은 칸 경계를 그대로 보인다.
 */
export function HeaderRightBorderField({
  checked,
  onCheckedChange,
  bulk = false,
}: HeaderRightBorderFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>오른쪽 세로선 숨김</Label>
        <p id={helpId} className="mt-1 text-xs leading-snug text-gray-500">
          {bulk
            ? '응답 화면과 미리보기에서 머리글 칸 사이의 세로선을 모두 그리지 않습니다. 표의 오른쪽 끝선은 남고, 편집 화면에서는 선이 그대로 보입니다.'
            : '응답 화면과 미리보기에서 이 머리글 칸과 오른쪽 칸 사이 선을 그리지 않습니다. 편집 화면에서는 선이 그대로 보입니다.'}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={helpId}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
