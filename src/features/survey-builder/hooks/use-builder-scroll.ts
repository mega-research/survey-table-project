'use client';

import { useEffect, useState } from 'react';

import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';

/**
 * 빌더 화면의 스크롤 보조 — 플로팅 버튼 노출 판정, 위/아래 이동, 질문 번호로 점프.
 *
 * 설문 생성 화면과 편집 화면이 같은 로직을 각각 갖고 있었다. 유일한 실질 차이는
 * 질문 배열을 어디서 읽느냐였다. 생성 화면은 렌더 시점에 구독한 currentSurvey 를
 * 클로저로 잡았고 편집 화면은 클릭 시점에 getState 로 읽었다. 클릭 시점 읽기 쪽으로
 * 합친다 — 항상 최신이고 이 훅이 질문 배열을 구독하지 않아 리렌더도 늘지 않는다.
 */
export function useBuilderScroll(selectQuestion: (questionId: string) => void) {
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [questionNumberInput, setQuestionNumberInput] = useState('');

  // 스크롤 감지 (성능 최적화: requestAnimationFrame 사용)
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setShowScrollButtons(window.scrollY > 200);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 맨 위로 스크롤
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 맨 아래로 스크롤
  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  // 특정 질문으로 스크롤
  const scrollToQuestion = (questionNumber: number) => {
    const questions = useSurveyBuilderStore.getState().currentSurvey.questions;
    const questionIndex = questionNumber - 1;
    if (questionIndex >= 0 && questionIndex < questions.length) {
      const targetQuestion = questions[questionIndex];
      const questionElement = document.querySelector(`[data-question-index="${questionIndex}"]`);
      if (questionElement && targetQuestion) {
        questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectQuestion(targetQuestion.id);
      }
    }
  };

  // 질문 번호 입력 핸들러
  const handleQuestionNumberKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const questionNumber = parseInt(questionNumberInput, 10);
      if (!isNaN(questionNumber) && questionNumber > 0) {
        scrollToQuestion(questionNumber);
        setQuestionNumberInput('');
      }
    }
  };

  return {
    showScrollButtons,
    questionNumberInput,
    setQuestionNumberInput,
    scrollToTop,
    scrollToBottom,
    handleQuestionNumberKeyPress,
  };
}
