'use client';

import { useState } from 'react';

import { BarChart3, ClipboardCheck, FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { XLSM_MIME, type CleaningExportOptions } from '@/lib/analytics/cleaning-export-types';
import { buildSafeFilename, downloadBlob } from '@/lib/analytics/export-download';

interface Props {
  surveyId: string;
  surveyTitle: string;
  onExportCleaningExcel?: (options: CleaningExportOptions) => Promise<Blob | null>;
}

export function ExportDataModal({ surveyId, surveyTitle, onExportCleaningExcel }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [includeMacroSync, setIncludeMacroSync] = useState(true);

  const handleExport = async (type: string) => {
    try {
      setExportingType(type);

      if (type === 'cleaning' && onExportCleaningExcel) {
        const blob = await onExportCleaningExcel({ includeMacroSync });
        if (!blob) { alert('내보낼 데이터가 없습니다.'); return; }
        // 매크로 템플릿이 주입된 경우 .xlsm, 아니면 .xlsx
        // MIME 타입은 대소문자 구분 없음이 표준 — 브라우저가 Blob.type을 소문자로 정규화함
        const cleaningExt = blob.type.toLowerCase() === XLSM_MIME.toLowerCase() ? 'xlsm' : 'xlsx';
        downloadBlob(blob, buildSafeFilename(surveyTitle, 'Cleaning', cleaningExt));
      } else {
        // Server-side API Export
        const response = await fetch(`/api/surveys/${surveyId}/export?type=${type}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error || '내보내기에 실패했습니다.');
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        const ext = type === 'sav' ? 'sav' : 'xlsx';
        let filename = buildSafeFilename(surveyTitle, 'Export', ext);
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
          if (filenameMatch) filename = decodeURIComponent(filenameMatch[1]);
        }
        downloadBlob(blob, filename);
      }

      // 다운로드 후 모달 닫기 여부는 선택사항 (연속 다운로드를 위해 유지)
    } catch (error) {
      console.error('Export error:', error);
      alert(error instanceof Error ? error.message : '데이터 내보내기 중 오류가 발생했습니다.');
    } finally {
      setExportingType(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          엑셀 다운로드
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>데이터 내보내기</DialogTitle>
          <DialogDescription>원하는 데이터 형식을 선택하여 다운로드하세요.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-4">
          {/* Raw Data 추출 (주 내보내기) */}
          <ExportCard
            title="Raw Data 엑셀"
            description="응답 내역 + 변수별 코드값 + 코딩북 (3시트)"
            icon={<FileSpreadsheet className="h-5 w-5 text-blue-600" />}
            isLoading={exportingType === 'raw'}
            disabled={!!exportingType}
            onClick={() => handleExport('raw')}
          />

          {/* 기존 내보내기 카드 — 추후 복원 대비 코드 보존 */}
          {false && (
            <>
              {/* 1. 통계분석용 (Semi-Long / Cleaning) */}
              {onExportCleaningExcel && (
                <div className="space-y-2">
                  <ExportCard
                    title="통계분석용"
                    description="테이블 문항을 클리닝하기 쉬운 형태로 변환합니다. 시트 간 필터 연동 활성화 시 .xlsm(매크로 포함) — 어느 시트에서 filter를 걸어도 VBA가 response_id를 모든 시트에 전파합니다. 수식이 없어 대용량에서도 빠름."
                    icon={<ClipboardCheck className="h-5 w-5 text-teal-600" />}
                    isLoading={exportingType === 'cleaning'}
                    disabled={!!exportingType}
                    onClick={() => handleExport('cleaning')}
                  />
                  <label className="flex items-start gap-2 rounded-md border border-dashed bg-slate-50 px-4 py-2 pl-16 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={includeMacroSync}
                      onChange={(e) => setIncludeMacroSync(e.target.checked)}
                      disabled={!!exportingType}
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
                    />
                    <span>
                      <span className="font-semibold">시트 간 필터 연동 (VBA 매크로)</span>
                      <span className="ml-1 text-slate-500">
                        — 한 시트에서 autofilter를 걸면 VBA가 보이는 <code className="rounded bg-slate-200 px-1">response_id</code> 집합을 모든 시트에 전파합니다.
                        체크 시 <code className="mx-1 rounded bg-slate-200 px-1">.xlsm</code>로 내보냄 (Excel에서 매크로 허용 필요).
                        무거운 수식을 사용하지 않아 대용량에서도 빠르게 열립니다.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {/* 2. SPSS .sav 네이티브 파일 */}
              <ExportCard
                title="SPSS .sav 파일"
                description="SPSS에서 바로 열 수 있는 네이티브 파일입니다. 변수 라벨, 값 라벨, 측정 수준이 포함됩니다."
                icon={<FileDown className="h-5 w-5 text-red-600" />}
                isLoading={exportingType === 'sav'}
                disabled={!!exportingType}
                onClick={() => handleExport('sav')}
              />

              {/* 3. 요약 리포트 (Summary) */}
              <ExportCard
                title="요약 리포트 (Summary)"
                description="문항별 응답 빈도와 비율(%)이 계산된 요약 리포트입니다."
                icon={<BarChart3 className="h-5 w-5 text-orange-600" />}
                isLoading={exportingType === 'summary'}
                disabled={!!exportingType}
                onClick={() => handleExport('summary')}
              />

              {/* 4. 코딩북 (Variable Map) */}
              <ExportCard
                title="코딩북 (Variable Map)"
                description="설문 문항 ID, 라벨, 보기 값 등에 대한 변수 정의서입니다."
                icon={<FileText className="h-5 w-5 text-gray-600" />}
                isLoading={exportingType === 'map'}
                disabled={!!exportingType}
                onClick={() => handleExport('map')}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ExportCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  isLoading: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ExportCard({ title, description, icon, isLoading, disabled, onClick }: ExportCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-slate-50">
      <div className="flex items-start gap-4">
        <div className="mt-1 rounded-md border bg-white p-2 shadow-sm">{icon}</div>
        <div className="space-y-1">
          <h4 className="text-sm leading-none font-semibold">{title}</h4>
          <p className="text-muted-foreground pr-4 text-sm">{description}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onClick} disabled={isLoading || disabled}>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '다운로드'}
      </Button>
    </div>
  );
}
