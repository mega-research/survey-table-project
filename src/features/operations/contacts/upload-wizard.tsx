'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';

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
import {
  useIngestContacts,
  useMatchContacts,
  useParseExcelPreview,
} from '@/features/operations/queries/use-contacts';
import { autoDetectPiiMapping, autoDetectSystemFields } from '@/features/operations/contacts/auto-detect';
import {
  GROUP_LEVELS,
  GROUP_LEVEL_LABELS,
  type GroupLevel,
  resolveGroupCriteria,
} from '@/lib/contacts/group-levels';
import { getSchemeRouting, suggestSimilarKeys } from '@/lib/contacts/match-contacts';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ROWS, validateXlsxFile } from '@/lib/contacts/upload-limits';
import { type PiiFieldType } from '@/lib/crypto/pii-fields';
import { getErrorMessage } from '@/lib/get-error-message';
import { formatBytes } from '@/lib/utils';
import type {
  ContactColumnDef,
  ContactColumnScheme,
  ContactUploadMapping,
  ContactUploadMode,
} from '@/shared/contracts/contacts';
import type {
  IngestContactUploadResult,
  MatchContactUploadResult,
  ParseExcelPreviewResult,
} from '@/shared/contracts/contacts-io';

import { UploadMatchStep } from './upload-match-step';

type Step = 'file' | 'mapping' | 'match' | 'result';

interface UploadWizardProps {
  surveyId: string;
  /** 마법사 진입 시점의 기존 contact_targets 행 수. 0 이면 신규, > 0 이면 통째 교체 경고 */
  existingContactsCount: number;
  /**
   * 이월 응답이 붙어 있는 조사 대상 수 (추적조사).
   * replace 는 조사 대상을 지우므로 이월 응답도 함께 사라진다 — 되돌릴 방법이 없다.
   */
  existingPriorAnswerCount: number;
  /** 기존 컬럼 스킴 — 병합/추가 모드의 컬럼 잠금·라우팅 표시 기준 */
  existingScheme: ContactColumnScheme | null;
}

