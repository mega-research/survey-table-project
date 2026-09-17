'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { ExternalLink, Loader2 } from 'lucide-react';

import { getErrorMessage } from '@/lib/get-error-message';
import { mapStatusPill } from '@/lib/operations/profiles-format';
import { cn } from '@/lib/utils';
import { CONTACT_METHOD_LABEL, type ContactMethod } from '@/shared/contracts/contacts';
import type { FieldworkContactRow, FieldworkContactsPage } from '@/shared/contracts/workspace-io';
import { client } from '@/shared/lib/rpc';

/** 드롭다운 선택지 — 라벨 표의 키가 어휘 자체다(따로 배열을 두면 둘이 갈린다). */
const CONTACT_METHOD_VALUES = Object.keys(CONTACT_METHOD_LABEL) as ContactMethod[];

/** 주소가 들고 있는 필터 — 서버가 읽어 넘긴다(클라이언트가 location 을 다시 파싱하지 않는다). */
export interface ContactFilters {
  q: string;
  group: string;
  result: string;
}

interface Props {
  surveyId: string;
  page: FieldworkContactsPage;
  filters: ContactFilters;
  /**
   * 결과코드·메모를 남길 수 있는가 — **본인이 초대된 설문에서만** 참이다.
   *
   * 팀장의 파생 시야에서는 false 이고 「결과 기록」 버튼이 아예 그려지지 않는다. 강제는
   * 서버 관문(`contacts.writeAttempts`)이 하고, 여기는 눌러도 거부되는 버튼을 안 만드는
   * 것이 목적이다.
   */
  canWriteAttempts: boolean;
}

/**
 * 실사 조사 대상 표 (.pen FLOW 10-2, 역할 모델 v2 티켓 26).
 *
 * **운영 콘솔의 표를 쓰지 않는다.** 게스트 콘솔이 표를 새로 짠 것과 같은 이유다 — 저쪽
 * 표는 헤더 필터 팝오버가 RPC 를 당기고 컬럼 스킴 편집·업로드·메일 진입점을 함께 그린다.
 * 실사에게는 그 표면이 전부 차단이라, 안 그리는 것이 아니라 **없는** 표가 맞다.
 *
 * 셀에는 **복호된 원문**이 실려 온다(스펙 §6 결정). 게스트 표가 마스킹 힌트를 받는 자리와
 * 정확히 대칭이고, 그 차이가 두 콘솔의 정의다.
 *
 * 필터는 주소에 싣는다 — 새로고침·뒤로가기가 같은 화면을 주고, 서버가 페이지를 다시 그린다.
 */
