'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DEFAULT_SURVEY_LOCALE, type SurveyLocale } from '@/types/survey-locale';
import { systemText } from '@/utils/system-strings';

import { localizedWaveLabel } from './change-confirm-control';

/**
 * "달라졌다"고 밝혔는데 값이 지난 회차와 완전히 같은 문항을 제출 직전에 한 번 되묻는다.
 *
 * **막지 않는다** — 아홉 칸 중 여덟 칸이 지난 회차와 같은 것은 정상이고, 정말 한 칸도
 * 바뀌지 않았을 수도 있다. 실수로 열어만 두고 지나친 경우를 되돌아보게 하는 장치다.
 */
export function UnmodifiedChangedDialog({
  open,
  questionTitles,
  waveLabel,
  locale = DEFAULT_SURVEY_LOCALE,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** 되묻는 문항의 제목 — 응답자가 어디로 돌아가야 하는지 알아야 한다. */
  questionTitles: string[];
  waveLabel: string;
  /** 응답 화면의 현재 언어(미정이면 한국어) — 창은 언어 공급자 밖에서 그려져 직접 받는다. */
  locale?: SurveyLocale;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const wave = localizedWaveLabel(waveLabel, locale);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{systemText('tracking.unmodified.title', locale)}</AlertDialogTitle>
          <AlertDialogDescription>
            {systemText('tracking.unmodified.body', locale, { wave })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-gray-700">
          {questionTitles.map((title, index) => (
            <li key={`${title}-${index}`} className="break-keep">
              {title}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {systemText('tracking.unmodified.back', locale)}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {systemText('tracking.unmodified.submit', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
