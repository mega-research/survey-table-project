'use client';

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { Question, QuestionGroup } from '@/types/survey';
import type { RenderStep } from '@/utils/group-ordering';
import { findLanguageQuestion, isLanguageOnlyPage } from '@/utils/survey-language';

/**
 * 언어 페이지에서 시작한 「다음」 — 응답 흐름의 넘김 함수가 받는다.
 *
 * - `rebaseHistory`: 넘기기 전에 방문 기록을 고친다. 「언어 변경」으로 와서 다른 언어를 고르면
 *   이전 언어판 페이지가 숨으므로, 처음 언어 페이지에 닿기 전까지로 자른다.
 * - `isSuperseded`: 넘김이 무언가를 기다리는 사이(쿼터 첫 판정) 응답자가 다시 골랐는가. 참이면
 *   그 넘김은 낡은 답으로 계산된 것이라 버리고 `retry` 로 지금 답에서 다시 넘긴다.
 */
export interface LanguageAdvance {
  rebaseHistory?: (history: number[]) => number[];
  isSuperseded: () => boolean;
  retry: () => void;
}

interface SwitchOrigin {
  /** 「언어 변경」을 누른 페이지 */
  fromStepIndex: number;
  /** 그때의 언어 문항 답 — 같은 답을 다시 고르면 이 페이지로 돌아간다 */
  answer: unknown;
}

interface UseLanguagePageArgs {
  /** 관리자 응답 수정은 끈다 — 언어 페이지도 보통 페이지(「다음」)이고 「언어 변경」이 없다. */
  enabled: boolean;
  questions: Question[];
  groups: QuestionGroup[];
  steps: RenderStep[];
  responses: Record<string, unknown>;
  currentStepIndex: number;
  /** 지금 페이지에 보이는 문항 */
  currentStepQuestions: Question[];
  handleStepResponse: (questionId: string, value: unknown) => void;
  setCurrentStepIndex: (index: number) => void;
  setStepHistory: Dispatch<SetStateAction<number[]>>;
  /** 「언어 변경」으로 페이지를 떠날 때 — 입력 정리와 이 페이지 변경분 저장 */
  onLeavePage: () => void;
  /** 「다음」과 같은 경로로 넘긴다 */
  onAdvance: (advance: LanguageAdvance) => void;
}

/**
 * 언어 페이지 (PRD 「언어 선택 페이지」 · CONTEXT.md 「다국어 설문」).
 *
 * 보이는 문항이 언어 문항 하나뿐인 페이지는 「다음」·하단 내비·진행률이 없고, 보기를 누르면
 * 「다음」과 같은 경로로 넘어간다. 언어판 페이지 위의 「언어 변경」은 언어 페이지로 데려가고,
 * 같은 언어를 다시 고르면 떠났던 페이지로, 다른 언어를 고르면 새 언어판 첫 페이지로 간다.
 */
