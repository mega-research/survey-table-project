import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import { EmptyState } from '@/features/operations/empty-state';
import type { ContactUploadRow } from '@/shared/contracts/contacts-io';

const MODE_LABEL: Record<string, string> = { replace: '교체', merge: '병합', append: '추가' };
const MODE_TONE: Record<string, string> = {
  replace: 'bg-red-50 text-red-700',
  merge: 'bg-blue-50 text-blue-700',
  append: 'bg-emerald-50 text-emerald-700',
};

interface UploadHistoryTableProps {
  surveyId: string;
  rows: ContactUploadRow[];
}

export function UploadHistoryTable({ surveyId, rows }: UploadHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="px-5 py-4">
          <EmptyState
            message="업로드 이력이 없습니다"
            description="엑셀 파일을 업로드해 조사 대상 명단을 적재하세요."
          />
          <div className="mt-4 flex justify-center">
            <Button asChild>
              <Link href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}>
                엑셀 업로드
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">파일명</th>
                <th className="px-3 py-2 text-left">방식</th>
                <th className="px-3 py-2 text-right">신규</th>
                <th className="px-3 py-2 text-right">갱신</th>
                <th className="px-3 py-2 text-right">제외</th>
                <th className="px-3 py-2 text-right">에러</th>
                <th className="px-3 py-2 text-right">업로드 일시</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{r.filename}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${MODE_TONE[r.mode] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {MODE_LABEL[r.mode] ?? r.mode}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.uploadedRows.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.mergedRows.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.skippedRows.toLocaleString('ko-KR')}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.errorRows > 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {r.errorRows.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                    <LocalDateTime value={r.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
