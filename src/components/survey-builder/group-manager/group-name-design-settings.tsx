'use client';

import { ChevronDown } from 'lucide-react';

import { RootGroupNameBadge } from '@/components/survey-response/step-views/root-group-name-badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { responseHeaderButtonClass } from '@/lib/survey/response-header-config';
import type { GroupNameDesign } from '@/types/survey';

const DEFAULT_BG_HEX = '#eff6ff'; // blue-50 (피커 표시용)
const DEFAULT_TEXT_HEX = '#1d4ed8'; // blue-700 (피커 표시용)

/** 빈 설정({} 또는 모든 키 falsy)은 undefined 로 정규화해 DB 노이즈를 막는다. */
function normalize(d: {
  fullWidth?: boolean | undefined;
  bgColor?: string | undefined;
  textColor?: string | undefined;
}): GroupNameDesign | undefined {
  const next: GroupNameDesign = {};
  if (d.fullWidth) next.fullWidth = true;
  if (d.bgColor) next.bgColor = d.bgColor;
  if (d.textColor) next.textColor = d.textColor;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function GroupNameDesignSettings({
  value,
  onChange,
  previewName,
}: {
  value?: GroupNameDesign | undefined;
  onChange: (value: GroupNameDesign | undefined) => void;
  previewName: string;
}) {
  const current: GroupNameDesign = value ?? {};
  const patch = (p: {
    fullWidth?: boolean | undefined;
    bgColor?: string | undefined;
    textColor?: string | undefined;
  }) => onChange(normalize({ ...current, ...p }));

  return (
    <Collapsible className="rounded-lg border border-gray-200">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between px-3 py-2.5"
        >
          디자인 설정
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-gray-100 px-3 py-3">
        {/* 배경 너비 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">배경 너비</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={!current.fullWidth}
              className={responseHeaderButtonClass(!current.fullWidth)}
              onClick={() => patch({ fullWidth: false })}
            >
              컨텐츠 크기
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={!!current.fullWidth}
              className={responseHeaderButtonClass(!!current.fullWidth)}
              onClick={() => patch({ fullWidth: true })}
            >
              전체 너비
            </Button>
          </div>
        </div>

        {/* 배경색 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">배경색</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={current.bgColor ?? DEFAULT_BG_HEX}
              onChange={(e) => patch({ bgColor: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-gray-200"
              aria-label="배경색 선택"
            />
            <Input
              value={current.bgColor ?? ''}
              onChange={(e) => patch({ bgColor: e.target.value || undefined })}
              placeholder="#eff6ff (기본)"
              className="w-32"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => patch({ bgColor: undefined })}>
              기본값
            </Button>
          </div>
        </div>

        {/* 폰트색 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">폰트색</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={current.textColor ?? DEFAULT_TEXT_HEX}
              onChange={(e) => patch({ textColor: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-gray-200"
              aria-label="폰트색 선택"
            />
            <Input
              value={current.textColor ?? ''}
              onChange={(e) => patch({ textColor: e.target.value || undefined })}
              placeholder="#1d4ed8 (기본)"
              className="w-32"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => patch({ textColor: undefined })}
            >
              기본값
            </Button>
          </div>
        </div>

        {/* 미리보기 */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">미리보기</Label>
          <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
            <RootGroupNameBadge name={previewName.trim() || '그룹 이름'} design={current} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
