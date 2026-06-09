'use client';

import { useMutation } from '@tanstack/react-query';

import { client } from '@/shared/lib/rpc';

// ========================
// Mutations
// ========================
//
// 조사 대상 엑셀 업로드 마법사(upload-wizard)의 명령형 호출들을 useMutation 으로 감싼다.
// 호출측에서 mutateAsync 로 직접 await 하고, 에러 표시(setError)·RSC 캐시 무효화
// (router.refresh)는 onSuccess/onError 콜백 또는 호출측 try/catch 에서 그대로 처리한다.

/**
 * 엑셀 파일 파싱 미리보기 (헤더·시트·첫 5행)
 */
export function useParseExcelPreview() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.contacts.uploads.parsePreview>[0]) =>
      client.contacts.uploads.parsePreview(input),
  });
}

/**
 * 파싱된 엑셀을 조사 대상 명단으로 적재 (ingest)
 */
export function useIngestContacts() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.contacts.uploads.ingest>[0]) =>
      client.contacts.uploads.ingest(input),
  });
}
