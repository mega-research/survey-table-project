'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';

import type { ParseExcelPreviewResult } from '@/features/contacts/domain/contact-upload';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactUploadMapping } from '@/db/schema/schema-types';
import { autoDetectPiiMapping, autoDetectSystemFields } from '@/lib/contacts/auto-detect';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_ROWS,
  validateXlsxFile,
} from '@/lib/contacts/upload-limits';
import { type PiiFieldType } from '@/lib/crypto/pii-fields';
import { formatBytes } from '@/lib/utils';
import { useIngestContacts, useParseExcelPreview } from '@/hooks/queries';

type Step = 'file' | 'mapping' | 'result';

interface UploadWizardProps {
  surveyId: string;
  /** 마법사 진입 시점의 기존 contact_targets 행 수. 0 이면 신규, > 0 이면 통째 교체 경고 */
  existingContactsCount: number;
}

interface MappingState {
  /** 분류 기준 컬럼 인덱스 (선택사항 — null 가능) */
  groupCol: number | null;
  /** 조사 대상 목록에 표시할 헤더 set */
  selectedAttrs: Set<string>;
  /** 사용자 편집 라벨 (헤더명 → 라벨) */
  labelOverrides: Record<string, string>;
  /** 헤더명 → PII 타입 매핑 */
  piiMapping: Record<string, PiiFieldType>;
}

const PII_OPTIONS: Array<{ value: PiiFieldType | '_none'; label: string }> = [
  { value: '_none', label: '없음' },
  { value: 'email', label: '이메일' },
  { value: 'mobile', label: '휴대폰' },
  { value: 'phone', label: '전화' },
  { value: 'name', label: '이름' },
  { value: 'address', label: '주소' },
  { value: 'biz_number', label: '사업자번호' },
];

