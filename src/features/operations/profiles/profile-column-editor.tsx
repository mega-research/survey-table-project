'use client';

import { useMemo, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { resultErrorMessage } from '@/lib/get-error-message';
import type { NormalizedContactColumnScheme } from '@/lib/operations/contacts-format';
import { answerKeyOf, hydrateProfileColumns } from '@/lib/operations/profile-columns-format';
import type { ProfileColumnDef, ProfileColumnScheme } from '@/shared/contracts/operations';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';
import { client } from '@/shared/lib/rpc';

import { AnswerColumnPicker } from './answer-column-picker';

interface Props {
  surveyId: string;
  /** surveys.profile_columns 현재 값 — NULL 이면 기본 스킴에서 시작 */
  initialScheme: ProfileColumnScheme | null;
  /** contact_columns 의 attrs./pii. 풀 — 조사 대상 정보 컬럼 소스 */
  contactScheme: NormalizedContactColumnScheme | null;
  /** 종료 후 이동 주소 설정의 이어 넘길 값 이름 — entry. 풀 */
  entryParamNames: string[];
  /** 응답값 열로 고를 수 있는 칸 — 지금 설문 구조 기준 */
  answerSources: ProfileAnswerSource[];
}

/** 소스 표기 — sys 는 시스템, attrs/pii 는 조사 대상 정보 출처, answer 는 변수명을 드러낸다. */
function sourceLabel(
  key: string,
  answerSourceByKey: ReadonlyMap<string, ProfileAnswerSource>,
): string {
  const answer = answerSourceByKey.get(key);
  if (answer) return `${answer.varName} (응답값)`;
  if (key.startsWith('attrs.')) return key;
  if (key.startsWith('pii.')) return `${key} (개인정보)`;
  if (key.startsWith('entry.')) return `${key} (링크로 받은 값)`;
  return key;
}

/**
 * 응답 내역 컬럼 설정 에디터 — 진척률 컬럼 에디터(progress-column-editor)와 동일 패턴.
 * 시스템 컬럼 + 조사 대상 attrs/pii 를 한 목록에서 순서·라벨·표시 여부로 편집한다.
 */
export function ProfileColumnEditor({
  surveyId,
  initialScheme,
  contactScheme,
  entryParamNames,
  answerSources,
}: Props) {
  const router = useRouter();

  const answerSourceByKey = useMemo(
    () => new Map(answerSources.map((s) => [s.key, s])),
    [answerSources],
  );
  const answerKeys = useMemo(() => new Set(answerSourceByKey.keys()), [answerSourceByKey]);

  const hydratedColumns = useMemo<ProfileColumnDef[]>(
    () => hydrateProfileColumns(contactScheme, initialScheme, entryParamNames, answerKeys),
    [contactScheme, initialScheme, entryParamNames, answerKeys],
  );

  const [columns, setColumns] = useState<ProfileColumnDef[]>(hydratedColumns);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  // 기본 라벨 — 표 칸이면 칸 이름(행 - 열), 문항 전체면 문항 제목.
  const addAnswerColumn = (source: ProfileAnswerSource) => {
    setColumns((prev) => [
      ...prev,
      {
        key: source.key,
        label: (source.cellLabel ?? source.questionTitle).trim() || source.varName,
        order: prev.length,
      },
    ]);
  };

  // 응답값 열은 풀에 없어 숨겨 두는 대신 목록에서 뺀다 — 다시 쓰려면 추가로 고른다.
  const removeColumn = (i: number) => {
    setColumns((prev) =>
      prev.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, order: idx })),
    );
  };

  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setColumns(next.map((c, idx) => ({ ...c, order: idx })));
  };

  const updateLabel = (i: number, label: string) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, label } : c)));
  };

  const toggleHidden = (i: number) => {
    setColumns((prev) => prev.map((c, idx) => (idx === i ? { ...c, hidden: !c.hidden } : c)));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await client.operations.profileColumns.updateColumns({
          surveyId,
          scheme: { version: 1, columns },
        });
        if (!result.ok) {
          setError(resultErrorMessage(result.error, '저장에 실패했습니다.'));
          return;
        }
        router.refresh();
      } catch (e) {
        // 인증 만료/네트워크 장애/서버 500 등 RPC throw 경로를 배너로 노출
        setError((e as Error).message);
      }
    });
  };

  const reset = () => {
    setError(null);
    startTransition(async () => {
      try {
        // 빈 columns 저장 → 서버가 NULL 로 되돌림 (기본 스킴 복귀)
        const result = await client.operations.profileColumns.updateColumns({
          surveyId,
          scheme: { version: 1, columns: [] },
        });
        if (!result.ok) {
          setError(resultErrorMessage(result.error, '초기화에 실패했습니다.'));
          return;
        }
        setColumns(hydrateProfileColumns(contactScheme, null, entryParamNames, answerKeys));
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">순서</th>
              <th className="px-3 py-2 text-left">라벨</th>
              <th className="px-3 py-2 text-left">소스</th>
              <th className="px-3 py-2 text-center">표시</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={c.key} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="위로"
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === columns.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="아래로"
                    >
                      ↓
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={c.label}
                    onChange={(e) => updateLabel(i, e.target.value)}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {sourceLabel(c.key, answerSourceByKey)}
                </td>
                <td className="px-3 py-2 text-center">
                  <Checkbox
                    checked={!c.hidden}
                    onCheckedChange={() => toggleHidden(i)}
                    aria-label={`${c.label} 표시`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {answerKeyOf(c.key) !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeColumn(i)}
                      aria-label={`${c.label} 열 빼기`}
                    >
                      빼기
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500">
        조사 대상 정보(attrs)와 개인정보(pii) 컬럼은 컨택 매칭이 있는 응답에만 값이 표시됩니다. IP
        해시는 앞 8자만 노출됩니다. 개인정보 컬럼을 켜면 목록에서 복호화된 값이 그대로 보입니다.
        응답값 열은 응답자가 적은 값을 그대로 보이며, 개인정보로 암호화한 문항·칸도 복호화해
        보입니다. 응답값 열은 검색바와 열 머리 깔때기로 일부만 입력해도 찾을 수 있지만 정렬은
        되지 않고, 개인정보로 암호화한 문항·칸은 검색할 수 없습니다.
      </div>

      <div>
        <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={pending}>
          응답값 열 추가
        </Button>
      </div>

      <AnswerColumnPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        sources={answerSources}
        addedKeys={new Set(columns.map((c) => c.key))}
        onPick={addAnswerColumn}
      />

      <div className="flex gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? '저장 중…' : '저장'}
        </Button>
        <Button variant="outline" onClick={reset} disabled={pending}>
          기본값으로 초기화
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          취소
        </Button>
      </div>
    </div>
  );
}
