'use client';

import { useMemo, useRef, useState } from 'react';

import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ImportPriorAnswersResult,
  SuggestPriorAnswerMappingResult,
} from '@/features/contacts/domain/prior-answers';
import { useImportPriorAnswers, useSuggestPriorAnswerMapping } from '@/hooks/queries';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import { getErrorMessage } from '@/lib/get-error-message';
import { formatBytes } from '@/lib/utils';

type Step = 'file' | 'mapping' | 'result';

/** 문항을 고르지 않았음을 나타내는 Select 값 — 빈 문자열은 Radix Select 가 허용하지 않는다. */
const UNMAPPED = '_unmapped';

interface Props {
  surveyId: string;
  /** 이월 응답이 이미 붙어 있는 조사 대상 수 — 0 보다 크면 재업로드 안내를 띄운다. */
  existingPriorAnswerCount: number;
  /** 지금 쓰기가 향하는 파티션이 테스트인가. 명단 업로드와 달리 막지 않고 알린다. */
  isTestScope: boolean;
}

export function PriorAnswerImportWizard({
  surveyId,
  existingPriorAnswerCount,
  isTestScope,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [preview, setPreview] = useState<SuggestPriorAnswerMappingResult | null>(null);
  const [residColumnKey, setResidColumnKey] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportPriorAnswersResult | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ImportPriorAnswersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggest = useSuggestPriorAnswerMapping();
  const runImport = useImportPriorAnswers();

  const questionById = useMemo(
    () => new Map((preview?.questions ?? []).map((q) => [q.id, q])),
    [preview],
  );

  const mappedCount = Object.keys(mapping).length;

  async function loadPreview(next: { file: File; sheetName?: string; headerRow?: number }) {
    setError(null);
    try {
      const res = await suggest.mutateAsync({
        surveyId,
        file: next.file,
        ...(next.sheetName ? { sheetName: next.sheetName } : {}),
        ...(next.headerRow ? { headerRow: next.headerRow } : {}),
      });
      setPreview(res);
      setSheetName(next.sheetName ?? res.sheetNames[0] ?? '');
      // 자동 제안을 초기 매핑으로 채운다 — 사람은 틀린 것만 고친다.
      const seeded: Record<string, string> = {};
      for (const s of res.suggestions) {
        if (s.questionId) seeded[s.columnKey] = s.questionId;
      }
      setMapping(seeded);
      // 시스템ID 열 자동 추정 — 확정은 사람이 한다.
      const residGuess = res.headers.find((h) => /resid|시스템\s*id|아이디|번호/i.test(h));
      setResidColumnKey((prev) => (prev && res.headers.includes(prev) ? prev : (residGuess ?? '')));
      setDryRunResult(null);
      setStep('mapping');
    } catch (err) {
      setError(getErrorMessage(err, '엑셀을 읽지 못했습니다.'));
    }
  }

  function handleFile(picked: File | null) {
    if (!picked) return;
    const invalid = validateXlsxFile(picked);
    if (invalid) {
      setError(invalid);
      return;
    }
    setFile(picked);
    setHeaderRow(1);
    void loadPreview({ file: picked });
  }

  async function run(dryRun: boolean) {
    if (!file || !residColumnKey) return;
    setError(null);
    try {
      const res = await runImport.mutateAsync({
        surveyId,
        file,
        sheetName,
        headerRow,
        residColumnKey,
        mapping,
        dryRun,
      });
      if (dryRun) {
        setDryRunResult(res);
      } else {
        setResult(res);
        setStep('result');
      }
    } catch (err) {
      setError(getErrorMessage(err, '이월 응답 적재에 실패했습니다.'));
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isTestScope && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          테스트 모드입니다 — 이월 응답이 <strong>테스트 조사 대상</strong>에게 붙습니다.
          실제 조사 대상에게 붙이려면 테스트 모드를 끄고 다시 오세요.
        </div>
      )}

      {step === 'file' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">지난 회차 rawdata 올리기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              지난 회차 응답 rawdata 엑셀(.xlsx)을 그대로 올립니다. 조사 대상 명단은 이미
              올라와 있어야 하며, 이 화면은 명단을 건드리지 않습니다 — 개별 링크와 이미
              수집된 응답은 그대로입니다.
            </p>
            {existingPriorAnswerCount > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                이미 {existingPriorAnswerCount.toLocaleString()}명에게 이월 응답이 붙어
                있습니다. 다시 올리면 이번 파일에서 값이 만들어진 대상만 통째로 교체됩니다.
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={suggest.isPending}>
              <UploadCloud className="mr-2 h-4 w-4" />
              {suggest.isPending ? '읽는 중...' : '엑셀 선택'}
            </Button>
            <p className="text-xs text-slate-500">
              최대 {formatBytes(MAX_UPLOAD_BYTES)} · {MAX_UPLOAD_ROWS.toLocaleString()}행
            </p>
          </CardContent>
        </Card>
      )}

      {step === 'mapping' && preview && file && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">시트와 헤더 행</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <FileSpreadsheet className="h-4 w-4" />
                {file.name}
                <button
                  type="button"
                  className="ml-1 text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setStep('file');
                  }}
                  aria-label="파일 지우기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="prior-sheet">시트</Label>
                  <Select
                    value={sheetName}
                    onValueChange={(next) => {
                      setSheetName(next);
                      void loadPreview({ file, sheetName: next, headerRow });
                    }}
                  >
                    <SelectTrigger id="prior-sheet">
                      <SelectValue placeholder="시트 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.sheetNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="prior-header-row">헤더 행</Label>
                  <Input
                    id="prior-header-row"
                    type="number"
                    min={1}
                    value={headerRow}
                    onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                    onBlur={() => void loadPreview({ file, sheetName, headerRow })}
                  />
                  <p className="text-xs text-slate-500">
                    통계표 시트가 섞인 파일이면 rawdata 시트와 헤더 행을 직접 짚어주세요.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="prior-resid">조사 대상을 찾을 열 (시스템ID)</Label>
                <Select value={residColumnKey || UNMAPPED} onValueChange={(v) => setResidColumnKey(v === UNMAPPED ? '' : v)}>
                  <SelectTrigger id="prior-resid">
                    <SelectValue placeholder="열 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED}>선택 안 함</SelectItem>
                    {preview.headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                컬럼과 문항 잇기 · {mappedCount}/{preview.headers.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                문항코드가 맞는 컬럼은 자동으로 이어져 있습니다. 틀린 것만 고치세요.
                복수응답·순위·표처럼 여러 컬럼을 먹는 문항은 이 화면에서 잇지 않습니다.
              </p>
              <div className="max-h-[28rem] overflow-y-auto rounded-md border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">엑셀 컬럼</th>
                      <th className="px-3 py-2">첫 행 값</th>
                      <th className="px-3 py-2">문항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.headers.map((header) => (
                      <tr key={header} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{header}</td>
                        <td className="px-3 py-2 text-slate-500">
                          {preview.rows[0]?.[header] ?? ''}
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={mapping[header] ?? UNMAPPED}
                            onValueChange={(next) =>
                              setMapping((prev) => {
                                const copy = { ...prev };
                                if (next === UNMAPPED) delete copy[header];
                                else copy[header] = next;
                                return copy;
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="잇지 않음" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNMAPPED}>잇지 않음</SelectItem>
                              {preview.questions.map((q) => (
                                <SelectItem key={q.id} value={q.id}>
                                  {q.questionCode ? `${q.questionCode} · ` : ''}
                                  {q.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {dryRunResult && (
                <ImportSummary
                  result={dryRunResult}
                  questionLabel={(id) => questionById.get(id)?.title ?? id}
                />
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => void run(true)}
                  disabled={!residColumnKey || runImport.isPending}
                >
                  실행 전 미리보기
                </Button>
                <Button
                  onClick={() => void run(false)}
                  disabled={!residColumnKey || mappedCount === 0 || runImport.isPending}
                >
                  {runImport.isPending ? '적재 중...' : '이월 응답 넣기'}
                </Button>
                {!residColumnKey && (
                  <span className="text-xs text-red-500">시스템ID 열을 먼저 고르세요</span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {step === 'result' && result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">적재 결과</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ImportSummary
              result={result}
              questionLabel={(id) => questionById.get(id)?.title ?? id}
            />
            <Button
              variant="outline"
              onClick={() => {
                setStep('file');
                setFile(null);
                setPreview(null);
                setResult(null);
              }}
            >
              다른 파일 올리기
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 실행 전 미리보기와 적재 결과가 같은 표를 쓴다 — 두 화면의 숫자가 어긋나지 않게. */
function ImportSummary({
  result,
  questionLabel,
}: {
  result: ImportPriorAnswersResult;
  questionLabel: (questionId: string) => string;
}) {
  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="시트에서 읽은 대상" value={result.parsedTargets} />
        <Stat label="명단에서 찾음" value={result.matched} />
        <Stat label="명단에 없음" value={result.unmatched} tone={result.unmatched > 0 ? 'warn' : 'plain'} />
        <Stat label="시스템ID 빈 행" value={result.emptyResidRows} tone={result.emptyResidRows > 0 ? 'warn' : 'plain'} />
      </div>

      {result.duplicateResidRows > 0 && (
        <p className="text-amber-800">
          같은 시스템ID 가 {result.duplicateResidRows.toLocaleString()}번 다시 나와 뒤 행이
          앞 행을 덮었습니다.
        </p>
      )}

      {result.unsupportedQuestionIds.length > 0 && (
        <p className="text-amber-800">
          이 화면에서 값을 넣을 수 없는 문항이라 건너뛴 매핑:{' '}
          {result.unsupportedQuestionIds.map(questionLabel).join(', ')}
        </p>
      )}

      {result.unmatchedResids.length > 0 && (
        <p className="text-slate-600">
          명단에서 찾지 못한 번호: {result.unmatchedResids.join(', ')}
          {result.unmatched > result.unmatchedResids.length && ' 외'}
        </p>
      )}

      {result.optionMismatches.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-amber-800">선택지에 맞지 않아 비운 값</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
            {result.optionMismatches.map((m) => (
              <li key={m.questionId}>
                {questionLabel(m.questionId)} — {m.unmatched}/{m.total}건 (
                {m.values.map((v) => `"${v.value}" ${v.count}건`).join(', ')})
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.questionsWithoutValues.length > 0 && (
        <p className="text-slate-600">
          이월 값이 하나도 들어가지 않은 문항:{' '}
          {result.questionsWithoutValues.map(questionLabel).join(', ')}
        </p>
      )}

      {result.unmappedColumns.length > 0 && (
        <p className="text-slate-600">잇지 않은 컬럼: {result.unmappedColumns.join(', ')}</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: number;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={tone === 'warn' ? 'font-semibold text-amber-700' : 'font-semibold text-gray-900'}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