export function useLanguagePage({
  enabled,
  questions,
  groups,
  steps,
  responses,
  currentStepIndex,
  currentStepQuestions,
  handleStepResponse,
  setCurrentStepIndex,
  setStepHistory,
  onLeavePage,
  onAdvance,
}: UseLanguagePageArgs) {
  const languageQuestion = useMemo(
    () => (enabled ? findLanguageQuestion(questions, groups) : null),
    [enabled, questions, groups],
  );
  const isLanguagePage = isLanguageOnlyPage(currentStepQuestions, languageQuestion);
  // 언어 문항이 있는 페이지 — 「언어 변경」이 데려가는 곳. 그 페이지 위에서는 링크를 보이지 않는다.
  const languageStepIndex = useMemo(
    () =>
      languageQuestion
        ? steps.findIndex((step) =>
            step.items.some((item) => item.question.id === languageQuestion.id),
          )
        : -1,
    [steps, languageQuestion],
  );
  const showLanguageSwitch = languageStepIndex !== -1 && languageStepIndex !== currentStepIndex;
  const languageAnswer = languageQuestion ? responses[languageQuestion.id] : undefined;

  // 「언어 변경」으로 왔을 때만 있다 — 언어 페이지를 떠나면 비운다.
  const switchOriginRef = useRef<SwitchOrigin | null>(null);
  useEffect(() => {
    if (currentStepIndex !== languageStepIndex) switchOriginRef.current = null;
  }, [currentStepIndex, languageStepIndex]);

  /**
   * 자동 넘김 요청 — 요청한 페이지 번호와 순번. 보기를 누른 그 이벤트 안에서 곧장 넘기면 아직
   * 답이 반영되지 않은 화면으로 필수 판정·분기를 해 막힌다. 그래서 요청만 남기고, 답이 반영된
   * 렌더 뒤에 아래 effect 가 넘긴다. 한 렌더 안의 연타는 마지막 요청 하나로 접히고, 넘어간 뒤
   * 늦게 도착한 요청(다른 페이지 번호)은 버린다. 처리 중(쿼터 첫 판정 대기)에 다시 누르면 넘김
   * 함수의 기존 가드가 막고, 기다리던 넘김이 `isSuperseded` 로 그것을 알아채 다시 넘긴다.
   */
  const [advanceRequest, setAdvanceRequest] = useState<{ stepIndex: number; seq: number } | null>(
    null,
  );
  const latestSeqRef = useRef(0);
  const handledSeqRef = useRef(0);

  const requestAdvance = useCallback((stepIndex: number) => {
    latestSeqRef.current += 1;
    setAdvanceRequest({ stepIndex, seq: latestSeqRef.current });
  }, []);

  const handlePageResponse = useCallback(
    (questionId: string, value: unknown) => {
      if (!isLanguagePage || questionId !== languageQuestion?.id) {
        handleStepResponse(questionId, value);
        return;
      }
      // 이미 고른 보기를 다시 누르면 radio 는 선택을 푼다(null). 언어 페이지에서는 풀지 않고
      // 고른 언어 그대로 넘어간다 — 「언어 변경」으로 돌아와 같은 언어를 다시 누른 경우다.
      if (value !== null && value !== undefined) handleStepResponse(questionId, value);
      requestAdvance(currentStepIndex);
    },
    [isLanguagePage, languageQuestion, handleStepResponse, requestAdvance, currentStepIndex],
  );

  /**
   * 「언어 변경」 — 언어 페이지로 간다. 「다음」과 같은 페이지 이동이라 지금 페이지를 방문 기록에
   * 쌓고(「이전」·브라우저 뒤로 가기가 돌아올 곳), 이 페이지 변경분은 백그라운드로 저장한다.
   * 답은 건드리지 않는다 — 다른 언어를 고르면 이전 언어 묶음이 숨으며 숨은 문항 규칙대로 지워진다.
   */
  const goToLanguagePage = () => {
    if (!showLanguageSwitch) return;
    onLeavePage();
    switchOriginRef.current = { fromStepIndex: currentStepIndex, answer: languageAnswer };
    setStepHistory((prev) => [...prev, currentStepIndex]);
    setCurrentStepIndex(languageStepIndex);
  };

  const advance = useEffectEvent((seq: number) => {
    const origin = switchOriginRef.current;
    // 같은 언어를 다시 골랐다 — 떠났던 페이지로 돌아간다(「이전」과 같은 이동)
    if (origin && origin.answer === languageAnswer && steps[origin.fromStepIndex]) {
      switchOriginRef.current = null;
      setStepHistory((prev) => (prev.at(-1) === origin.fromStepIndex ? prev.slice(0, -1) : prev));
      setCurrentStepIndex(origin.fromStepIndex);
      return;
    }
    const languageStep = languageStepIndex;
    onAdvance({
      // 다른 언어로 바꿨다 — 이전 언어판 페이지는 숨었으니 처음 언어 페이지에 닿기 전까지로 자른다
      ...(origin
        ? {
            rebaseHistory: (history: number[]) => {
              const cut = history.indexOf(languageStep);
              return cut === -1 ? history : history.slice(0, cut);
            },
          }
        : {}),
      isSuperseded: () => latestSeqRef.current !== seq,
      retry: () => requestAdvance(languageStep),
    });
  });

  useEffect(() => {
    if (!advanceRequest) return;
    if (handledSeqRef.current === advanceRequest.seq) return;
    handledSeqRef.current = advanceRequest.seq;
    if (advanceRequest.stepIndex !== currentStepIndex) return;
    // 「다음」과 같은 경로를 답이 커밋된 뒤에 태우려는 것이라 effect 밖에 둘 자리가 없다 —
    // 렌더 중에는 저장·이동 부수 효과를 낼 수 없고, 누른 이벤트 안에서는 답이 아직 없다.
    advance(advanceRequest.seq);
  }, [advanceRequest, currentStepIndex]);

  return {
    isLanguagePage,
    languageStepIndex,
    showLanguageSwitch,
    handlePageResponse,
    goToLanguagePage,
  };
}
