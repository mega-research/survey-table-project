import { useCallback, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useTestResponseStore } from '@/stores/test-response-store';
import type { DynamicRowGroupConfig, TableRow } from '@/types/survey';

interface UseDynamicRowStateParams {
  questionId: string;
  rows: TableRow[];
  dynamicRowConfigs?: DynamicRowGroupConfig[];
  isTestMode: boolean;
  value?: Record<string, any>;
  onChange?: (v: Record<string, any>) => void;
}

interface UseDynamicRowStateReturn {
  currentResponse: Record<string, any>;
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

export function useDynamicRowState({
  questionId,
  rows,
  dynamicRowConfigs,
  isTestMode,
  value,
  onChange,
}: UseDynamicRowStateParams): UseDynamicRowStateReturn {
  const { testQuestionResponse, updateTestResponse } = useTestResponseStore(
    useShallow((s) => ({
      testQuestionResponse: s.testResponses[questionId],
      updateTestResponse: s.updateTestResponse,
    })),
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
    if (isTestMode) {
      return typeof testQuestionResponse === 'object' && testQuestionResponse !== null
        ? (testQuestionResponse as Record<string, any>)
        : {};
    }
    return (value || {}) as Record<string, any>;
  }, [isTestMode, testQuestionResponse, value]);

  const groupConfigMap = useMemo(() => {
    if (!dynamicRowConfigs || !Array.isArray(dynamicRowConfigs)) return new Map<string, DynamicRowGroupConfig>();
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
  dynamicRowsRef.current = dynamicRows;
  const selectedRowIdsRef = useRef(selectedRowIds);
  selectedRowIdsRef.current = selectedRowIds;
  const valueRef = useRef(value);
  valueRef.current = value;

  const handleDynamicRowSelect = useCallback(
    (rowIdsFromModal: string[]) => {
      const currentDynamicRows = dynamicRowsRef.current;
      const currentSelectedRowIds = selectedRowIdsRef.current;

      const thisGroupRowIds = new Set(
        currentDynamicRows.filter((r) => r.dynamicGroupId === activeGroupId).map((r) => r.id),
      );
      const otherSelections = currentSelectedRowIds.filter((id) => !thisGroupRowIds.has(id));
      const merged = [...new Set([...otherSelections, ...rowIdsFromModal])];

      if (isTestMode) {
        const currentState = useTestResponseStore.getState();
        const latestResponse =
          typeof currentState.testResponses[questionId] === 'object'
            ? currentState.testResponses[questionId]
            : {};
        updateTestResponse(questionId, {
          ...(latestResponse as Record<string, any>),
          __selectedRowIds: merged,
        });
      } else if (onChange) {
        onChange({
          ...((valueRef.current || {}) as Record<string, any>),
          __selectedRowIds: merged,
        });
      }

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
    [isTestMode, questionId, updateTestResponse, onChange, activeGroupId],
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
