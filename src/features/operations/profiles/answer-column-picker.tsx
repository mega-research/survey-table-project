'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: ProfileAnswerSource[];
  /** 이미 열로 추가된 키 — 목록에서 고를 수 없게 표시한다. */
  addedKeys: ReadonlySet<string>;
  onPick: (source: ProfileAnswerSource) => void;
}

/** 검색어 비교용 — 대소문자·공백 차이를 무시한다. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/**
 * 응답값 열 추가 창 — 변수명(Q1_r1_c2)이나 문항 제목·칸 이름으로 찾아 하나를 고른다.
 * 고른 칸은 변수명이 아니라 문항·칸 id 로 저장된다(answerColumnKey).
 */
export function AnswerColumnPicker({ open, onOpenChange, sources, addedKeys, onPick }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return sources;
    return sources.filter((s) =>
      normalize(`${s.varName} ${s.questionTitle} ${s.cellLabel ?? ''}`).includes(q),
    );
  }, [sources, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>응답값 열 추가</DialogTitle>
          <DialogDescription>
            응답 내역에 응답자가 적은 값을 열로 보입니다. 단답형·장문형 문항과 표의 입력 칸을 고를
            수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="변수명(예: Q1_r1_c2) 또는 문항 제목으로 찾기"
          aria-label="응답값 열 찾기"
        />

        <div className="max-h-[420px] overflow-y-auto rounded border">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {sources.length === 0
                ? '고를 수 있는 문항이 없습니다. 문항코드가 있는 단답형·장문형 문항이나 표 입력 칸이 필요합니다.'
                : '찾는 문항이 없습니다.'}
            </p>
          ) : (
            <ul>
              {filtered.map((s) => {
                const added = addedKeys.has(s.key);
                return (
                  <li key={s.key} className="border-t first:border-t-0">
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => {
                        onPick(s);
                        setQuery('');
                        onOpenChange(false);
                      }}
                      className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <span className="w-40 shrink-0 font-mono text-xs break-all text-slate-600">
                        {s.varName}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-900">{s.questionTitle}</span>
                        {s.cellLabel && (
                          <span className="block truncate text-xs text-slate-500">
                            {s.cellLabel}
                          </span>
                        )}
                      </span>
                      {added && <span className="shrink-0 text-xs text-slate-500">추가됨</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
