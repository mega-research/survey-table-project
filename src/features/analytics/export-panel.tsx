'use client';

import { useMutation } from '@tanstack/react-query';
import { Button, Card } from '@tremor/react';
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { buildSafeFilename, downloadText } from '@/lib/analytics/export-download';
import { client } from '@/shared/lib/rpc';

import { ExportDataModal } from './export-data-modal';

type TextFormat = 'json' | 'csv';

interface ExportPanelProps {
  surveyId: string;
  surveyTitle?: string;
}

const MIME_BY_FORMAT: Record<TextFormat, string> = {
  json: 'application/json',
  csv: 'text/csv;charset=utf-8;',
};

export function ExportPanel({ surveyId, surveyTitle = 'survey' }: ExportPanelProps) {
  const exportMutation = useMutation({
    // 인증은 authed procedure 한 곳에서만 결정한다 — 페이지가 만들던 인라인 server action
    // 은 본문 인증이 없는 공개 POST 엔드포인트였다.
    mutationFn: (format: TextFormat) =>
      format === 'json'
        ? client.surveyBuilder.read.exportJson({ surveyId })
        : client.surveyBuilder.read.exportCsv({ surveyId }),
    onSuccess: (data, format) => {
      if (!data) {
        toast.error('내보낼 데이터가 없습니다.');
        return;
      }
      downloadText(data, buildSafeFilename(surveyTitle, '응답', format), MIME_BY_FORMAT[format]);
    },
    onError: (error) => {
      console.error('Export error:', error);
      toast.error('내보내기 중 오류가 발생했습니다.');
    },
  });
  // 진행 중인 포맷 — variables 는 pending 동안의 호출 인자
  const isExporting: TextFormat | null = exportMutation.isPending
    ? (exportMutation.variables ?? null)
    : null;
  const handleExport = (format: TextFormat) => exportMutation.mutate(format);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-gray-500" />
          <span className="font-medium text-gray-900">데이터 내보내기</span>
        </div>
        <div className="flex gap-2">
          {/* 통합 엑셀 다운로드 (모달 트리거) */}
          <ExportDataModal surveyId={surveyId} surveyTitle={surveyTitle} />

          <Button
            size="sm"
            variant="secondary"
            icon={isExporting === 'csv' ? Loader2 : FileSpreadsheet}
            onClick={() => handleExport('csv')}
            disabled={isExporting !== null}
            className={isExporting === 'csv' ? 'animate-pulse' : ''}
          >
            CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={isExporting === 'json' ? Loader2 : FileJson}
            onClick={() => handleExport('json')}
            disabled={isExporting !== null}
            className={isExporting === 'json' ? 'animate-pulse' : ''}
          >
            JSON
          </Button>
        </div>
      </div>
    </Card>
  );
}
