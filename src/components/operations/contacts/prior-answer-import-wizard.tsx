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
import {
  useImportPriorAnswers,
  useSavePriorAnswerImportConfig,
  useSuggestPriorAnswerMapping,
} from '@/hooks/queries';
import { normalizeQuestionCode } from '@/lib/contacts/prior-answer-blocks';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import { getErrorMessage } from '@/lib/get-error-message';
import { formatBytes } from '@/lib/utils';

type Step = 'file' | 'mapping' | 'result';

/** 문항을 고르지 않았음을 나타내는 Select 값 — 빈 문자열은 Radix Select 가 허용하지 않는다. */
const UNMAPPED = '_unmapped';

interface VerdictBadge {
  label: string;
  className: string;
}

const CONFLICT_BADGE_CLASS = 'border-red-200 bg-red-50 text-red-700';
const CANDIDATE_BADGE_CLASS = 'border-amber-200 bg-amber-50 text-amber-800';

const VERDICT_BADGE: Record<string, VerdictBadge | undefined> = {
  'code-conflict': {
    label: '코드는 같은데 문항 내용이 다릅니다 — 확인 필요',
    className: CONFLICT_BADGE_CLASS,
  },
  'value-conflict': {
    label: '코드는 같은데 값이 이 문항의 보기와 맞지 않습니다 — 확인 필요',
    className: CONFLICT_BADGE_CLASS,
  },
  'label-candidate': {
    label: '코드는 다른데 내용이 같습니다 — 확인 필요',
    className: CANDIDATE_BADGE_CLASS,
  },
};

/**
 * 값으로 이은 후보는 판정이 label-candidate 여도 문구가 다르다. 코드가 가리킨 문항이 있으면(코드 일치
 * 분기) 그것과 충돌한다는 뜻이고, 없으면(2026 에 없는 코드 IQ1.) 값으로만 찾은 것이라 존재하지 않는
 * "코드가 가리킨 문항" 을 말하지 않는다.
 */
const VALUE_CANDIDATE_BADGE: VerdictBadge = {
  label: '값이 이 문항의 보기와 맞습니다 — 코드가 가리킨 문항과 다르니 확인 필요',
  className: CANDIDATE_BADGE_CLASS,
};
const VALUE_ONLY_CANDIDATE_BADGE: VerdictBadge = {
  label: '값이 이 문항의 보기와 맞습니다 — 코드로는 잇지 못해 값으로 찾은 것이니 확인 필요',
  className: CANDIDATE_BADGE_CLASS,
};

