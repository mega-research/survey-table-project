'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { SurveyLookup } from '@/types/survey';
import { responsesToLookupShape, type BranchEvalCtx } from '@/utils/branch-eval';

const ContactAttrsContext = createContext<Record<string, string>>({});
const AnswerQuotesContext = createContext<Record<string, string>>({});
const SurveyLookupsContext = createContext<SurveyLookup[]>([]);

/** 매 렌더 새 객체가 만들어지지 않도록 quotes 생략 시 쓰는 고정 참조. */
const EMPTY_QUOTES: Record<string, string> = {};
/** lookups 생략 시 쓰는 고정 참조 — 매 렌더 새 배열이면 하위 memo 가 전부 깨진다. */
const EMPTY_LOOKUPS: SurveyLookup[] = [];

export function ContactAttrsProvider({
  attrs,
  quotes = EMPTY_QUOTES,
  lookups = EMPTY_LOOKUPS,
  children,
}: {
  attrs: Record<string, string>;
  /** 응답 인용값. {{{이름}}} 채널 전용이라 attrs 와 합치지 않고 따로 흘린다. */
  quotes?: Record<string, string>;
  /** 발행 스냅샷의 LUT 사본. 표 행·열 조건의 lookup 우변 평가에 필요하다. */
  lookups?: SurveyLookup[];
  children: ReactNode;
}) {
  return (
    <ContactAttrsContext.Provider value={attrs}>
      <SurveyLookupsContext.Provider value={lookups}>
        <AnswerQuotesContext.Provider value={quotes}>{children}</AnswerQuotesContext.Provider>
      </SurveyLookupsContext.Provider>
    </ContactAttrsContext.Provider>
  );
}

/**
 * 응답 페이지 컴포넌트가 prefill/치환에 사용할 attrs.
 * Provider 밖에서 호출하면 빈 Record 반환 — 빌더 미리보기·레거시 안전.
 */
export function useContactAttrs(): Record<string, string> {
  return useContext(ContactAttrsContext);
}

/**
 * 응답 인용값. substituteTokens 의 세 번째 인자로 넘긴다.
 * Provider 밖에서 호출하면 빈 Record 반환 — 빌더 미리보기·레거시 안전.
 */
export function useAnswerQuotes(): Record<string, string> {
  return useContext(AnswerQuotesContext);
}

/**
 * 빌더 테스트 모드 전용 attrs Proxy.
 * 키가 존재(빈 문자열 포함)하면 실제 값 — 응답 페이지와 동일하게 표시.
 * 미정의 키는 `[key]` placeholder 로 가시화 — 어떤 토큰이 비어있는지 운영자가 인지 가능.
 */
export function createPlaceholderAttrs(actual: Record<string, string>): Record<string, string> {
  return new Proxy(actual, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : `[${key}]`;
    },
  }) as Record<string, string>;
}

/**
 * 응답 페이지 스냅샷의 LUT 사본.
 * Provider 밖에서 호출하면 빈 배열 반환 — 빌더 미리보기·레거시 안전.
 */
export function useSurveyLookups(): SurveyLookup[] {
  return useContext(SurveyLookupsContext);
}

/**
 * 표 행·열 displayCondition 평가용 BranchEvalCtx.
 *
 * `shouldDisplayRow`/`shouldDisplayColumn` 의 ctx 인자를 빠뜨리면 `attr` 피연산자가 항상
 * undefined 가 되어 `!=` 비교가 무조건 참이 된다 — 조건이 조용히 무력화된다(2026-09-08 사고).
 * 렌더 경로는 이 훅으로 ctx 를 만들고, ctx 를 빠뜨리지 말 것.
 */
export function useBranchEvalCtx(allResponses: Record<string, unknown> | undefined): BranchEvalCtx {
  const attrs = useContactAttrs();
  const quotes = useAnswerQuotes();
  const lookups = useSurveyLookups();
  return useMemo(
    () => ({
      responses: responsesToLookupShape(allResponses ?? {}),
      contactAttrs: { ...attrs, ...quotes },
      lookups,
    }),
    [allResponses, attrs, quotes, lookups],
  );
}
