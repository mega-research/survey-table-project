'use client';

import { useId, useState } from 'react';

import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSetSurveyListTitle } from '@/features/survey-builder/queries/use-surveys';
import { getErrorMessage } from '@/lib/get-error-message';
import {
  SURVEY_LIST_TITLE_MAX_LENGTH,
  hasOwnCardTitle,
  normalizeSurveyListTitle,
} from '@/utils/survey-card-title';

interface CardTitleTarget {
  id: string;
  title: string;
  listTitle: string | null;
}

interface Props {
  /** 카드 제목을 바꿀 설문. null 이면 닫혀 있다 */
  survey: CardTitleTarget | null;
  onClose: () => void;
}

/**
 * 카드 제목 바꾸기 — 설문 관리·설문 분석 목록의 카드에만 쓰는 이름을 정한다.
 * 설문 제목(응답자가 보는 제목)은 건드리지 않는다. 비워 두면 설문 제목을 그대로 보인다.
 */
export function SurveyCardTitleDialog({ survey, onClose }: Props) {
  return (
    <Dialog open={survey !== null} onOpenChange={(open) => !open && onClose()}>
      {/* 설문이 바뀌면 입력을 새로 시작한다 */}
      {survey && <CardTitleForm key={survey.id} survey={survey} onClose={onClose} />}
    </Dialog>
  );
}

function CardTitleForm({ survey, onClose }: { survey: CardTitleTarget; onClose: () => void }) {
  const inputId = useId();
  const [value, setValue] = useState(survey.listTitle ?? '');
  const { mutate, isPending } = useSetSurveyListTitle();

  const next = normalizeSurveyListTitle(value, survey.title);
  const current = hasOwnCardTitle(survey) ? (survey.listTitle?.trim() ?? null) : null;
  const unchanged = next === current;

  const save = (listTitle: string | null) => {
    if (isPending) return;
    mutate(
      { surveyId: survey.id, listTitle },
      {
        onSuccess: (result) => {
          toast.success(
            result.listTitle === null
              ? '카드 제목을 지웠습니다. 설문 제목을 그대로 보입니다.'
              : '카드 제목을 바꿨습니다.',
          );
          onClose();
        },
        onError: (err) => toast.error(getErrorMessage(err, '카드 제목을 바꾸지 못했습니다.')),
      },
    );
  };

  return (
    <DialogContent
      // 저장 요청이 가는 동안에는 닫히지 않는다 — 늦게 온 응답이 다시 연 창을 건드리지 않게.
      onInteractOutside={(event) => isPending && event.preventDefault()}
      onEscapeKeyDown={(event) => isPending && event.preventDefault()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!unchanged) save(next);
        }}
        className="space-y-4"
      >
        <DialogHeader>
          <DialogTitle>카드 제목 바꾸기</DialogTitle>
          <DialogDescription>
            설문 목록의 카드에만 보이는 이름입니다. 응답자가 보는 설문 제목은 바뀌지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={inputId}>카드 제목</Label>
          <Input
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={survey.title}
            maxLength={SURVEY_LIST_TITLE_MAX_LENGTH}
            disabled={isPending}
            autoFocus
          />
          <p className="text-xs text-gray-500">비워 두면 설문 제목을 그대로 보입니다.</p>
        </div>

        <div className="rounded-md bg-gray-50 px-3 py-2 text-sm">
          <span className="text-xs text-gray-500">설문 제목</span>
          <p className="break-keep text-gray-900">{survey.title}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            취소
          </Button>
          <Button type="submit" disabled={isPending || unchanged}>
            {isPending ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
