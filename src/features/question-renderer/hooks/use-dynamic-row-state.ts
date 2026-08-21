import { useCallback, useMemo, useRef, useState } from 'react';

import { useQuestionResponseWriter } from '@/features/question-renderer/hooks/use-question-response-writer';
import {
  useQuestionResponseSelector,
  useResponseSources,
} from '@/features/question-renderer/response-sources';
import { useSyncLatestRef } from '@/hooks/use-latest-ref';
import type { DynamicRowGroupConfig, TableRow } from '@/types/survey';

interface UseDynamicRowStateParams {
  questionId: string;
  rows: TableRow[];
  dynamicRowConfigs?: DynamicRowGroupConfig[] | undefined;
  value?: Record<string, unknown> | undefined;
  onChange?: ((v: Record<string, unknown>) => void) | undefined;
}

interface UseDynamicRowStateReturn {
  currentResponse: Record<string, unknown>;
  groupConfigMap: Map<string, DynamicRowGroupConfig>;
  dynamicRows: TableRow[];
  hasDynamicRows: boolean;
  selectedRowIds: string[];
  activeGroupId: string | null;
  handleSelectGroup: (id: string) => void;
  handleDynamicRowSelect: (rowIds: string[]) => void;
  closeModal: () => void;
  expandedGroupIds: Set<string>;
  toggleGroupExpanded: (groupId: string) => void;
}

/** 질문 응답 통째 구독용 안정 selector — 훅 밖 상수라 매 렌더 새 함수가 되지 않는다. */
const selectQuestionResponse = (questionResponse: unknown) => questionResponse;

export function useDynamicRowState({
  questionId,
  rows,
  dynamicRowConfigs,
  value,
  onChange,
}: UseDynamicRowStateParams): UseDynamicRowStateReturn {
  const { questionResponses: source } = useResponseSources();
  const sourceQuestionResponse = useQuestionResponseSelector(
    source,
    questionId,
    selectQuestionResponse,
  );

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const currentResponse = useMemo(() => {
    if (source) {
      return typeof sourceQuestionResponse === 'object' && sourceQuestionResponse !== null
        ? (sourceQuestionResponse as Record<string, unknown>)
        : {};
    }
    return value || {};
  }, [source, sourceQuestionResponse, value]);

  const groupConfigMap = useMemo(() => {
    if (!dynamicRowConfigs || !Array.isArray(dynamicRowConfigs))
      return new Map<string, DynamicRowGroupConfig>();
    return new Map(dynamicRowConfigs.filter((g) => g.enabled).map((g) => [g.groupId, g]));
  }, [dynamicRowConfigs]);

  const dynamicRows = useMemo(
    () => rows.filter((r) => r.dynamicGroupId && groupConfigMap.has(r.dynamicGroupId)),
    [rows, groupConfigMap],
  );
  const hasDynamicRows = dynamicRows.length > 0;

  const selectedRowIds = useMemo(
    () => [...new Set((currentResponse?.['__selectedRowIds'] as string[]) || [])],
    [currentResponse],
  );

  // ref 패턴으로 안정적 참조 유지
  const dynamicRowsRef = useRef(dynamicRows);
  useSyncLatestRef(dynamicRowsRef, dynamicRows);
  const selectedRowIdsRef = useRef(selectedRowIds);
  useSyncLatestRef(selectedRowIdsRef, selectedRowIds);

  // adapter 별 병합·커밋 의식은 질문 응답 쓰기 채널이 소유
  const mergePatch = useQuestionResponseWriter({ questionId, value, onChange });

  const handleDynamicRowSelect = useCallback(
    (rowIdsFromModal: string[]) => {
      const currentDynamicRows = dynamicRowsRef.current;
      const currentSelectedRowIds = selectedRowIdsRef.current;

      const thisGroupRowIds = new Set(
        currentDynamicRows.filter((r) => r.dynamicGroupId === activeGroupId).map((r) => r.id),
      );
      const otherSelections = currentSelectedRowIds.filter((id) => !thisGroupRowIds.has(id));
      const merged = [...new Set([...otherSelections, ...rowIdsFromModal])];

      mergePatch({ __selectedRowIds: merged });

      // 모달에서 행을 선택했으면 해당 그룹 자동 펼침
      if (activeGroupId && rowIdsFromModal.length > 0) {
        setExpandedGroupIds((prev) => {
          if (prev.has(activeGroupId)) return prev;
          const next = new Set(prev);
          next.add(activeGroupId);
          return next;
        });
      }
    },
    [mergePatch, activeGroupId],
  );

  const handleSelectGroup = useCallback((groupId: string) => {
    setActiveGroupId(groupId);
  }, []);

  const closeModal = useCallback(() => {
    setActiveGroupId(null);
  }, []);

  return {
    currentResponse,
    groupConfigMap,
    dynamicRows,
    hasDynamicRows,
    selectedRowIds,
    activeGroupId,
    handleSelectGroup,
    handleDynamicRowSelect,
    closeModal,
    expandedGroupIds,
    toggleGroupExpanded,
  };
}
