'use client';

import { createContext, useContext, type ReactNode } from 'react';

const ContactAttrsContext = createContext<Record<string, string>>({});

export function ContactAttrsProvider({
  attrs,
  children,
}: {
  attrs: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <ContactAttrsContext.Provider value={attrs}>{children}</ContactAttrsContext.Provider>
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
