'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface PlaceholderFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * 응답 칸이 여러 줄 입력칸(장문형, 줄 수 2 이상, 입력한 만큼 높이 늘리기)인가.
   * 여러 줄 칸은 안내 문구의 줄바꿈을 그대로 그리므로 여기서도 줄바꿈을 칠 수 있어야 한다.
   * 한 줄 칸은 브라우저가 안내 문구의 줄바꿈을 버리므로 한 줄 입력칸으로 둔다.
   */
  multiline: boolean;
  className?: string;
}

/** 안내 문구(placeholder) 입력칸 — 질문 편집(단답형·장문형)과 셀 편집(input 셀)이 함께 쓴다. */
export function PlaceholderField({ id, value, onChange, multiline, className }: PlaceholderFieldProps) {
  if (!multiline) {
    return (
      <>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="예: 이름을 입력하세요"
          className={className}
        />
        <p className="mt-1 text-xs text-gray-500">입력 필드에 표시될 안내 문구를 입력하세요</p>
      </>
    );
  }
  return (
    <>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(2, value.split('\n').length)}
        placeholder={'예: ex1. 대학 재학 중 / 휴학 중\nex2. 진로 고민 / 취업 걱정'}
        className={`min-h-0 ${className ?? ''}`}
      />
      <p className="mt-1 text-xs text-gray-500">
        입력 필드에 표시될 안내 문구를 입력하세요. 줄을 바꾸면(Enter) 응답 화면에도 줄이 나뉘어 보입니다
      </p>
    </>
  );
}
