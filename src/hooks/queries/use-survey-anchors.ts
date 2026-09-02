'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AnchorOwnerKind,
  AnchorRect,
} from '@/features/survey-document/domain/survey-anchor';
import { client, orpc } from '@/shared/lib/rpc';

export const surveyAnchorKeys = {
  all: ['survey-anchors'] as const,
  list: (surveyId: string) => [...surveyAnchorKeys.all, surveyId] as const,
};

/** 설문의 라이브 앵커 전량. 발행 스냅샷의 얼린 앵커와는 다른 것이다 (ADR 0020). */
export function useSurveyAnchors(surveyId: string | undefined) {
  return useQuery({
    queryKey: surveyAnchorKeys.list(surveyId ?? ''),
    queryFn: () => orpc.surveyDocument.anchors.list.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

export function useCreateSurveyAnchor(surveyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      documentId: string;
      ownerKind: AnchorOwnerKind;
      ownerId: string;
      rect: AnchorRect;
    }) => client.surveyDocument.anchors.create({ surveyId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: surveyAnchorKeys.list(surveyId) });
    },
  });
}

export function useRemoveSurveyAnchor(surveyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (anchorId: string) =>
      client.surveyDocument.anchors.remove({ surveyId, anchorId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: surveyAnchorKeys.list(surveyId) });
    },
  });
}
