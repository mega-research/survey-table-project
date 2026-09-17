'use client';

import { useMutation } from '@tanstack/react-query';

import { client } from '@/shared/lib/rpc';

// ========================
// Mutations
// ========================
//
// 캠페인 마법사(campaign-wizard)의 명령형 호출들을 useMutation 으로 감싼다.
// 호출측에서 mutateAsync 로 직접 await 하고, 에러 표시(alert)·이동 등의
// 부수효과는 onSuccess/onError 콜백 또는 호출측 try/catch 에서 그대로 처리한다.

/**
 * 필터 조건에 해당하는 후보 조사 대상 id 전체 조회 (전체 선택용)
 */
export function useFetchCandidateIds() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.mail.campaigns.fetchCandidateIds>[0]) =>
      client.mail.campaigns.fetchCandidateIds(input),
  });
}

/**
 * 발송 전 preflight 미리보기 (실제 발송/제외 인원 집계)
 */
export function usePreviewPreflight() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.mail.campaigns.previewPreflight>[0]) =>
      client.mail.campaigns.previewPreflight(input),
  });
}

/**
 * 단체 메일 캠페인 생성 (발송 시작)
 */
export function useCreateCampaign() {
  return useMutation({
    mutationFn: (input: Parameters<typeof client.mail.campaigns.create>[0]) =>
      client.mail.campaigns.create(input),
  });
}
