'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * 빌더 화면 우하단 플로팅 스크롤 버튼. 두 빌더 화면이 같은 21줄을 각각 갖고 있었고
 * 마크업이 글자 하나 다르지 않았다.
 */
export function ScrollEdgeButtons({
  onScrollTop,
  onScrollBottom,
}: {
  onScrollTop: () => void;
  onScrollBottom: () => void;
}) {
  return (
    <div className="fixed right-6 bottom-6 z-50 flex flex-col space-y-2">
      <Button
        onClick={onScrollTop}
        size="sm"
        className="h-12 w-12 rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg transition-all duration-200 hover:scale-110 hover:bg-gray-50"
        title="맨 위로"
      >
        <ArrowUp className="h-5 w-5" />
      </Button>
      <Button
        onClick={onScrollBottom}
        size="sm"
        className="h-12 w-12 rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg transition-all duration-200 hover:scale-110 hover:bg-gray-50"
        title="맨 아래로"
      >
        <ArrowDown className="h-5 w-5" />
      </Button>
    </div>
  );
}