function verdictBadge(block: {
  verdict: string;
  matchedBy: string | null;
  conflictQuestionId: string | null;
}): VerdictBadge | undefined {
  if (block.verdict === 'label-candidate' && block.matchedBy === 'value') {
    return block.conflictQuestionId ? VALUE_CANDIDATE_BADGE : VALUE_ONLY_CANDIDATE_BADGE;
  }
  return VERDICT_BADGE[block.verdict];
}

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
  const [headerRowCount, setHeaderRowCount] = useState(1);
  const [preview, setPreview] = useState<SuggestPriorAnswerMappingResult | null>(null);
  const [residColumnIndex, setResidColumnIndex] = useState<number | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportPriorAnswersResult | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ImportPriorAnswersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggest = useSuggestPriorAnswerMapping();
  const runImport = useImportPriorAnswers();
  const saveConfig = useSavePriorAnswerImportConfig();
  /** 문항 id → { 원본 값 → 선택지 저장값 }. 담당자가 그 자리에서 이어준 대응. */
  const [valueAliases, setValueAliases] = useState<Record<string, Record<string, string>>>({});

  const questionById = useMemo(
    () => new Map((preview?.questions ?? []).map((q) => [q.id, q])),
    [preview],
  );
  const questionTitle = (questionId: string) => questionById.get(questionId)?.title ?? questionId;
  const optionsByQuestion = useMemo(() => {
    const map: Record<string, Array<{ value: string; label: string }>> = {};
    for (const question of preview?.questions ?? []) map[question.id] = question.options;
    return map;
  }, [preview]);

  /** 안 맞은 원본 값을 선택지에 이어준다. 확정은 적재 시 함께 보관된다. */
  const setAlias = (questionId: string, rawValue: string, optionValue: string | null) => {
    setValueAliases((prev) => {
      const forQuestion = { ...(prev[questionId] ?? {}) };
      if (optionValue === null) delete forQuestion[rawValue];
      else forQuestion[rawValue] = optionValue;
      const next = { ...prev };
      if (Object.keys(forQuestion).length === 0) delete next[questionId];
      else next[questionId] = forQuestion;
      return next;
    });
  };

  const mappedCount = Object.keys(mapping).length;

  /** 컬럼 인덱스 → 화면에 보여줄 열 이름. 3단 헤더면 코드와 세부 라벨을 붙여 쓴다. */
  const columnLabels = useMemo(() => {
    if (!preview) return [];
    const width = Math.max(0, ...preview.headerRows.map((row) => row.length));
    return Array.from({ length: width }, (_, col) =>
      preview.headerRows
        .map((row) => (row[col] ?? '').trim())
        .filter(Boolean)
        .join(' · ') || `${col + 1}열`,
    );
  }, [preview]);

  async function loadPreview(next: { file: File; sheetName?: string; headerRowCount?: number }) {
    setError(null);
    try {
      const res = await suggest.mutateAsync({
        surveyId,
        file: next.file,
        ...(next.sheetName ? { sheetName: next.sheetName } : {}),
        ...(next.headerRowCount ? { headerRowCount: next.headerRowCount } : {}),
      });
      setPreview(res);
      setSheetName(next.sheetName ?? res.sheetNames[0] ?? '');
      // 자동 제안을 초기 매핑으로 채운다 — 사람은 틀린 것만 고친다.
      const seeded: Record<string, string> = {};
      res.blocks.forEach((block, index) => {
        if (block.questionId) seeded[String(index)] = block.questionId;
      });
      setMapping(seeded);
      // 보관된 값 대응을 되살린다. 시드하지 않으면 다음 세션에서 빈 상태로 시작해
      // "다시 올릴 때 재사용" 이 성립하지 않는다.
      setValueAliases(res.savedValueAliases);
      // 시스템ID 열 자동 추정 — 확정은 사람이 한다.
      const codeRow = res.headerRows[res.headerRows.length - 2] ?? res.headerRows[0] ?? [];
      const guess = codeRow.findIndex((text) => /resid|시스템\s*id|아이디|번호/i.test(text));
      setResidColumnIndex(guess >= 0 ? guess : 0);
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
    setHeaderRowCount(1);
    void loadPreview({ file: picked });
  }

  async function run(dryRun: boolean) {
    if (!file || residColumnIndex === null || !preview) return;
    setError(null);
    try {
      // 확정 보관은 **실행할 때만** 한다. 미리보기가 서버 설정을 바꾸면, 사람이 검토하지도
      // 않은 자동 제안이 확정으로 굳고 실행을 포기해도 남는다. 미리보기에서 이어준 값은
      // 요청에 실어 보내 저장 없이 결과에 반영한다.
      if (!dryRun) {
        const blockMappings: Record<string, { questionId: string; label: string }> = {};
        preview.blocks.forEach((block, index) => {
          const questionId = mapping[String(index)];
          if (!questionId) return;
          // 확정 시점의 문항 내용을 함께 남긴다 — 다음 파일에서 같은 코드가 다른 문항을
          // 가리키면 되살리지 않고 다시 묻기 위해서다.
          blockMappings[normalizeQuestionCode(block.code)] = { questionId, label: block.label };
        });
        await saveConfig.mutateAsync({ surveyId, blockMappings, valueAliases });
      }

      const res = await runImport.mutateAsync({
        surveyId,
        file,
        sheetName,
        headerRowCount,
        residColumnIndex,
        mapping,
        valueAliases,
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
                      void loadPreview({ file, sheetName: next, headerRowCount });
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
                  <Label htmlFor="prior-header-rows">헤더 행 수</Label>
                  <Input
                    id="prior-header-rows"
                    type="number"
                    min={1}
                    max={3}
                    value={headerRowCount}
                    onChange={(e) =>
                      setHeaderRowCount(Math.min(3, Math.max(1, Number(e.target.value) || 1)))
                    }
                    onBlur={() => void loadPreview({ file, sheetName, headerRowCount })}
                  />
                  <p className="text-xs text-slate-500">
                    3 을 넣으면 파트 행 / 문항코드 행 / 세부 라벨 행 3단 병합 헤더로 읽습니다.
                    통계표 시트가 섞인 파일이면 rawdata 시트를 직접 짚어주세요.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="prior-resid">조사 대상을 찾을 열 (시스템ID)</Label>
                <Select
                  value={residColumnIndex === null ? UNMAPPED : String(residColumnIndex)}
                  onValueChange={(v) => setResidColumnIndex(v === UNMAPPED ? null : Number(v))}
                >
                  <SelectTrigger id="prior-resid">
                    <SelectValue placeholder="열 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED}>선택 안 함</SelectItem>
                    {columnLabels.map((label, col) => (
                      <SelectItem key={col} value={String(col)}>
                        {label}
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
                문항 블록 잇기 · {mappedCount}/{preview.blocks.length}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-600">
                문항코드 행이 가로 병합된 구간이 한 문항의 컬럼 블록입니다. 코드가 맞는
                블록은 자동으로 이어져 있고, 표 칸·복수응답 보기·순위 자리까지 한 번에
                배정됩니다. 틀린 것만 고치세요.
              </p>
              <div className="max-h-[28rem] overflow-y-auto rounded-md border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">문항코드</th>
                      <th className="px-3 py-2">세부 라벨</th>
                      <th className="px-3 py-2">첫 행 값</th>
                      <th className="px-3 py-2">문항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.blocks.map((block, index) => {
                      const key = String(index);
                      const firstRow = preview.rows[0] ?? [];
                      const badge = block.fromSavedConfig ? undefined : verdictBadge(block);
                      return (
                        <tr key={key} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {block.code}
                            {block.columnIndexes.length > 1 && (
                              <span className="ml-1 text-xs font-normal text-slate-500">
                                {block.columnIndexes.length}칸
                              </span>
                            )}
                            {block.part && (
                              <div className="text-xs font-normal text-slate-400">{block.part}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {block.label || block.detailLabels.filter(Boolean).join(', ')}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {block.columnIndexes.map((col) => firstRow[col] ?? '').join(' / ')}
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={mapping[key] ?? UNMAPPED}
                              onValueChange={(next) =>
                                setMapping((prev) => {
                                  const copy = { ...prev };
                                  if (next === UNMAPPED) delete copy[key];
                                  else copy[key] = next;
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
                            {badge && (
                              <p className={`mt-1 rounded border px-2 py-1 text-xs ${badge.className}`}>
                                {badge.label}
                                {block.conflictQuestionId && (
                                  <>
                                    {' ('}
                                    코드가 가리킨 문항: {questionTitle(block.conflictQuestionId)}
                                    {')'}
                                  </>
                                )}
                              </p>
                            )}
                            {/* 배지가 없는 unmapped 에도 사유가 실린다 — 후보 여럿을 제목으로 못 가른 블록의
                                후보 목록이 그것이라, 배지에 묶으면 담당자가 고를 목록을 못 본다. */}
                            {block.verdictReason && (
                              <p className="mt-1 text-xs text-slate-500">{block.verdictReason}</p>
                            )}
                            {block.fromSavedConfig && (
                              <p className="mt-1 text-xs text-slate-500">지난 확정 그대로</p>
                            )}
                            {mapping[key] && (
                              <p className="mt-1 text-xs text-slate-500">
                                칸 배정: {block.slotLabels.join(' / ')}
                              </p>
                            )}
                            {mapping[key] && block.unmatchedSlots > 0 && (
                              <p className="mt-1 text-xs text-amber-700">
                                {block.unmatchedSlots}칸은 어느 자리인지 정하지 못했습니다 —
                                그 칸의 값은 들어가지 않습니다.
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {dryRunResult && (
                <ImportSummary
                  result={dryRunResult}
                  questionLabel={questionTitle}
                  aliases={valueAliases}
                  options={optionsByQuestion}
                  onAlias={setAlias}
                />
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => void run(true)}
                  disabled={residColumnIndex === null || runImport.isPending}
                >
                  실행 전 미리보기
                </Button>
                <Button
                  onClick={() => void run(false)}
                  disabled={residColumnIndex === null || mappedCount === 0 || runImport.isPending}
                >
                  {runImport.isPending ? '적재 중...' : '이월 응답 넣기'}
                </Button>
                {residColumnIndex === null && (
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
  aliases,
  options,
  onAlias,
}: {
  result: ImportPriorAnswersResult;
  questionLabel: (questionId: string) => string;
  /** 문항 id → { 원본 값 → 선택지 저장값 } */
  aliases?: Record<string, Record<string, string>>;
  /** 문항 id → 선택지 목록 (값 이어주기 드롭다운) */
  options?: Record<string, Array<{ value: string; label: string }>>;
  /** null 이면 대응을 지운다. 주지 않으면 이어주기 UI 를 띄우지 않는다(적재 결과 화면). */
  onAlias?: (questionId: string, rawValue: string, optionValue: string | null) => void;
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
        <div className="space-y-2">
          <p className="font-medium text-amber-800">
            선택지에 맞지 않아 비운 값 — 실패율이 높은 문항이 위에 있습니다
          </p>
          <ul className="space-y-2">
            {result.optionMismatches.map((m) => (
              <li
                key={m.questionId}
                className={`rounded border px-3 py-2 ${
                  m.rate >= 0.2
                    ? 'border-red-200 bg-red-50'
                    : 'border-amber-200 bg-amber-50/60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-gray-900">{questionLabel(m.questionId)}</span>
                  <span
                    className={m.rate >= 0.2 ? 'font-semibold text-red-700' : 'text-amber-800'}
                  >
                    {Math.round(m.rate * 100)}% 실패 · {m.unmatched}/{m.total}건
                  </span>
                </div>
                {m.rate >= 1 && m.total >= 5 && (
                  // 값이 한 건도 안 맞는 문항은 선택지 표기 차이가 아니라 **다른 문항**일 가능성이
                  // 높다 — 코드가 같은데 파트가 재편돼 내용이 바뀐 경우(2025 HQ1 과정 도움도 →
                  // 2026 HQ1 창업 의향). 코드 칸에 문항 내용이 없는 파일에서는 이 신호가 유일하다.
                  <p className="mt-1 text-xs font-semibold text-red-700">
                    한 건도 맞지 않습니다 — 코드는 같지만 다른 문항일 수 있습니다. 블록의 세부 라벨과
                    값을 문항 제목과 비교해 보세요.
                  </p>
                )}
                <ul className="mt-1 space-y-1">
                  {m.values.map((v) => (
                    <li key={v.value} className="flex flex-wrap items-center gap-2">
                      {/* 원본 값을 그대로 보여준다 — 담당자가 "아, 다소가 붙었구나" 를 알아본다. */}
                      <code className="rounded bg-white px-1.5 py-0.5 text-xs text-gray-900">
                        {v.value}
                      </code>
                      <span className="text-xs text-slate-500">{v.count}건</span>
                      {onAlias && (
                        <Select
                          value={aliases?.[m.questionId]?.[v.value] ?? UNMAPPED}
                          onValueChange={(next) =>
                            onAlias(m.questionId, v.value, next === UNMAPPED ? null : next)
                          }
                        >
                          <SelectTrigger className="h-7 w-56 text-xs">
                            <SelectValue placeholder="이 값을 어느 선택지로" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>잇지 않음</SelectItem>
                            {(options?.[m.questionId] ?? []).map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </li>
                  ))}
                </ul>
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
