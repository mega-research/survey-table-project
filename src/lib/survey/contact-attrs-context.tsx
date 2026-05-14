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
