'use client';

import { Scissors } from 'lucide-react';

import { Button } from '@/components/ui/button';

// 질문 카드 호버 액션용 페이지 구분점 토글 — pageBreakBefore(이 질문 앞에서 새 페이지) 온오프
export function PageBreakToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={
        active
          ? 'h-8 w-8 bg-blue-50 p-0 text-blue-600 hover:bg-blue-100 hover:text-blue-700'
          : 'h-8 w-8 p-0'
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={active ? '페이지 나누기 해제' : '이 질문부터 새 페이지로 나누기'}
    >
      <Scissors className="h-4 w-4" />
    </Button>
  );
}
