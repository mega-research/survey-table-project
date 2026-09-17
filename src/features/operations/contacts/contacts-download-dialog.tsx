'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { DownloadColumnCandidate } from '@/lib/operations/contacts-export-format';

interface Props {
  surveyId: string;
  candidates: DownloadColumnCandidate[];
}

/**
 * 조사 대상 명단 엑셀 다운로드 다이얼로그.
 * 컬럼 체크박스 선택 후 REST export 라우트로 앵커 다운로드.
 * 선택 상태는 다이얼로그 로컬 state — 저장하지 않는다.
 */
export function ContactsDownloadDialog({ surveyId, candidates }: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.defaultChecked).map((c) => c.source)),
  );

  const href = useMemo(() => {
    const cols = candidates
      .filter((c) => checked.has(c.source))
      .map((c) => `cols=${encodeURIComponent(c.source)}`);
    if (cols.length === 0) return null;
    return `/api/surveys/${surveyId}/contacts/export?${cols.join('&')}`;
  }, [candidates, checked, surveyId]);

  const toggle = (source: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          다운로드
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>조사 대상 다운로드</DialogTitle>
          <DialogDescription>
            내보낼 컬럼을 선택하세요. 전체 명단이 엑셀로 다운로드됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setChecked(new Set(candidates.map((c) => c.source)))}
          >
            전체 선택
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setChecked(new Set())}
          >
            전체 해제
          </Button>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {candidates.map((c) => (
            <label
              key={c.source}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50"
            >
              <Checkbox
                checked={checked.has(c.source)}
                onCheckedChange={() => toggle(c.source)}
                aria-label={c.label}
              />
              <span className="truncate">{c.label}</span>
            </label>
          ))}
        </div>

        <DialogFooter>
          {href ? (
            <Button asChild size="sm">
              <a href={href} download onClick={() => setOpen(false)}>
                선택 다운로드
              </a>
            </Button>
          ) : (
            <Button size="sm" disabled>
              선택 다운로드
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
