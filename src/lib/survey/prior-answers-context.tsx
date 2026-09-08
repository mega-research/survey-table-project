'use client';

import { type ReactNode, createContext, useContext, useMemo } from 'react';

import {
  DEFAULT_PRIOR_WAVE_LABEL,
  type PriorAnswers,
  resolvePriorWaveLabel,
} from '@/lib/survey/prior-answers';

interface PriorAnswersContextValue {
  /**
   * 이월 응답 한 벌 **원본**. 없으면 null (익명 응답자·이월 응답 미보유 대상자).
   * 스위치가 꺼져 있어도 비우지 않는다 — 프리필 값이 지난 회차 것인지 판정해야 하는
   * 자리가 확인 컨트롤 말고도 있다(숫자 기본값 자동 채움이 프리필을 밀어내는 것을 막는다).
   */
  answers: PriorAnswers | null;
  /**
   * 변동 확인 컨트롤·잠금·확인 게이트·확인 시 복사가 쓰는 이월 응답 — 문항별 이월값
   * 불러오기 조건(`priorAnswerCondition`)으로 이미 걸러진 값이다. 스위치가 꺼져 있거나
   * 걸러진 결과가 없으면 null. `answers`(원본)를 그대로 쓰면 조건이 거짓인 문항도
   * 확인 대상으로 뜬다 — 변동 확인 스위치를 켜는 순간 이월값 조건이 무시되는 사고다.
   */
  confirmAnswers: PriorAnswers | null;
  /** 응답 화면 문구에 쓰는 회차 라벨. 설정이 비어 있으면 기본 문구. */
  waveLabel: string;
  /**
   * 문항별 변동 확인 스위치. 꺼져 있으면 잠금·확인 컨트롤을 그리지 않는다.
   * 판정에 이월 응답을 쓰는 소비자는 이 값으로 스스로 무동작이 된다.
   */
  changeConfirmEnabled: boolean;
}

const EMPTY_VALUE: PriorAnswersContextValue = {
  answers: null,
  confirmAnswers: null,
  waveLabel: DEFAULT_PRIOR_WAVE_LABEL,
  changeConfirmEnabled: false,
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
  confirmAnswers,
  waveLabel,
  changeConfirmEnabled,
  children,
}: {
  answers: PriorAnswers | null;
  /** 이월값 조건으로 걸러진 이월 응답 — 변동 확인 소비자는 이 값을 써야 한다. */
  confirmAnswers: PriorAnswers | null;
  /** surveys.priorWaveLabel(라이브 값). null/공백이면 기본 문구로 떨어진다. */
  waveLabel: string | null | undefined;
  /** surveys.changeConfirmEnabled(라이브 값). */
  changeConfirmEnabled: boolean;
  children: ReactNode;
}) {
  const value = useMemo<PriorAnswersContextValue>(
    () => ({
      answers,
      confirmAnswers,
      waveLabel: resolvePriorWaveLabel(waveLabel),
      changeConfirmEnabled,
    }),
    [answers, confirmAnswers, waveLabel, changeConfirmEnabled],
  );
  return <PriorAnswersContext.Provider value={value}>{children}</PriorAnswersContext.Provider>;
}

/**
 * 이 응답자의 이월 응답 한 벌 + 회차 라벨.
 *
 * 판정(컨트롤 노출·잠금·확인 시 복사할 값)은 전부 `lib/survey/change-confirmation` 의
 * 순수 함수가 한다 — 컨텍스트는 재료만 내준다. 화면과 진행 차단 게이트가 각자 판정하면
 * 컨트롤은 뜨는데 차단은 안 되는 죽은 컨트롤이 생긴다.
 * Provider 밖(빌더 미리보기 등)에서 호출하면 answers 가 null — 레거시 안전.
 */
export function usePriorAnswers(): PriorAnswersContextValue {
  return useContext(PriorAnswersContext);
}
