'use client';

import { useState } from 'react';

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
import { getErrorMessage } from '@/lib/get-error-message';

import { useSetSurveyCardTitle } from '../queries/use-surveys';

interface Props {
  surveyId: string;
  /** 설문지 제목 — 응답자에게 보이는 이름. 비워 두면 카드도 이것을 쓴다. */
  surveyTitle: string;
  cardTitle: string | null;
  onClose: () => void;
  /** 저장 뒤 한 번 — RSC 로 이름을 받은 화면(운영 콘솔 머리)이 다시 읽을 자리. */
  onSaved?: () => void;
}

/**
 * 카드 제목 변경 (0140) — 목록 카드와 운영 콘솔 머리에 보이는 관리용 이름.
 *
 * 응답자에게 보이는 설문지 제목은 빌더에서 고친다 — 여기서는 건드리지 않는다는 것을 창이 말한다.
 * 비우고 저장하면 설문지 제목을 따라간다(null).
 */
export function CardTitleDialog({ surveyId, surveyTitle, cardTitle, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(cardTitle ?? '');
  const [error, setError] = useState<string | null>(null);
  const setCardTitle = useSetSurveyCardTitle();

  async function save() {
    setError(null);
    try {
      await setCardTitle.mutateAsync({ surveyId, cardTitle: draft.trim() === '' ? null : draft });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '카드 제목을 저장하지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>카드 제목 변경</DialogTitle>
          <DialogDescription>
            설문 목록과 운영 화면에 보이는 이름입니다. 응답자에게 보이는 설문지 제목은 바뀌지
            않습니다. 비워 두면 설문지 제목을 그대로 씁니다.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-2"
        >
          <Input
            aria-label="카드 제목"
            value={draft}
            maxLength={200}
            placeholder={surveyTitle}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-gray-500">설문지 제목: {surveyTitle}</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <Button type="submit" size="sm" disabled={setCardTitle.isPending}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
