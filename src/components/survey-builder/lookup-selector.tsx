'use client';

import { useState } from 'react';

import { nanoid } from 'nanoid';

import { upsertSurveyLookupAction } from '@/actions/lookup-actions';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { SavedLookup, SurveyLookup } from '@/types/survey';

import { LookupEditModal } from './lookup-edit-modal';

type LookupDraft = Pick<
  SavedLookup,
  'name' | 'description' | 'category' | 'tags' | 'columns' | 'rows'
>;

const NONE_SENTINEL = '__none__';

interface Props {
  value: string; // surveyLookupId — 빈 문자열이면 미선택
  onChange: (id: string, lookup: SurveyLookup) => void;
}

/**
 * 분기 조건 우변용 LUT 셀렉터.
 * - 현재 설문에 등록된 LUT 만 노출 (보관함 SavedLookup 은 보관함 패널에서 Copy 후 노출).
 * - "+ 새 LUT" 버튼은 LookupEditModal 을 열어 인라인으로 새 LUT 를 만들고 즉시 선택.
 */
export function LookupSelector({ value, onChange }: Props) {
  const surveyId = useSurveyBuilderStore((s) => s.currentSurvey.id);
  const lookups = useSurveyBuilderStore((s) => s.currentSurvey.lookups ?? []);
  const refetchSurvey = useSurveyBuilderStore((s) => s.refetchSurvey);
  const [editOpen, setEditOpen] = useState(false);

  const handleQuickCreate = async (draft: LookupDraft) => {
    if (!surveyId) return;
    const saved = await upsertSurveyLookupAction(surveyId, {
      id: nanoid(),
      name: draft.name,
      columns: draft.columns,
      rows: draft.rows,
    });
    setEditOpen(false);
    await refetchSurvey();
    onChange(saved.id, saved);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Select
          value={value || NONE_SENTINEL}
          onValueChange={(v) => {
            if (v === NONE_SENTINEL) return;
            const found = lookups.find((l) => l.id === v);
            if (found) onChange(v, found);
          }}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="설문에 등록된 LUT 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_SENTINEL} disabled>
              — 미선택 —
            </SelectItem>
            {lookups.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          + 새 LUT
        </Button>
      </div>
      {lookups.length === 0 && (
        <div className="text-xs text-gray-500">
          이 설문에 등록된 LUT 이 없습니다. 보관함에서 불러오거나 직접 만드세요.
        </div>
      )}
      {editOpen && (
        <LookupEditModal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          onSave={handleQuickCreate}
        />
      )}
    </div>
  );
}