interface MappingState {
  /**
   * 분류 기준 레벨 배정 (헤더명 → 1=대분류..4=세부분류). 레벨당 헤더 1개.
   * 대분류(1) 헤더가 group_value 소스를 겸한다 (buildMapping 에서 인덱스 동기화).
   */
  groupLevels: Record<string, GroupLevel>;
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

/**
 * 미리보기 헤더에서 매핑 초기값을 만든다.
 *
 * 원래 handlePreview 의 try 본문에 있던 순수 계산이다. React Compiler 는 try/catch
 * 본문의 value block(삼항·논리연산·conditional spread)을 낮추지 못해 컴포넌트 전체를
 * skip 하므로, 계산만 모듈 최상위로 옮긴다. 로직·순서·반환값은 그대로다.
 */
function buildInitialMapping(
  headers: string[],
  existingScheme: ContactColumnScheme | null,
  allHeaders: string[] = headers,
): MappingState {
  const detected = autoDetectSystemFields(headers);
  // PII 자동 감지는 숨겨진 열까지 본다 — 숨겨진 열을 나중에 포함으로 돌려도
  // 이메일·전화 열이 평문 컬럼으로 시작하지 않게 한다.
  const piiAuto = autoDetectPiiMapping(allHeaders);

  // 디폴트 표시 토글:
  // - 자동 감지된 PII 컬럼 전부
  // - 분류 기준
  // - 그 외 처음 3개 (헤더가 너무 많을 때 시각적 노이즈 방지)
  const piiHeaders = new Set(Object.keys(piiAuto));
  const groupHeader = detected.group != null ? headers[detected.group] : null;
  const defaultShown = new Set<string>([
    ...piiHeaders,
    ...(groupHeader ? [groupHeader] : []),
    ...headers.filter((h) => !piiHeaders.has(h) && h !== groupHeader).slice(0, 3),
  ]);

  // 레벨 초기값: 기존 스킴 배정 우선 (merge/append 재업로드), 없으면 자동 감지
  // 그룹 헤더를 대분류(1)로.
  const existingLevels = Object.fromEntries(
    resolveGroupCriteria(existingScheme)
      .filter((c) => headers.includes(c.key))
      .map((c) => [c.key, c.level]),
  );
  const initialLevels: Record<string, GroupLevel> =
    Object.keys(existingLevels).length > 0
      ? existingLevels
      : groupHeader
        ? { [groupHeader]: 1 }
        : {};

  return {
    groupLevels: initialLevels,
    selectedAttrs: defaultShown,
    labelOverrides: {}, // 사용자가 편집한 라벨만. 미편집은 헤더명 그대로 사용.
    piiMapping: piiAuto,
  };
}

/** 숨겨진 열 안내에 이름을 몇 개까지 적을지 */
const HIDDEN_HEADER_SAMPLE = 6;

interface HiddenChoiceProps {
  title: string;
  detail: string;
  /** true = 빼기 */
  skip: boolean;
  onChange: (skip: boolean) => void;
  skipTitle: string;
  skipDesc: string;
  includeTitle: string;
  includeDesc: string;
}

/** 엑셀에서 숨겨진 행·열을 뺄지 포함할지 고르는 한 줄. */
function HiddenChoice({
  title,
  detail,
  skip,
  onChange,
  skipTitle,
  skipDesc,
  includeTitle,
  includeDesc,
}: HiddenChoiceProps) {
  const options = [
    { value: true, title: skipTitle, desc: skipDesc },
    { value: false, title: includeTitle, desc: includeDesc },
  ];
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-amber-900">{title}</div>
      <div className="text-xs break-keep text-amber-800">{detail}</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={skip === opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              skip === opt.value
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-semibold text-gray-900">{opt.title}</div>
            <div className="mt-0.5 text-xs text-gray-500">{opt.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 시트가 아직 선택되지 않았을 때만 첫 시트명을 돌려준다(선택돼 있으면 null). */
function pickInitialSheetName(current: string, sheetNames: string[]): string | null {
  if (current) return null;
  return sheetNames[0] ?? null;
}

export function UploadWizard({
  surveyId,
  existingContactsCount,
  existingPriorAnswerCount,
  existingScheme,
}: UploadWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headerRow, setHeaderRow] = useState(2);
  const [sheetName, setSheetName] = useState<string>('');
  const [preview, setPreview] = useState<ParseExcelPreviewResult | null>(null);
  // 엑셀에서 숨겨진 행(필터로 걸러졌거나 손으로 숨긴 행)을 빼고 적재할지 — 숨겨진 행이 있을 때만 묻는다
  const [skipHiddenRows, setSkipHiddenRows] = useState(true);
  // 엑셀에서 숨겨진 열을 빼고 적재할지 — 숨겨진 열이 있을 때만 묻는다
  const [skipHiddenColumns, setSkipHiddenColumns] = useState(true);
  const [mapping, setMapping] = useState<MappingState>({
    groupLevels: {},
    selectedAttrs: new Set(),
    labelOverrides: {},
    piiMapping: {},
  });
  // 업로드 모드: replace(전체 교체) | merge(키 일치 갱신) | append(신규 추가)
  const [mode, setMode] = useState<ContactUploadMode>('replace');
  // append 모드에서 기존 명단과 중복 검사 여부
  const [dupCheck, setDupCheck] = useState(false);
  // merge/append+중복검사 시 매칭 키로 사용할 헤더 set
  const [mergeKeys, setMergeKeys] = useState<Set<string>>(new Set());
  // merge: 키 불일치 행 처리 정책 / append+중복검사: 키 일치(중복) 행 처리 정책
  const [unmatchedPolicy, setUnmatchedPolicy] = useState<'insert' | 'skip'>('skip');
  const [duplicatePolicy, setDuplicatePolicy] = useState<'insert' | 'skip'>('skip');
  // 매칭 미리보기(dry-run) 결과 — match 스텝 진입 시 채워짐
  const [matchResult, setMatchResult] = useState<MatchContactUploadResult | null>(null);
  const [result, setResult] = useState<IngestContactUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const parseExcelPreview = useParseExcelPreview();
  const ingestContacts = useIngestContacts();
  const matchContacts = useMatchContacts();

  const schemeRouting = useMemo(() => getSchemeRouting(existingScheme), [existingScheme]);
  /** 기존 스킴에 등록된 컬럼 (잠금 대상). key → 스킴 정의 */
  const lockedColumns = useMemo(() => {
    const map = new Map<string, ContactColumnDef>();
    for (const col of existingScheme?.columns ?? []) {
      if (col.source.startsWith('attrs.') || col.source.startsWith('pii.')) map.set(col.key, col);
    }
    return map;
  }, [existingScheme]);
  const isLockedMode = mode !== 'replace';
  /** 기존 스킴의 레벨 배정 (legacy groupBy 포함 해석) — 잠금 모드 표시·제출용 */
  const existingLevelByKey = useMemo(
    () => new Map(resolveGroupCriteria(existingScheme).map((c) => [c.key, c.level])),
    [existingScheme],
  );
  const needsKeySelection = mode === 'merge' || (mode === 'append' && dupCheck);
  // merge 모드는 항상, append 모드는 중복 검사 on 일 때만 매칭 미리보기 스텝을 거친다.
  const needsMatchStep = needsKeySelection;

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
        const nextSheetName = pickInitialSheetName(sheetName, r.sheetNames);
        if (nextSheetName) setSheetName(nextSheetName);

        // 숨겨진 열은 기본으로 뺀다 — 기본 표시·분류 기준도 보이는 열에서 고른다.
        const hidden = new Set(r.hiddenHeaders);
        setMapping(
          buildInitialMapping(
            r.headers.filter((h) => !hidden.has(h)),
            existingScheme,
            r.headers,
          ),
        );
        setReplaceConfirmed(false);
        setSkipHiddenRows(true);
        setSkipHiddenColumns(true);
        setMode('replace');
        setDupCheck(false);
        setMergeKeys(new Set());
        setMatchResult(null);
        setStep('mapping');
      } catch (e) {
        setError(getErrorMessage(e, ''));
      }
    });
  }

  const hiddenRowCount = preview?.hiddenRows ?? 0;
  const excludesHiddenRows = hiddenRowCount > 0 && skipHiddenRows;
  /** 실제로 적재될 행 수 — 숨겨진 행을 빼기로 했으면 그만큼 줄어든다 */
  const effectiveRowCount = (preview?.totalRows ?? 0) - (excludesHiddenRows ? hiddenRowCount : 0);

  const hiddenHeaders = preview?.hiddenHeaders ?? [];
  const excludesHiddenColumns = hiddenHeaders.length > 0 && skipHiddenColumns;
  /**
   * 실제로 적재될 열 — 숨겨진 열을 빼기로 했으면 보이는 열만.
   * 매핑 상태(표시·개인정보·분류·라벨)는 전체 헤더 기준으로 쥐고 있고, 화면과 제출은
   * 이 목록으로 걸러 쓴다. 그래야 빼기·포함을 오가도 손본 설정이 남는다.
   */
  const activeHeaders = excludesHiddenColumns
    ? (preview?.headers ?? []).filter((h) => !hiddenHeaders.includes(h))
    : (preview?.headers ?? []);
  const shownCount = activeHeaders.filter((h) => mapping.selectedAttrs.has(h)).length;

  function buildMapping(): ContactUploadMapping {
    // 레벨 배정 확정:
    // - replace: 마법사 select 상태 그대로.
    // - merge/append(잠금): 기존 스킴 배정을 파일 헤더 교집합으로 재구성 — UI 잠금과
    //   무관하게 상태 드리프트(모드 전환 등)가 스킴·group_value 를 갈라놓지 못하게 한다.
    const effectiveLevels: Record<string, GroupLevel> = isLockedMode
      ? Object.fromEntries(
          Array.from(existingLevelByKey.entries()).filter(([key]) =>
            activeHeaders.includes(key),
          ),
        )
      : Object.fromEntries(
          Object.entries(mapping.groupLevels).filter(([key]) => activeHeaders.includes(key)),
        );
    // 대분류(1) 헤더 = group_value 소스 — 레거시 systemFields.group 인덱스로 동기화
    const level1Header = Object.entries(effectiveLevels).find(([, l]) => l === 1)?.[0];
    // 서버는 읽은 열(= activeHeaders)의 순서로 인덱스를 푼다.
    const groupIdx = level1Header != null ? activeHeaders.indexOf(level1Header) : -1;
    return {
      systemFields: { ...(groupIdx >= 0 ? { group: groupIdx } : {}) },
      ...(Object.keys(effectiveLevels).length > 0 ? { groupLevels: effectiveLevels } : {}),
      piiMapping: Object.fromEntries(
        Object.entries(mapping.piiMapping).filter(([key]) => activeHeaders.includes(key)),
      ),
      selectedAttrsKeys: activeHeaders.filter((h) => mapping.selectedAttrs.has(h)),
      labelOverrides: mapping.labelOverrides,
      headerRow,
      sheetName,
      ...(hiddenRowCount > 0 ? { skipHiddenRows } : {}),
      ...(hiddenHeaders.length > 0 ? { skipHiddenColumns } : {}),
      mode,
      ...(needsKeySelection ? { mergeKeys: Array.from(mergeKeys) } : {}),
      ...(mode === 'merge' ? { unmatchedPolicy } : {}),
      ...(mode === 'append' && dupCheck ? { duplicatePolicy } : {}),
    };
  }

  async function handleMatchPreview() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await matchContacts.mutateAsync({ surveyId, file, mapping: buildMapping() });
        setMatchResult(r);
        setStep('match');
      } catch (e) {
        setError(getErrorMessage(e, ''));
      }
    });
  }

  async function handleIngest() {
    if (!file || !preview) return;
    if (shownCount === 0) {
      setError('표시할 컬럼이 없습니다. 최소 한 개는 체크해주세요.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await ingestContacts.mutateAsync({ surveyId, file, mapping: buildMapping() });
        setResult(r);
        // oRPC 전환으로 revalidatePath가 사라졌으므로, 목록 페이지의 RSC 캐시를
        // 명시적으로 무효화한다. result step에서 "목록 보기" push 시 fresh 로드 보장.
        router.refresh();
        setStep('result');
      } catch (e) {
        setError(getErrorMessage(e, ''));
      }
    });
  }

  function updatePii(header: string, value: PiiFieldType | '_none') {
    setMapping((m) => {
      const next = { ...m.piiMapping };
      if (value === '_none') delete next[header];
      else next[header] = value;
      // PII 컬럼은 분류 기준 불가 — 남아있는 레벨 배정을 함께 제거 (숨은 상태 방지)
      const nextLevels = { ...m.groupLevels };
      if (value !== '_none') delete nextLevels[header];
      return { ...m, piiMapping: next, groupLevels: nextLevels };
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

  /** 레벨 배정 — 레벨당 헤더 1개 (이미 쓰인 레벨을 고르면 기존 헤더에서 해제). */
  function setHeaderGroupLevel(header: string, level: GroupLevel | null) {
    setMapping((m) => {
      const next: Record<string, GroupLevel> = {};
      for (const [h, l] of Object.entries(m.groupLevels)) {
        if (h === header) continue;
        if (level != null && l === level) continue;
        next[h] = l;
      }
      if (level != null) next[header] = level;
      return { ...m, groupLevels: next };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {(() => {
            const total = needsMatchStep ? 4 : 3;
            const stepNo =
              step === 'file' ? 1 : step === 'mapping' ? 2 : step === 'match' ? 3 : total;
            const stepLabel =
              step === 'file'
                ? '파일'
                : step === 'mapping'
                  ? '컬럼 설정'
                  : step === 'match'
                    ? '매칭 미리보기'
                    : '결과';
            return `엑셀 조사 대상 업로드 — ${stepNo}/${total} ${stepLabel}`;
          })()}
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
            {existingContactsCount > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">업로드 방식</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'replace', title: '교체', desc: '기존 명단 전체 삭제 후 새로 적재' },
                      { value: 'merge', title: '병합', desc: '키 일치 행만 갱신, 이력·링크 보존' },
                      { value: 'append', title: '추가', desc: '기존 명단 유지, 신규 행 추가' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setMode(opt.value);
                        setMergeKeys(new Set());
                      }}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        mode === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900">{opt.title}</div>
                      <div className="mt-0.5 text-xs text-gray-500">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {mode === 'append' && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={dupCheck}
                      onCheckedChange={(c) => {
                        setDupCheck(c === true);
                        setMergeKeys(new Set());
                      }}
                    />
                    <span>기존 명단과 중복 검사 (키 컬럼 선택)</span>
                  </label>
                )}
              </div>
            )}

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

            {(hiddenRowCount > 0 || hiddenHeaders.length > 0) && (
              <div className="space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                {hiddenRowCount > 0 && (
                  <HiddenChoice
                    title={`엑셀에 숨겨진 행이 ${hiddenRowCount.toLocaleString('ko-KR')}개 있습니다`}
                    detail={`필터로 걸러졌거나 숨기기 한 행입니다. 전체 ${preview.totalRows.toLocaleString('ko-KR')}행 중 엑셀 화면에 보이는 행은 ${(preview.totalRows - hiddenRowCount).toLocaleString('ko-KR')}행입니다.`}
                    skip={skipHiddenRows}
                    onChange={setSkipHiddenRows}
                    skipTitle="숨겨진 행 빼기"
                    skipDesc={`보이는 ${(preview.totalRows - hiddenRowCount).toLocaleString('ko-KR')}행만 적재`}
                    includeTitle="숨겨진 행 포함"
                    includeDesc={`전체 ${preview.totalRows.toLocaleString('ko-KR')}행 적재`}
                  />
                )}
                {hiddenHeaders.length > 0 && (
                  <HiddenChoice
                    title={`엑셀에 숨겨진 열이 ${hiddenHeaders.length.toLocaleString('ko-KR')}개 있습니다`}
                    detail={`${hiddenHeaders.slice(0, HIDDEN_HEADER_SAMPLE).join(', ')}${
                      hiddenHeaders.length > HIDDEN_HEADER_SAMPLE
                        ? ` 외 ${(hiddenHeaders.length - HIDDEN_HEADER_SAMPLE).toLocaleString('ko-KR')}개`
                        : ''
                    }`}
                    skip={skipHiddenColumns}
                    onChange={(next) => {
                      setSkipHiddenColumns(next);
                      // 키로 고른 열이 빠질 수 있다 — 모드 전환과 같이 키 선택을 비운다.
                      setMergeKeys(new Set());
                    }}
                    skipTitle="숨겨진 열 빼기"
                    skipDesc={`보이는 ${(preview.headers.length - hiddenHeaders.length).toLocaleString('ko-KR')}개 열만 저장`}
                    includeTitle="숨겨진 열 포함"
                    includeDesc={`전체 ${preview.headers.length.toLocaleString('ko-KR')}개 열 저장`}
                  />
                )}
              </div>
            )}

            {/* 미리보기 (엑셀 첫 5행) */}
            <div>
              <div className="mb-1 text-xs text-slate-500">
                미리보기: 총 {effectiveRowCount.toLocaleString('ko-KR')} 행 · 첫 5행
                {excludesHiddenRows && ' (숨겨진 행 제외)'}
              </div>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {activeHeaders.map((h, i) => (
                        <th key={i} className="border-b px-2 py-1 text-left whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(excludesHiddenRows ? preview.visibleRows : preview.rows).map((row, ri) => (
                      <tr key={ri}>
                        {activeHeaders.map((h, ci) => (
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
                      setMapping((m) => ({
                        ...m,
                        selectedAttrs: new Set([...m.selectedAttrs, ...activeHeaders]),
                      }))
                    }
                    className="text-blue-600 hover:underline"
                  >
                    전체 표시
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMapping((m) => ({
                        ...m,
                        selectedAttrs: new Set(
                          Array.from(m.selectedAttrs).filter((h) => !activeHeaders.includes(h)),
                        ),
                      }))
                    }
                    className="text-slate-500 hover:underline"
                  >
                    전체 숨김
                  </button>
                  <span className="text-slate-500">
                    {shownCount}/{activeHeaders.length} 표시
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
                    {needsKeySelection && <col style={{ width: '70px' }} />}
                    <col style={{ width: '130px' }} />
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
                      {needsKeySelection && (
                        <th className="border-b px-3 py-2 text-center font-medium whitespace-nowrap">
                          매칭 키
                        </th>
                      )}
                      <th className="border-b px-3 py-2 text-center font-medium whitespace-nowrap">
                        분류 기준
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeHeaders.map((h) => {
                      const pii = mapping.piiMapping[h];
                      const labelValue = mapping.labelOverrides[h] ?? h;
                      const isShown = mapping.selectedAttrs.has(h);
                      const lockedCol = lockedColumns.get(h);
                      const isLocked = isLockedMode && Boolean(lockedCol);
                      const isPiiColumn = Boolean(lockedCol?.piiType ?? mapping.piiMapping[h]);
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
                              value={isLocked ? lockedCol!.label : labelValue}
                              onChange={(e) => updateLabel(h, e.target.value)}
                              disabled={isLocked}
                              className="block w-full min-w-0 rounded border px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                              maxLength={100}
                              placeholder={h}
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            {isLocked ? (
                              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                <span>
                                  {lockedCol!.piiType
                                    ? (PII_OPTIONS.find((opt) => opt.value === lockedCol!.piiType)
                                        ?.label ?? lockedCol!.piiType)
                                    : '없음'}
                                </span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                  기존 설정
                                </span>
                              </div>
                            ) : (
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
                            )}
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <Checkbox
                              checked={isLocked ? !lockedCol!.hidden : isShown}
                              disabled={isLocked}
                              onCheckedChange={(checked) => toggleShown(h, checked === true)}
                            />
                          </td>
                          {needsKeySelection && (
                            <td className="px-3 py-2 text-center align-middle">
                              <Checkbox
                                checked={mergeKeys.has(h)}
                                disabled={isPiiColumn}
                                onCheckedChange={(c) => {
                                  setMergeKeys((prev) => {
                                    const next = new Set(prev);
                                    if (c === true) next.add(h);
                                    else next.delete(h);
                                    return next;
                                  });
                                }}
                                aria-label={`${h}을(를) 매칭 키로 사용`}
                                title={
                                  isPiiColumn
                                    ? '개인정보 컬럼은 매칭 키로 사용할 수 없습니다'
                                    : undefined
                                }
                              />
                            </td>
                          )}
                          <td className="px-3 py-2 text-center align-middle">
                            {isLockedMode ? (
                              // merge/append 는 레벨 변경 불가 — 기존 배정 표시만.
                              // (변경은 업로드 후 컬럼 설정에서)
                              <div
                                className="text-xs text-slate-600"
                                title="병합·추가 업로드에서는 분류 기준을 바꿀 수 없습니다. 업로드 후 컬럼 설정에서 변경하세요."
                              >
                                {(() => {
                                  const lv = existingLevelByKey.get(h);
                                  return lv != null ? GROUP_LEVEL_LABELS[lv] : '—';
                                })()}
                              </div>
                            ) : isPiiColumn ? (
                              <span
                                className="text-slate-300"
                                title="개인정보 컬럼은 분류 기준으로 사용할 수 없습니다"
                              >
                                —
                              </span>
                            ) : (
                              <Select
                                value={
                                  mapping.groupLevels[h] != null
                                    ? String(mapping.groupLevels[h])
                                    : '_none'
                                }
                                onValueChange={(v) =>
                                  setHeaderGroupLevel(
                                    h,
                                    v === '_none' ? null : (Number(v) as GroupLevel),
                                  )
                                }
                              >
                                <SelectTrigger
                                  className="w-full"
                                  aria-label={`${h} 분류 기준 레벨`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_none">없음</SelectItem>
                                  {GROUP_LEVELS.map((l) => (
                                    <SelectItem key={l} value={String(l)}>
                                      {GROUP_LEVEL_LABELS[l]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
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
                  분류 기준: 컬럼을 대·중·소·세부분류 레벨에 배정하면 진척보고가 그 순서대로 조합
                  집계합니다 (레벨당 컬럼 1개, 1~2개만 배정해도 됩니다). 업로드 후 컬럼 설정에서
                  언제든 변경할 수 있습니다.
                </div>
              </div>
            </div>

            {needsKeySelection &&
              Array.from(mergeKeys)
                .filter((k) => !schemeRouting.knownAttrKeys.has(k))
                .map((k) => {
                  const similar = suggestSimilarKeys(k, Array.from(schemeRouting.knownAttrKeys));
                  return (
                    <div
                      key={k}
                      role="alert"
                      className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                      기존 명단에 &lsquo;{k}&rsquo; 컬럼 값이 없어 전부 불일치가 될 수 있습니다.
                      {similar.length > 0 && <> 비슷한 기존 컬럼: {similar.join(', ')}</>}
                    </div>
                  );
                })}

            {mode === 'replace' && existingContactsCount > 0 && (
              <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
                <div className="mb-2 font-semibold text-red-800">
                  ⚠ 기존 조사 대상 {existingContactsCount.toLocaleString('ko-KR')}건이 통째로
                  교체됩니다
                </div>
                <ul className="ml-4 list-disc space-y-1 text-red-700">
                  <li>기존 조사 대상 행 모두 삭제 후 신규 명단으로 교체</li>
                  <li>각 조사 대상의 회차 기록 (contact_attempts) 도 함께 삭제됨</li>
                  <li>각 조사 대상의 암호화된 개인정보도 함께 삭제됨</li>
                  <li>이미 발송된 초대 링크 모두 무효화</li>
                  {existingPriorAnswerCount > 0 && (
                    <li className="font-semibold">
                      이월 응답 {existingPriorAnswerCount.toLocaleString('ko-KR')}건도 함께
                      삭제됨 — 지난 회차 rawdata 를 다시 임포트해야 합니다
                    </li>
                  )}
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
              disabled={
                isPending ||
                (mode === 'replace' && existingContactsCount > 0 && !replaceConfirmed) ||
                (needsKeySelection && mergeKeys.size === 0)
              }
              onClick={needsMatchStep ? handleMatchPreview : handleIngest}
            >
              {isPending
                ? '처리 중…'
                : needsMatchStep
                  ? '매칭 확인'
                  : `${effectiveRowCount.toLocaleString('ko-KR')} 행 적재 시작`}
            </Button>
          </div>
        )}

        {step === 'match' && matchResult && (mode === 'merge' || mode === 'append') && (
          <UploadMatchStep
            mode={mode}
            result={matchResult}
            unmatchedPolicy={unmatchedPolicy}
            duplicatePolicy={duplicatePolicy}
            onUnmatchedPolicyChange={setUnmatchedPolicy}
            onDuplicatePolicyChange={setDuplicatePolicy}
            onBack={() => setStep('mapping')}
            onConfirm={handleIngest}
            isPending={isPending}
          />
        )}

        {step === 'result' && result && (
          <div className="space-y-3">
            <div className="rounded border bg-slate-50 p-4 text-sm">
              <div>
                신규 적재: <strong>{result.uploadedRows.toLocaleString('ko-KR')}</strong> 행
              </div>
              <div>
                갱신: <strong>{result.mergedRows.toLocaleString('ko-KR')}</strong> 행
              </div>
              {result.skippedRows > 0 && (
                <div>
                  제외: <strong>{result.skippedRows.toLocaleString('ko-KR')}</strong> 행
                  <span className="ml-1 text-xs text-slate-500">
                    (정책 {result.skippedBreakdown.policy} · 파일 내 중복{' '}
                    {result.skippedBreakdown.fileDuplicates} · 다중 일치{' '}
                    {result.skippedBreakdown.multiMatches} · 키 빈 값{' '}
                    {result.skippedBreakdown.emptyKeys})
                  </span>
                </div>
              )}
              {result.hiddenRowsExcluded > 0 && (
                <div>
                  숨겨진 행 제외:{' '}
                  <strong>{result.hiddenRowsExcluded.toLocaleString('ko-KR')}</strong> 행
                </div>
              )}
              {result.hiddenColumnsExcluded > 0 && (
                <div>
                  숨겨진 열 제외:{' '}
                  <strong>{result.hiddenColumnsExcluded.toLocaleString('ko-KR')}</strong> 개
                </div>
              )}
              <div>
                에러:{' '}
                <strong className={result.errorRows > 0 ? 'text-red-600' : ''}>
                  {result.errorRows.toLocaleString('ko-KR')}
                </strong>{' '}
                행
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/admin/surveys/${surveyId}/operations/contacts`)}>
                조사 대상 목록 보기
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep('file');
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                  setMatchResult(null);
                  setMergeKeys(new Set());
                  setMode('replace');
                  setDupCheck(false);
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
