'use client';

import { useState } from 'react';

import { ChevronDown, ChevronUp } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { TextValidation } from '@/types/survey';
import { normalizeTextValidation } from '@/features/question-renderer/utils/text-quality';

interface TextValidationFieldsProps {
  value: TextValidation | null | undefined;
  /** 정리된 설정(둘 다 없으면 null) — 패치에서 undefined 는 "손대지 않음" 이라 지우려면 null 이어야 한다 */
  onChange: (next: TextValidation | null) => void;
  /** 숫자 모드·입력 형식 칸 — 자기 검사가 있어 여기서는 잠근다(배타) */
  locked: boolean;
  /** 같은 화면에 두 벌이 있을 때 id 충돌을 막는다 */
  idPrefix: string;
}

/** 접힌 머리줄에 보일 현재 설정 요약 — 무엇이 켜져 있는지 펼치지 않아도 읽힌다 */
export function summarizeTextValidation(config: TextValidation | null | undefined): string {
  const parts: string[] = [];
  if (typeof config?.minLength === 'number') parts.push(`최소 ${config.minLength}자`);
  if (typeof config?.maxLength === 'number') parts.push(`최대 ${config.maxLength}자`);
  if (config?.rejectMeaningless) parts.push('무의미 입력 막기');
  return parts.length > 0 ? parts.join(' · ') : '설정 없음';
}

/**
 * 단답형·장문형 문항과 표 input 셀이 같이 쓰는 「응답 품질 검사」 설정 묶음 —
 * 최소·최대 글자 수와 의미 없는 입력 거부. 접고 펼 수 있고, 설정이 하나라도 켜져 있으면
 * 펼친 채로 시작한다(빈 설정은 접혀 있어야 편집 화면이 길어지지 않는다).
 */
export function TextValidationFields({
  value,
  onChange,
  locked,
  idPrefix,
}: TextValidationFieldsProps) {
  const config = value ?? {};
  const hasAny = normalizeTextValidation(config) !== null;
  const [open, setOpen] = useState(hasAny);
  const update = (next: {
    minLength?: number | undefined;
    maxLength?: number | undefined;
    rejectMeaningless?: boolean | undefined;
  }) => onChange(normalizeTextValidation({ ...config, ...next }));

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-gray-200"
      data-testid={`${idPrefix}-text-validation`}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
          aria-expanded={open}
        >
          <span className="flex min-w-0 items-center gap-2">
            {open ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-gray-500" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
            )}
            <span className="text-sm font-medium">응답 품질 검사</span>
          </span>
          <span
            className={cn('truncate text-xs', hasAny ? 'text-gray-700' : 'text-gray-400')}
            data-testid={`${idPrefix}-text-validation-summary`}
          >
            {locked ? '평문 모드 전용' : summarizeTextValidation(config)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t border-gray-100 px-3 pt-3 pb-3">
          <p className="text-xs text-gray-500">
            {locked
              ? '숫자 모드·입력 형식 칸은 자기 검사를 씁니다. 평문 모드에서만 설정할 수 있습니다.'
              : '조건에 맞지 않으면 응답자가 「다음」으로 넘어갈 수 없습니다. 관리자 응답 수정에서는 경고 후 통과합니다.'}
          </p>
          <div className="flex items-center gap-3">
            <Label htmlFor={`${idPrefix}-min-length`} className="w-28 shrink-0 text-sm">
              최소 글자 수
            </Label>
            <Input
              id={`${idPrefix}-min-length`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="w-28"
              disabled={locked}
              value={typeof config.minLength === 'number' ? String(config.minLength) : ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ minLength: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              placeholder="없음"
            />
            <span className="text-xs text-gray-500">자 이상 (공백 제외)</span>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor={`${idPrefix}-max-length`} className="w-28 shrink-0 text-sm">
              최대 글자 수
            </Label>
            <Input
              id={`${idPrefix}-max-length`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="w-28"
              disabled={locked}
              value={typeof config.maxLength === 'number' ? String(config.maxLength) : ''}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ maxLength: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              placeholder="없음"
            />
            <span className="text-xs text-gray-500">자까지 입력 가능 (공백 포함)</span>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              id={`${idPrefix}-reject-meaningless`}
              disabled={locked}
              checked={config.rejectMeaningless === true}
              onCheckedChange={(checked) => update({ rejectMeaningless: checked })}
            />
            <div className="space-y-0.5">
              <Label htmlFor={`${idPrefix}-reject-meaningless`} className="text-sm">
                자음·모음·숫자만 입력하면 막기
              </Label>
              <p className="text-xs text-gray-500">
                ㅋㅋㅋ · ㅎㅎ · 123124 처럼 완성된 글자가 없거나, aaaaa · 하하하하 · 네네네 처럼
                한두 글자만 되풀이한 답을 받지 않습니다.
              </p>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
