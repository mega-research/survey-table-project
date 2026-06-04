'use client';

import { useState } from 'react';

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Sparkles,
  SplitSquareHorizontal,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

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

interface SplitCandidateDTO {
  questionId: string;
  code: string;
  label: string;
  type: string;
  refCount: number;
  buckets: number;
  maxVars: number;
  recommended: boolean;
  note: string;
}

interface SplitSheetDTO {
  token: string;
  name: string;
  vars: number;
  resp: number;
}

interface SplitPlanDTO {
  basisQuestionId: string;
  basisCode: string;
  basisLabel: string;
  common: number;
  sheets: SplitSheetDTO[];
  maxVars: number;
  exceedsSoftLimit: boolean;
  exceedsExcelLimit: boolean;
}

interface PreviewSummary {
  totalVars: number;
  softLimit: number;
  excelLimit: number;
  candidates: SplitCandidateDTO[];
}

const fmtNum = (n: number) => n.toLocaleString('ko-KR');

async function fetchSplitSummary(surveyId: string): Promise<PreviewSummary> {
  const res = await fetch(`/api/surveys/${surveyId}/export/split-preview`);
  if (!res.ok) throw new Error('미리보기 정보를 불러오지 못했습니다.');
  return res.json();
}

async function fetchSplitPlan(surveyId: string, basis: string): Promise<{ plan: SplitPlanDTO }> {
  const res = await fetch(
    `/api/surveys/${surveyId}/export/split-preview?basis=${encodeURIComponent(basis)}`,
  );
  if (!res.ok) throw new Error('시트 미리보기를 불러오지 못했습니다.');
  return res.json();
}

type SplitStep = 'options' | 'candidates' | 'preview' | 'downloading' | 'done';

