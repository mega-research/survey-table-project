import { Card, CardContent } from '@/components/ui/card';

import { EmptyState } from './empty-state';

// Placeholder: 응답자 문의사항 카드. 백엔드는 후속 슬라이스. 현재는 빈 상태만 표시.
export function InquiriesEmptyCard() {
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          응답자 문의사항
        </h3>
        <EmptyState message="문의사항이 없습니다" />
      </CardContent>
    </Card>
  );
}
