import { Card, CardContent } from '@/components/ui/card';

/**
 * 응답자 목록 페이지 streaming 중 표시되는 skeleton.
 * 8행 placeholder + 헤더 라인. 실제 폭은 그리드와 일치 안 해도 OK.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4 h-7 w-32 animate-pulse rounded bg-slate-200" />
      <div className="mb-6 h-4 w-64 animate-pulse rounded bg-slate-100" />
      <Card>
        <CardContent className="px-5 py-4">
          <div className="mb-3 h-9 w-full animate-pulse rounded bg-slate-100" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-slate-50" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