export function ExportDataModal({ surveyId, surveyTitle, onExportCleaningExcel }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [includeMacroSync, setIncludeMacroSync] = useState(true);
  const [step, setStep] = useState<SplitStep>('options');
  const [basis, setBasis] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ['split-summary', surveyId],
    queryFn: () => fetchSplitSummary(surveyId),
    enabled: isOpen,
  });
  const overLimit = !!summary.data && summary.data.totalVars > summary.data.softLimit;

  const planQuery = useQuery({
    queryKey: ['split-plan', surveyId, basis],
    queryFn: () => fetchSplitPlan(surveyId, basis!),
    enabled: isOpen && !!basis && (step === 'preview' || step === 'downloading' || step === 'done'),
  });

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setStep('options');
      setBasis(null);
    }
  };

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

  const handleSplitDownload = async () => {
    if (!basis) return;
    setStep('downloading');
    try {
      const res = await fetch(
        `/api/surveys/${surveyId}/export?type=raw-split&basis=${encodeURIComponent(basis)}`,
      );
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || '분할 내보내기에 실패했습니다.');
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let filename = buildSafeFilename(surveyTitle, 'Split', 'xlsx');
      const m = cd?.match(/filename="?([^"]+)"?/);
      if (m) filename = decodeURIComponent(m[1]);
      downloadBlob(blob, filename);
      setStep('done');
    } catch (err) {
      alert(err instanceof Error ? err.message : '분할 내보내기 중 오류가 발생했습니다.');
      setStep('preview');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          엑셀 다운로드
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{step === 'options' ? '데이터 내보내기' : '분할 내보내기'}</DialogTitle>
          <DialogDescription>{surveyTitle}</DialogDescription>
        </DialogHeader>

        {step === 'options' && (
          <div className="grid grid-cols-1 gap-4 py-4">
            <ExportCard
              title="Raw Data 엑셀"
              description="응답 내역 + 변수별 코드값 + 코딩북 (3시트)"
              icon={<FileSpreadsheet className="h-5 w-5 text-blue-600" />}
              isLoading={exportingType === 'raw'}
              disabled={!!exportingType}
              onClick={() => handleExport('raw')}
            />

            {overLimit && summary.data && (
              <div className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4">
                <div className="flex gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600">
                    <AlertTriangle className="h-[18px] w-[18px]" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 text-sm font-bold text-amber-800">
                      변수가 {fmtNum(summary.data.totalVars)}개 — 한 시트에 담기 부담스러운 양입니다
                    </div>
                    <p className="text-[13px] leading-relaxed text-amber-700">
                      Excel 한 시트 열 한계는 {fmtNum(summary.data.excelLimit)}개입니다. 기준 문항으로 시트를 나누면 각 시트의 변수 수가 크게 줄어듭니다.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setStep('candidates')}
                  className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-blue-600 bg-blue-600 px-4 py-3 text-white"
                >
                  <span className="flex items-center gap-2.5">
                    <SplitSquareHorizontal className="h-[18px] w-[18px]" />
                    <span className="text-sm font-bold">분할 내보내기 설정</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px]" />
                </button>
              </div>
            )}

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
        )}

        {step === 'candidates' && (
          <div className="py-4">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span className="text-[13px] font-bold text-slate-800">추천 분할 기준</span>
            </div>
            <p className="mb-3.5 text-xs leading-relaxed text-slate-500">
              응답자 분기를 가르는 문항을 분석했습니다. 기준 문항의 값마다 시트가 하나씩 생성됩니다.
            </p>
            {summary.isLoading && <p className="text-sm text-slate-400">분석 중…</p>}
            {summary.isError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                {summary.error instanceof Error ? summary.error.message : '미리보기 정보를 불러오지 못했습니다.'}
              </p>
            )}
            {summary.data && summary.data.candidates.length === 0 && (
              <p className="rounded-lg border bg-slate-50 p-4 text-sm text-slate-500">
                분할 기준이 될 value-match 조건 문항이 없어 분할할 수 없습니다.
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              {summary.data?.candidates.map((c) => {
                const on = basis === c.questionId;
                const safe = c.maxVars <= summary.data!.softLimit;
                return (
                  <button
                    key={c.questionId}
                    onClick={() => setBasis(c.questionId)}
                    className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3.5 text-left transition-colors ${on ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <span
                      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${on ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'}`}
                    >
                      {on && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-0.5 flex items-center gap-1.5">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
                          {c.code || '—'}
                        </code>
                        <span className="text-sm font-bold text-slate-900">{c.label}</span>
                        {c.recommended && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                            권장
                          </span>
                        )}
                      </span>
                      <span className="block text-xs leading-snug text-slate-500">{c.note}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="mb-1 flex items-center justify-end gap-1">
                        <Layers className="h-3 w-3 text-slate-400" />
                        <span className="text-[13px] font-bold text-slate-700">{c.buckets}개 시트</span>
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${safe ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                      >
                        최대 {fmtNum(c.maxVars)}변수
                        {safe ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="py-4">
            {planQuery.isLoading && <p className="text-sm text-slate-400">시트 구성 계산 중…</p>}
            {planQuery.isError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                {planQuery.error instanceof Error ? planQuery.error.message : '시트 미리보기를 불러오지 못했습니다.'}
              </p>
            )}
            {planQuery.data &&
              (() => {
                const plan = planQuery.data.plan;
                const softLimit = summary.data?.softLimit ?? 10000;
                const excelLimit = summary.data?.excelLimit ?? 16384;
                return (
                  <>
                    <div className="mb-3.5 flex items-center gap-2 rounded-lg bg-blue-50 px-3.5 py-2.5">
                      <SplitSquareHorizontal className="h-4 w-4 text-blue-600" />
                      <span className="text-[13px] text-blue-800">
                        <b>
                          {plan.basisCode || '—'} {plan.basisLabel}
                        </b>{' '}
                        기준 · {plan.sheets.length}개 시트로 분할
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="grid grid-cols-[1fr_92px_110px_56px] items-center border-b border-slate-200 bg-slate-50">
                        <div className="px-3.5 py-2 text-[11px] font-bold text-slate-500">시트명</div>
                        <div className="px-3.5 py-2 text-right text-[11px] font-bold text-slate-500">
                          응답 수
                        </div>
                        <div className="px-3.5 py-2 text-right text-[11px] font-bold text-slate-500">
                          변수(열)
                        </div>
                        <div className="px-3.5 py-2 text-center text-[11px] font-bold text-slate-500">
                          상태
                        </div>
                      </div>
                      <div className="max-h-[196px] overflow-y-auto">
                        {plan.sheets.map((s) => {
                          const safe = s.vars <= softLimit;
                          const pct = Math.min(100, Math.round((s.vars / excelLimit) * 100));
                          return (
                            <div
                              key={s.token}
                              className="grid grid-cols-[1fr_92px_110px_56px] items-center border-b border-slate-100 last:border-0"
                            >
                              <div className="truncate px-3.5 py-2.5 text-[13px] font-semibold text-slate-900">
                                {s.name}
                              </div>
                              <div className="px-3.5 py-2.5 text-right text-[13px] tabular-nums text-slate-500">
                                {fmtNum(s.resp)}
                              </div>
                              <div className="px-3.5 py-2.5 text-right text-[13px] tabular-nums">
                                <div
                                  className={`font-bold ${safe ? 'text-slate-900' : 'text-red-700'}`}
                                >
                                  {fmtNum(s.vars)}
                                </div>
                                <div className="mt-1 h-[3px] overflow-hidden rounded bg-slate-100">
                                  <div
                                    className={`h-full ${safe ? 'bg-green-500' : 'bg-red-500'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <div className="px-3.5 py-2.5 text-center">
                                {safe ? (
                                  <Check className="mx-auto h-4 w-4 text-green-500" />
                                ) : (
                                  <AlertTriangle className="mx-auto h-[15px] w-[15px] text-red-500" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-3.5 text-xs text-slate-500">
                      <span>
                        공통 변수{' '}
                        <b className="text-slate-700">{fmtNum(plan.common)}</b>개는 별도 공통 시트로
                      </span>
                      <span className="ml-auto">
                        최대{' '}
                        <b
                          className={
                            plan.maxVars <= softLimit ? 'text-green-700' : 'text-red-700'
                          }
                        >
                          {fmtNum(plan.maxVars)}
                        </b>
                        변수
                      </span>
                    </div>
                    {plan.exceedsExcelLimit && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        일부 시트가 Excel 열 한계(16,384)를 초과합니다. 다른 기준을 선택하세요.
                      </div>
                    )}
                  </>
                );
              })()}
          </div>
        )}

        {(step === 'downloading' || step === 'done') && (
          <div className="px-6 py-10 text-center">
            <div
              className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full ${step === 'done' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-600'}`}
            >
              {step === 'done' ? (
                <Check className="h-8 w-8" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin" />
              )}
            </div>
            <div className="mb-1.5 text-[17px] font-bold">
              {step === 'done' ? '다운로드가 시작되었습니다' : '워크북 생성 중…'}
            </div>
            <p className="mx-auto max-w-[360px] text-[13px] leading-relaxed text-slate-500">
              {step === 'done'
                ? '브라우저 다운로드를 확인하세요.'
                : '기준 문항으로 시트를 나눠 생성하고 있습니다.'}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 'options' && (
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              닫기
            </Button>
          )}
          {step === 'candidates' && (
            <>
              <Button variant="ghost" onClick={() => setStep('options')}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                뒤로
              </Button>
              <Button onClick={() => setStep('preview')} disabled={!basis}>
                시트 미리보기
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="ghost" onClick={() => setStep('candidates')}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                기준 변경
              </Button>
              <Button
                onClick={handleSplitDownload}
                disabled={!planQuery.data || !!planQuery.data?.plan.exceedsExcelLimit}
              >
                <FileDown className="mr-1 h-4 w-4" />
                분할 다운로드
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => { setStep('options'); setBasis(null); }}>완료</Button>
          )}
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