export function FieldworkContactsTable({ surveyId, page, filters, canWriteAttempts }: Props) {
  const router = useRouter();
  const [recording, setRecording] = useState<FieldworkContactRow | null>(null);

  function navigate(patch: Record<string, string>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // 필터가 바뀌면 언제나 1페이지로 — 3페이지에서 좁히면 빈 화면이 나온다.
    if (!('page' in patch)) params.delete('page');
    router.push(`?${params.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <div className="space-y-3">
      <Toolbar page={page} filters={filters} onChange={navigate} />

      <div className="overflow-x-auto rounded-[11px] border border-[#E5E5EA] bg-white">
        <table className="w-full min-w-[860px]">
          <thead className="bg-[#F9FAFB]">
            <tr className="text-left text-[11.5px] font-medium text-[#9CA3AF]">
              {page.columns.map((column) => (
                <th key={column.key} className="px-4 py-3 font-medium whitespace-nowrap">
                  {column.label}
                </th>
              ))}
              <th className="px-3 py-3 font-medium whitespace-nowrap">그룹</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">최근 결과</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">시도</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">응답 상태</th>
              <th className="px-3 py-3 font-medium">
                <span className="sr-only">액션</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.contactTargetId} className="border-t border-[#E5E5EA]">
                {row.cells.map((cell, index) => (
                  <td
                    key={page.columns[index]?.key ?? index}
                    className="px-4 py-3 text-[12.5px] whitespace-nowrap text-[#1C1C1E]"
                  >
                    {cell ?? '—'}
                  </td>
                ))}
                <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">{row.groupValue ?? '—'}</td>
                <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">
                  {row.latestResultCode ?? '—'}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-[#6E6E73]">{row.attemptCount}</td>
                <td className="px-3 py-3">
                  <StatusPill status={row.responseStatus} />
                </td>
                <td className="px-3 py-3">
                  <RowActions
                    surveyId={surveyId}
                    row={row}
                    canWriteAttempts={canWriteAttempts}
                    onRecord={() => setRecording(row)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {page.rows.length === 0 && (
          <p className="py-12 text-center text-[13px] text-[#9CA3AF]">
            조건에 맞는 조사 대상이 없습니다.
          </p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-[12.5px] text-[#6E6E73]">
          <button
            type="button"
            disabled={page.page <= 1}
            onClick={() => navigate({ page: String(page.page - 1) })}
            className="rounded-lg border border-[#E5E5EA] bg-white px-3 py-1 disabled:opacity-40"
          >
            이전
          </button>
          <span>
            {page.page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page.page >= totalPages}
            onClick={() => navigate({ page: String(page.page + 1) })}
            className="rounded-lg border border-[#E5E5EA] bg-white px-3 py-1 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {recording && (
        <RecordPanel
          surveyId={surveyId}
          row={recording}
          resultCodes={page.resultCodes}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            // 서버가 최신 회차·시도 수를 다시 그린다 — 낙관적 갱신을 두면 두 값의 정본이 갈린다.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Toolbar({
  page,
  filters,
  onChange,
}: {
  page: FieldworkContactsPage;
  filters: ContactFilters;
  onChange: (patch: Record<string, string>) => void;
}) {
  const { q: initialQuery, group, result } = filters;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          onChange({ q: typeof value === 'string' ? value.trim() : '' });
        }}
      >
        <input
          name="q"
          defaultValue={initialQuery}
          placeholder="이름·번호·전화번호 검색"
          className="h-8 w-[220px] rounded-[8px] border border-[#D1D5DB] bg-white px-3 text-[12px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none"
        />
      </form>

      <select
        aria-label="그룹 필터"
        value={group}
        onChange={(event) => onChange({ group: event.target.value })}
        className="h-8 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[12.5px] text-[#3A3A3C]"
      >
        <option value="">그룹 · 전체</option>
        {page.groups.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>

      <select
        aria-label="결과코드 필터"
        value={result}
        onChange={(event) => onChange({ result: event.target.value })}
        className="h-8 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[12.5px] text-[#3A3A3C]"
      >
        <option value="">결과코드 · 전체</option>
        {page.resultCodes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      {/* 진척 배지 — **필터와 무관한 설문 전체 수**다(.pen 툴바). 검색어를 넣었다고
          목표가 줄지 않는다. */}
      <span className="rounded-full bg-[#EEF2FF] px-3 py-1 text-[12px] font-semibold text-[#2743AE]">
        완료 {page.progress.completed} / 전체 {page.progress.total}
      </span>
    </div>
  );
}

/** 응답 상태 필 — 운영 콘솔과 같은 매핑을 쓴다(같은 응답이 화면마다 다른 말이 되면 안 된다). */
function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex rounded-full bg-[#F3F4F6] px-2 py-[3px] text-[11px] font-semibold text-[#6E6E73]">
        미응답
      </span>
    );
  }
  const pill = mapStatusPill({ status });
  return (
    <span className="inline-flex rounded-full bg-[#EEF2FF] px-2 py-[3px] text-[11px] font-semibold text-[#2743AE]">
      {pill.label}
    </span>
  );
}

/**
 * 행 액션 (.pen 10-2) — 「결과 기록」 + 「응답 대행」.
 *
 * 대행은 그 컨택의 초대 링크를 새 탭으로 연다. **완료된 대상은 비활성**이다(.pen 캡션).
 * 귀속 기록(fieldworkUserId)과 대행 배너는 티켓 27 이 붙인다 — 링크 자체는 지금도 살아
 * 있으므로 버튼이 거짓말을 하지는 않는다.
 *
 * `&fw=1` 은 **힌트일 뿐 권한이 아니다.** 응답 페이지가 대행 배너를 물을지 말지를 정할 뿐이고,
 * 누가 붙여도 서버는 세션을 보고 판정한다(`resolveFieldworkProxy`). 이 힌트가 없으면 응답자
 * 전원이 배너 조회를 한 번씩 하게 되어 「응답자 화면 diff 0」이 깨진다 — `?test=` 토큰과 같은
 * 자리의 장치다.
 *
 * **대행 버튼의 조건은 `canWriteAttempts` 가 아니라 토큰의 존재다.** 팀장의 파생 시야에서는
 * 서버 투영이 `inviteToken` 을 null 로 접으므로 여기서 감출 것이 애초에 없다 — 판정을 화면이
 * 다시 하면 두 곳이 갈릴 수 있고, 갈리는 쪽이 화면이면 링크가 살아난다.
 */
function RowActions({
  surveyId,
  row,
  canWriteAttempts,
  onRecord,
}: {
  surveyId: string;
  row: FieldworkContactRow;
  canWriteAttempts: boolean;
  onRecord: () => void;
}) {
  const completed = row.responseStatus === 'completed';
  const inProgress = row.responseStatus === 'in_progress';

  return (
    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
      {canWriteAttempts && (
        <button
          type="button"
          onClick={onRecord}
          className="rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[#374151] hover:bg-[#F5F5F7]"
        >
          결과 기록
        </button>
      )}
      {row.inviteToken === null ? null : completed ? (
        <span className="px-2.5 py-1 text-[11.5px] text-[#C7C7CC]">응답 완료</span>
      ) : (
        <a
          href={`/survey/${surveyId}?invite=${row.inviteToken}&fw=1`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 rounded-[8px] bg-[#2E4FCE] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#2743AE]"
        >
          {inProgress ? '이어서 대행' : '응답 대행'}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/**
 * 결과 기록 패널 (.pen 10-2 하단) — **두 개의 쓰기**가 나란히 산다.
 *
 * 위: 결과코드와 시도 메모가 **한 회차**로 쌓인다(`contact_attempts`). 작성자(실사 계정)는
 * 서버가 인증된 컨텍스트에서 남긴다 — 화면이 보내지 않으므로 위조할 수 없다.
 *
 * 아래: 컨택 행의 `memo`·`contactMethod` 를 **덮어쓴다**. 회차가 누적이라면 이쪽은 현재
 * 상태라 저장 버튼을 갈라 뒀다 — 한 버튼으로 묶으면 「메모만 고치려다 회차가 하나 더
 * 쌓이는」 일이 생기고, 두 표면이 서로 다른 테이블이라 부분 실패도 갈라 보여야 한다.
 * 명단(attrs·PII)은 여기서 못 고친다: 서버의 좁은 표면이 그 두 칸만 받는다(ADR-0019).
 */
function RecordPanel({
  surveyId,
  row,
  resultCodes,
  onClose,
  onSaved,
}: {
  surveyId: string;
  row: FieldworkContactRow;
  resultCodes: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [resultCode, setResultCode] = useState(resultCodes[0] ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memo, setMemo] = useState(row.memo ?? '');
  const [contactMethod, setContactMethod] = useState(row.contactMethod ?? '');
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);

  async function handleSave() {
    if (!resultCode) {
      setError('결과코드를 선택하세요.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await client.contacts.attempts.add({
        surveyId,
        contactTargetId: row.contactTargetId,
        resultCode,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, '결과를 기록하지 못했습니다.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveMemo() {
    setSavingMemo(true);
    setMemoError(null);
    setMemoSaved(false);
    try {
      await client.contacts.targets.setMemo({
        surveyId,
        id: row.contactTargetId,
        // 빈 칸은 null 로 보낸다 — 빈 문자열이 컬럼에 남으면 「비웠다」와 「안 적었다」가
        // 같은 모양이 되고, 목록의 「—」 판정이 값 유무로 서지 않는다.
        memo: memo.trim() ? memo.trim() : null,
        contactMethod: contactMethod ? (contactMethod as ContactMethod) : null,
      });
      setMemoSaved(true);
      onSaved();
    } catch (err) {
      setMemoError(getErrorMessage(err, '메모를 저장하지 못했습니다.'));
    } finally {
      setSavingMemo(false);
    }
  }

  const nameCell = row.cells.find((cell) => cell) ?? '';

  return (
    <div className="rounded-[11px] border border-[#E5E5EA] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#1C1C1E]">
          결과 기록 — {row.resid} {nameCell}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11.5px] text-[#9CA3AF] hover:text-[#1C1C1E]"
        >
          닫기
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="결과코드"
          value={resultCode}
          onChange={(event) => setResultCode(event.target.value)}
          className="h-9 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#3A3A3C]"
        >
          {resultCodes.length === 0 && <option value="">결과코드가 없습니다</option>}
          {resultCodes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="메모 (선택)"
          maxLength={500}
          className="h-9 min-w-[240px] flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none"
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-lg bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white',
            'hover:bg-[#2743AE] disabled:opacity-60',
          )}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          저장
        </button>
      </div>

      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

      <div className="mt-3 border-t border-[#F0F0F2] pt-3">
        <span className="text-[11.5px] text-[#9CA3AF]">
          컨택 메모 — 누적이 아니라 현재 상태입니다. 명단 수정은 담당 연구원 몫입니다.
        </span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label="연락 방법"
            value={contactMethod}
            onChange={(event) => setContactMethod(event.target.value)}
            className="h-9 rounded-lg border border-[#D1D5DB] bg-white px-2 text-[13px] text-[#3A3A3C]"
          >
            <option value="">연락 방법 없음</option>
            {CONTACT_METHOD_VALUES.map((method) => (
              <option key={method} value={method}>
                {CONTACT_METHOD_LABEL[method]}
              </option>
            ))}
          </select>

          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="컨택 메모 (선택)"
            maxLength={2000}
            className="h-9 min-w-[240px] flex-1 rounded-lg border border-[#D1D5DB] bg-white px-3 text-[13px] text-[#1C1C1E] placeholder:text-[#9CA3AF] focus:outline-none"
          />

          <button
            type="button"
            onClick={handleSaveMemo}
            disabled={savingMemo}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg border border-[#D1D5DB] bg-white px-4',
              'text-[13px] font-semibold text-[#374151] hover:bg-[#F5F5F7] disabled:opacity-60',
            )}
          >
            {savingMemo && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            메모 저장
          </button>

          {memoSaved && <span className="text-[12px] text-[#3A7D44]">저장됨</span>}
        </div>
        {memoError && <p className="mt-2 text-[12px] text-red-600">{memoError}</p>}
      </div>

      <p className="mt-2 text-[11px] text-[#9CA3AF]">
        결과코드·메모는 시도 회차(contact_attempts)로 기록되며 작성자(실사 계정)가 남습니다.
      </p>
    </div>
  );
}
