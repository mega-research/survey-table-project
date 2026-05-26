'use client';

import { Input } from '@/components/ui/input';

interface OptionPlaceholderEditorProps {
  value: string | undefined;
  onChange: (next: string) => void;
}

/**
 * 주관식(allowTextInput) 옵션의 placeholder 텍스트 편집 input.
 * 옵션 행 바로 아래에 들여쓰기되어 렌더된다. question-basic-tab / cell-choice-editor 공용.
 */
export function OptionPlaceholderEditor({ value, onChange }: OptionPlaceholderEditorProps) {
  return (
    <div className="flex items-center gap-2 px-3 pb-3 pl-9">
      <span className="shrink-0 text-[10px] text-gray-400">placeholder</span>
      <Input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="상세 기재"
        className="h-7 text-xs"
      />
    </div>
  );
}
