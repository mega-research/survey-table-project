'use client';

import { useState } from 'react';

import { ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ScaleMeanCandidate } from '@/lib/operations/scale-mean-format';

import { ScaleMeanQuestionPicker } from './scale-mean-question-picker';

interface Props {
  surveyId: string;
  candidates: ScaleMeanCandidate[];
}

/** 표가 있을 때 제목 오른쪽 「문항 선택」 — 닫으면 목록이 언마운트되어 다음에 열 때 지금 값으로 다시 시작한다. */
export function ScaleMeanPickerDialog({ surveyId, candidates }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListChecks className="mr-2 h-4 w-4" />
          문항 선택
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>평균을 낼 문항</DialogTitle>
          <DialogDescription>
            고른 문항만 표에 나옵니다. 저장하면 바로 반영되고 재배포는 필요 없습니다.
          </DialogDescription>
        </DialogHeader>
        <ScaleMeanQuestionPicker
          surveyId={surveyId}
          candidates={candidates}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
