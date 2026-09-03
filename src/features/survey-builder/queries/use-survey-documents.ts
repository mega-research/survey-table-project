'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { client, orpc } from '@/shared/lib/rpc';

export const surveyDocumentKeys = {
  all: ['survey-documents'] as const,
  list: (surveyId: string) => [...surveyDocumentKeys.all, surveyId] as const,
};

/** 설문에 붙은 조사표 목록. */
export function useSurveyDocuments(surveyId: string | undefined) {
  return useQuery({
    queryKey: surveyDocumentKeys.list(surveyId ?? ''),
    queryFn: () => orpc.surveyDocument.documents.list.call({ surveyId: surveyId! }),
    enabled: !!surveyId,
  });
}

/**
 * 업로드 → attach 2단. 업로드 라우트가 tmp 에 받고 쪽 수를 읽어 돌려주면,
 * attach 가 영구 위치로 옮기며 행을 만든다.
 */
export function useAttachSurveyDocument(surveyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, replaceDocumentId }: { file: File; replaceDocumentId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/survey-document', { method: 'POST', body: formData });
      const payload: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : '조사표 업로드에 실패했습니다.';
        throw new Error(message);
      }
      const uploaded = payload as { key: string; filename: string; pageCount: number };
      return client.surveyDocument.documents.attach({
        surveyId,
        key: uploaded.key,
        filename: uploaded.filename,
        pageCount: uploaded.pageCount,
        ...(replaceDocumentId ? { replaceDocumentId } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: surveyDocumentKeys.list(surveyId) });
    },
  });
}

export function useRemoveSurveyDocument(surveyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      client.surveyDocument.documents.remove({ surveyId, documentId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: surveyDocumentKeys.list(surveyId) });
    },
  });
}
