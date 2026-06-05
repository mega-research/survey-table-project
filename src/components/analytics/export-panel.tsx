'use client';

import { useState } from 'react';

import { Button, Card } from '@tremor/react';
import { Download, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';

import { buildSafeFilename, downloadText } from '@/lib/analytics/export-download';

import { ExportDataModal } from './export-data-modal';

type TextFormat = 'json' | 'csv';

interface ExportPanelProps {
  surveyId: string;
  onExportJson: () => Promise<string>;
  onExportCsv: () => Promise<string>;
  surveyTitle?: string;
}

const MIME_BY_FORMAT: Record<TextFormat, string> = {
  json: 'application/json',
  csv: 'text/csv;charset=utf-8;',
};

export function ExportPanel({
  surveyId,
  onExportJson,
  onExportCsv,
  surveyTitle = 'survey',
}: ExportPanelProps) {
  const [isExporting, setIsExporting] = useState<TextFormat | null>(null);

  const handleExport = async (format: TextFormat) => {
    setIsExporting(format);
    try {
      const data = format === 'json' ? await onExportJson() : await onExportCsv();

      if (!data) {
        alert('내보낼 데이터가 없습니다.');
        return;
      }

      downloadText(data, buildSafeFilename(surveyTitle, '응답', format), MIME_BY_FORMAT[format]);
    } catch (error) {
      console.error('Export error:', error);
      alert('내보내기 중 오류가 발생했습니다.');
    } finally {
      setIsExporting(null);
    }
  };

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
