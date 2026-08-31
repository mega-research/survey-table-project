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
 * 이월 응답 임포트 — 시트/헤더 행을 고른 뒤 컬럼과 문항을 잇는 자동 제안 (추적조사).
 * 명단 업로드와 다른 경로다: 매핑은 문항이 있어야 가능하고, 명단 경로를 다시 타면
 * 이미 발송한 개별 링크가 재발급된다.
 */
export function useSuggestPriorAnswerMapping() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.contacts.priorAnswers.suggestMapping>[0]) =>
      client.contacts.priorAnswers.suggestMapping(input),
  });
}

/** 이월 응답 적재 (dryRun 이면 계산만). */
export function useImportPriorAnswers() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.contacts.priorAnswers.import>[0]) =>
      client.contacts.priorAnswers.import(input),
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

/**
 * 병합/중복검사 dry-run 매칭 미리보기
 */
export function useMatchContacts() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.contacts.uploads.matchPreview>[0]) =>
      client.contacts.uploads.matchPreview(input),
  });
}