export function UploadWizard({ surveyId, existingContactsCount }: UploadWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headerRow, setHeaderRow] = useState(2);
  const [sheetName, setSheetName] = useState<string>('');
  const [preview, setPreview] = useState<ParseExcelPreviewResult | null>(null);
  const [mapping, setMapping] = useState<MappingState>({
    groupCol: null,
    selectedAttrs: new Set(),
    labelOverrides: {},
    piiMapping: {},
  });
  const [result, setResult] = useState<{
    uploadedRows: number;
    mergedRows: number;
    errorRows: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const parseExcelPreview = useParseExcelPreview();
  const ingestContacts = useIngestContacts();

  function selectFile(picked: File | null | undefined) {
    if (!picked) return;
    const err = validateXlsxFile(picked);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function handlePreview() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await parseExcelPreview.mutateAsync({ file, sheetName, headerRow });
        setPreview(r);
        if (!sheetName && r.sheetNames.length > 0) {
          const firstSheet = r.sheetNames[0];
          if (firstSheet) setSheetName(firstSheet);
        }

        const detected = autoDetectSystemFields(r.headers);
        const piiAuto = autoDetectPiiMapping(r.headers);

        // 디폴트 표시 토글:
        // - 자동 감지된 PII 컬럼 전부
        // - 분류 기준
        // - 그 외 처음 3개 (헤더가 너무 많을 때 시각적 노이즈 방지)
        const piiHeaders = new Set(Object.keys(piiAuto));
        const groupHeader = detected.group != null ? r.headers[detected.group] : null;
        const defaultShown = new Set<string>([
          ...piiHeaders,
          ...(groupHeader ? [groupHeader] : []),
          ...r.headers.filter((h) => !piiHeaders.has(h) && h !== groupHeader).slice(0, 3),
        ]);

        setMapping({
          groupCol: detected.group ?? null,
          selectedAttrs: defaultShown,
          labelOverrides: {}, // 사용자가 편집한 라벨만. 미편집은 헤더명 그대로 사용.
          piiMapping: piiAuto,
        });
        setReplaceConfirmed(false);
        setStep('mapping');
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function handleIngest() {
    if (!file || !preview) return;
    if (mapping.selectedAttrs.size === 0) {
      setError('표시할 컬럼이 없습니다. 최소 한 개는 체크해주세요.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const m: ContactUploadMapping = {
          systemFields: {
            ...(mapping.groupCol != null ? { group: mapping.groupCol } : {}),
          },
          piiMapping: mapping.piiMapping,
          selectedAttrsKeys: Array.from(mapping.selectedAttrs),
          labelOverrides: mapping.labelOverrides,
          headerRow,
          sheetName,
        };
        const r = await ingestContacts.mutateAsync({ surveyId, file, mapping: m });
        setResult({
          uploadedRows: r.uploadedRows,
          mergedRows: r.mergedRows,
          errorRows: r.errorRows,
        });
        // oRPC 전환으로 revalidatePath가 사라졌으므로, 목록 페이지의 RSC 캐시를
        // 명시적으로 무효화한다. result step에서 "목록 보기" push 시 fresh 로드 보장.
        router.refresh();
        setStep('result');
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function updatePii(header: string, value: PiiFieldType | '_none') {
    setMapping((m) => {
      const next = { ...m.piiMapping };
      if (value === '_none') delete next[header];
      else next[header] = value;
      return { ...m, piiMapping: next };
    });
  }

  function updateLabel(header: string, value: string) {
    setMapping((m) => {
      const next = { ...m.labelOverrides };
      if (value === header || value === '') delete next[header];
      else next[header] = value;
      return { ...m, labelOverrides: next };
    });
  }

  function toggleShown(header: string, checked: boolean) {
    setMapping((m) => {
      const next = new Set(m.selectedAttrs);
      if (checked) next.add(header);
      else next.delete(header);
      return { ...m, selectedAttrs: next };
    });
  }

  function setGroupCol(idx: number | null) {
    setMapping((m) => ({ ...m, groupCol: idx }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          엑셀 조사 대상 업로드 —{' '}
          {step === 'file' ? '1/3 파일' : step === 'mapping' ? '2/3 컬럼 설정' : '3/3 결과'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {step === 'file' && (
          <div className="space-y-5">
            <input
              ref={fileInputRef}
              id="excel-file"
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                selectFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  selectFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors ${
                  dragOver
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                  <UploadCloud className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium text-gray-900">
                  엑셀 파일을 끌어다 놓거나 클릭해서 선택
                </span>
                <span className="text-xs text-gray-500">
                  .xlsx · 최대 {formatBytes(MAX_UPLOAD_BYTES)} ·{' '}
                  {MAX_UPLOAD_ROWS.toLocaleString('ko-KR')}행
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <FileSpreadsheet className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
                  <div className="text-xs text-gray-500">{formatBytes(file.size)}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 text-gray-500 hover:text-red-600"
                  onClick={() => setFile(null)}
                  aria-label="파일 선택 취소"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="header-row">헤더 행 (1-based)</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="header-row"
                  type="number"
                  min={1}
                  max={10}
                  value={headerRow}
                  onChange={(e) => setHeaderRow(parseInt(e.target.value, 10) || 1)}
                  className="h-10 w-24 px-3 py-2 text-sm"
                />
                <span className="text-xs text-gray-500">병합 타이틀이 1행이면 디폴트 2 권장</span>
              </div>
            </div>

            <Button disabled={!file || isPending} onClick={handlePreview}>
              {isPending ? '파싱 중…' : '미리보기'}
            </Button>
          </div>
        )}

        {step === 'mapping' && preview && (
          <div className="space-y-4">
            {preview.sheetNames.length > 1 && (
              <div className="flex items-center gap-3">
                <Label>시트 선택</Label>
                <Select
                  value={sheetName}
                  onValueChange={(v) => {
                    setSheetName(v);
                    setPreview(null);
                    setStep('file');
                  }}
                >
                  <SelectTrigger className="w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.sheetNames.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 미리보기 (엑셀 첫 5행) */}
            <div>
              <div className="mb-1 text-xs text-slate-500">
                미리보기: 총 {preview.totalRows.toLocaleString('ko-KR')} 행 · 첫 5행
              </div>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {preview.headers.map((h, i) => (
                        <th key={i} className="border-b px-2 py-1 text-left whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri}>
                        {preview.headers.map((h, ci) => (
                          <td key={ci} className="border-b px-2 py-1 whitespace-nowrap">
                            {row[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 컬럼별 설정 매트릭스 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium text-slate-700">엑셀 헤더별 설정</div>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setMapping((m) => ({ ...m, selectedAttrs: new Set(preview.headers) }))
                    }
                    className="text-blue-600 hover:underline"
                  >
                    전체 표시
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapping((m) => ({ ...m, selectedAttrs: new Set() }))}
                    className="text-slate-500 hover:underline"
                  >
                    전체 숨김
                  </button>
                  <span className="text-slate-500">
                    {mapping.selectedAttrs.size}/{preview.headers.length} 표시
                  </span>
                </div>
              </div>
              <div className="overflow-hidden rounded border">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '28%' }} />
                    <col />
                    <col style={{ width: '170px' }} />
                    <col style={{ width: '60px' }} />
                    <col style={{ width: '80px' }} />
                  </colgroup>
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                        엑셀 헤더
                      </th>
                      <th className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                        표시 라벨
                      </th>
                      <th className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                        개인정보 (암호화)
                      </th>
                      <th className="border-b px-3 py-2 text-center font-medium whitespace-nowrap">
                        표시
                      </th>
                      <th className="border-b px-3 py-2 text-center font-medium whitespace-nowrap">
                        분류 기준
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.headers.map((h, i) => {
                      const pii = mapping.piiMapping[h];
                      const labelValue = mapping.labelOverrides[h] ?? h;
                      const isGroup = mapping.groupCol === i;
                      const isShown = mapping.selectedAttrs.has(h);
                      return (
                        <tr key={h} className="border-t hover:bg-slate-50/50">
                          <td
                            className="px-3 py-2 align-middle font-medium text-slate-700"
                            title={h}
                          >
                            <div className="truncate">{h}</div>
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              value={labelValue}
                              onChange={(e) => updateLabel(h, e.target.value)}
                              className="block w-full min-w-0 rounded border px-2 py-1 text-sm"
                              maxLength={100}
                              placeholder={h}
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <Select
                              value={pii ?? '_none'}
                              onValueChange={(v) => updatePii(h, v as PiiFieldType | '_none')}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PII_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <Checkbox
                              checked={isShown}
                              onCheckedChange={(checked) => toggleShown(h, checked === true)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <input
                              type="radio"
                              name="group-col"
                              checked={isGroup}
                              onChange={() => setGroupCol(i)}
                              className="h-4 w-4 cursor-pointer"
                              aria-label={`${h}을(를) 분류 기준으로 사용`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <div>개인정보로 지정된 컬럼은 암호화되어 별도 테이블에 저장됩니다.</div>
                <div>
                  분류 기준: 같은 값을 가진 행끼리 그룹으로 묶입니다 (예: 전시회명·단체 메일).
                  {mapping.groupCol != null && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => setGroupCol(null)}
                        className="text-blue-600 hover:underline"
                      >
                        선택 해제
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {existingContactsCount > 0 && (
              <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
                <div className="mb-2 font-semibold text-red-800">
                  ⚠ 기존 조사 대상 {existingContactsCount.toLocaleString('ko-KR')}건이 통째로 교체됩니다
                </div>
                <ul className="ml-4 list-disc space-y-1 text-red-700">
                  <li>기존 조사 대상 행 모두 삭제 후 신규 명단으로 교체</li>
                  <li>각 조사 대상의 회차 기록 (contact_attempts) 도 함께 삭제됨</li>
                  <li>각 조사 대상의 암호화된 개인정보도 함께 삭제됨</li>
                  <li>이미 발송된 초대 링크 모두 무효화</li>
                  <li>응답 본체는 보존되지만 조사 대상 매칭이 끊겨 익명 응답으로 표시됨</li>
                </ul>
                <label className="mt-3 flex items-center gap-2 text-red-800">
                  <Checkbox
                    checked={replaceConfirmed}
                    onCheckedChange={(checked) => setReplaceConfirmed(checked === true)}
                  />
                  <span>위 영향을 이해했고 진행에 동의합니다.</span>
                </label>
              </div>
            )}

            <Button
              disabled={isPending || (existingContactsCount > 0 && !replaceConfirmed)}
              onClick={handleIngest}
            >
              {isPending
                ? '적재 중…'
                : `${preview.totalRows.toLocaleString('ko-KR')} 행 적재 시작`}
            </Button>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-3">
            <div className="rounded border bg-slate-50 p-4 text-sm">
              <div>
                신규 적재: <strong>{result.uploadedRows.toLocaleString('ko-KR')}</strong> 행
              </div>
              <div>
                머지 갱신: <strong>{result.mergedRows.toLocaleString('ko-KR')}</strong> 행
              </div>
              <div>
                에러:{' '}
                <strong className={result.errorRows > 0 ? 'text-red-600' : ''}>
                  {result.errorRows.toLocaleString('ko-KR')}
                </strong>{' '}
                행
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  router.push(`/admin/surveys/${surveyId}/operations/contacts`)
                }
              >
                조사 대상 목록 보기
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep('file');
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                }}
              >
                다른 파일 업로드
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
