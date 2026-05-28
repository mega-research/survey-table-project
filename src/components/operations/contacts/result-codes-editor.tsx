'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateContactResultCodes } from '@/actions/contact-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_RESULT_CODES,
  type ContactResultCode,
  type ResultCodeStatus,
} from '@/db/schema/schema-types';
import { resolveCodeStatus } from '@/lib/operations/result-code-statuses';

interface ResultCodesEditorProps {
  surveyId: string;
  initialCodes: ContactResultCode[];
}

const TONE_OPTIONS: Array<NonNullable<ContactResultCode['tone']>> = [
  'green',
  'amber',
  'rose',
  'blue',
  'slate',
];

const STATUS_DOT_BG: Record<ResultCodeStatus, string> = {
  positive: 'bg-green-500',
  neutral: 'bg-slate-400',
  negative: 'bg-rose-500',
};

const STATUS_LABEL: Record<ResultCodeStatus, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
};

function StatusDot({ status }: { status: ResultCodeStatus }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_BG[status]}`}
    />
  );
}

type SaveMode = 'custom' | 'use-default';

export function ResultCodesEditor({ surveyId, initialCodes }: ResultCodesEditorProps) {
  const router = useRouter();
  const [codes, setCodes] = useState<ContactResultCode[]>(initialCodes);
  const [mode, setMode] = useState<SaveMode>('custom');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** 사용자 편집 시 use-default 모드면 자동으로 custom 으로 전환. */
  function ensureCustomMode() {
    if (mode === 'use-default') setMode('custom');
  }

  function update(index: number, patch: Partial<ContactResultCode>) {
    ensureCustomMode();
    setCodes((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function move(index: number, dir: -1 | 1) {
    ensureCustomMode();
    const newCodes = [...codes];
    const target = index + dir;
    if (target < 0 || target >= newCodes.length) return;
    [newCodes[index], newCodes[target]] = [newCodes[target], newCodes[index]];
    newCodes.forEach((c, i) => {
      c.order = i + 1;
    });
    setCodes(newCodes);
  }

  function remove(index: number) {
    if (codes.length === 1) {
      setError('최소 1개의 결과코드가 필요합니다.');
      return;
    }
    const target = codes[index];
    if (resolveCodeStatus(target) === 'positive') {
      const otherPositiveExists = codes.some(
        (c, i) => i !== index && resolveCodeStatus(c) === 'positive',
      );
      if (!otherPositiveExists) {
        setError('마지막 긍정 상태 코드는 삭제할 수 없습니다. 다른 코드를 긍정으로 먼저 지정해 주세요.');
        return;
      }
    }
    ensureCustomMode();
    setCodes((prev) =>
      prev.filter((_, i) => i !== index).map((c, i) => ({ ...c, order: i + 1 })),
    );
  }

  function add() {
    ensureCustomMode();
    const nextOrder = codes.length + 1;
    setCodes((prev) => [
      ...prev,
      { code: `신규${nextOrder}`, label: `신규${nextOrder}`, order: nextOrder, tone: 'slate' },
    ]);
  }

  function reset() {
    if (!window.confirm('디폴트 13개로 복귀합니다. 진행할까요?')) return;
    ensureCustomMode();
    setCodes(DEFAULT_RESULT_CODES.map((c) => ({ ...c })));
  }

  /**
   * 저장 전 validation — 빈 코드/라벨 + 코드 중복 차단.
   * 저장 시 mode='use-default' 면 NULL set, 아니면 현재 codes 저장.
   */
  function validate(): string | null {
    const trimmed = codes.map((c) => c.code.trim());
    const labelsTrimmed = codes.map((c) => c.label.trim());
    if (trimmed.some((c) => c.length === 0)) return '코드는 빈 값일 수 없습니다.';
    if (labelsTrimmed.some((l) => l.length === 0)) return '라벨은 빈 값일 수 없습니다.';
    const seen = new Set<string>();
    for (const c of trimmed) {
      if (seen.has(c)) return `중복된 코드: ${c}`;
      seen.add(c);
    }
    if (!codes.some((c) => resolveCodeStatus(c) === 'positive')) {
      return '긍정 상태(응답 완료로 인정) 코드가 최소 1개 필요합니다.';
    }
    return null;
  }

  function save() {
    if (mode === 'custom') {
      const v = validate();
      if (v) {
        setError(v);
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateContactResultCodes(surveyId, mode === 'use-default' ? null : codes);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function clearOverride() {
    if (!window.confirm('사용자 정의를 해제 모드로 전환합니다. 저장을 누르면 디폴트로 되돌아갑니다.')) return;
    setError(null);
    setMode('use-default');
    setCodes(DEFAULT_RESULT_CODES.map((c) => ({ ...c })));
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {mode === 'use-default' && (
        <div role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          사용자 정의 해제 모드 — 저장 시 디폴트 13개로 되돌아갑니다. 편집을 시작하면 다시 사용자 정의로 전환됩니다.
        </div>
      )}

      <div className="rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">순서</th>
              <th className="px-3 py-2 text-left">코드</th>
              <th className="px-3 py-2 text-left">라벨</th>
              <th className="px-3 py-2 text-left">색상</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-center">액션</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === codes.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={c.code}
                    onChange={(e) => update(i, { code: e.target.value })}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={c.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={c.tone ?? 'slate'}
                    onValueChange={(v) => update(i, { tone: v as ContactResultCode['tone'] })}
                  >
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONE_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={resolveCodeStatus(c)}
                    onValueChange={(v) => update(i, { status: v as ResultCodeStatus })}
                  >
                    <SelectTrigger className="h-8 w-24">
                      <SelectValue>
                        <span className="inline-flex items-center gap-2">
                          <StatusDot status={resolveCodeStatus(c)} />
                          {STATUS_LABEL[resolveCodeStatus(c)]}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(['positive', 'neutral', 'negative'] as ResultCodeStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          <span className="inline-flex items-center gap-2">
                            <StatusDot status={s} />
                            {STATUS_LABEL[s]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => remove(i)}
                  >
                    삭제
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={add} variant="outline">
          + 결과코드 추가
        </Button>
        <Button onClick={reset} variant="outline">
          디폴트 13개로 복귀
        </Button>
        <Button onClick={clearOverride} variant="outline" className="text-slate-600">
          사용자 정의 해제
        </Button>
        <span className="flex-1" />
        <Button onClick={save} disabled={isPending}>
          {isPending ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  );
}
