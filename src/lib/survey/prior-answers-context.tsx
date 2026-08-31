'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  DEFAULT_PRIOR_WAVE_LABEL,
  hasPriorAnswer,
  resolvePriorWaveLabel,
  type PriorAnswers,
} from '@/lib/survey/prior-answers';

interface PriorAnswersContextValue {
  /** 이월 응답 한 벌. 없으면 null (익명 응답자·이월 응답 미보유 대상자). */
  answers: PriorAnswers | null;
  /** 응답 화면 문구에 쓰는 회차 라벨. 설정이 비어 있으면 기본 문구. */
  waveLabel: string;
}

const EMPTY_VALUE: PriorAnswersContextValue = {
  answers: null,
  waveLabel: DEFAULT_PRIOR_WAVE_LABEL,
};

const PriorAnswersContext = createContext<PriorAnswersContextValue>(EMPTY_VALUE);

/**
 * 이월 응답 표시 컨텍스트.
 *
 * 프리필 자체는 응답값 state 에 이미 주입돼 있고, 이 컨텍스트는 "이 문항 값이
 * 지난 회차 것인가"를 화면이 판정하기 위한 참조다 — 문항 컴포넌트까지 prop 을
 * 흘리지 않으려고 contact attrs 와 같은 컨텍스트 패턴을 쓴다.
 */
export function PriorAnswersProvider({
  answers,
  waveLabel,
  children,
}: {
  answers: PriorAnswers | null;
  /** surveys.priorWaveLabel(라이브 값). null/공백이면 기본 문구로 떨어진다. */
  waveLabel: string | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo<PriorAnswersContextValue>(
    () => ({ answers, waveLabel: resolvePriorWaveLabel(waveLabel) }),
    [answers, waveLabel],
  );
  return <PriorAnswersContext.Provider value={value}>{children}</PriorAnswersContext.Provider>;
}

/**
 * 이 문항에 지난 회차 값이 채워져 있는가 + 그때 쓸 회차 라벨.
 * Provider 밖(빌더 미리보기 등)에서 호출하면 항상 false — 레거시 안전.
 */
export function usePriorAnswerMark(questionId: string): {
  hasPrior: boolean;
  waveLabel: string;
} {
  const { answers, waveLabel } = useContext(PriorAnswersContext);
  return { hasPrior: hasPriorAnswer(answers, questionId), waveLabel };
}
