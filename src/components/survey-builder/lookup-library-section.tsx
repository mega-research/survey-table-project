'use client';

import { useEffect, useState } from 'react';

import { Database, Pencil, Plus, Trash2, Upload } from 'lucide-react';

import {
  copySavedLookupToSurveyAction,
  createSavedLookupAction,
  deleteSavedLookupAction,
  listSavedLookupsAction,
  updateSavedLookupAction,
} from '@/actions/lookup-actions';
import { Button } from '@/components/ui/button';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { SavedLookup } from '@/types/survey';

import { LookupCsvImport } from './lookup-csv-import';
import { LookupEditModal } from './lookup-edit-modal';

type LookupDraft = Pick<
  SavedLookup,
  'name' | 'description' | 'category' | 'tags' | 'columns' | 'rows'
>;

interface CsvImportResult {
  columns: string[];
  rows: Array<Record<string, string | number>>;
}

export function LookupLibrarySection() {
  const surveyId = useSurveyBuilderStore((s) => s.currentSurvey.id);

  const [items, setItems] = useState<SavedLookup[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [editInitial, setEditInitial] = useState<Partial<LookupDraft> | undefined>(undefined);
  // 편집 중인 항목 id — null 이면 새로 만들기, 있으면 기존 LUT 수정.
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = async () => {
    const list = await listSavedLookupsAction();
    setItems(list);
  };

  useEffect(() => {
    void reload();
  }, []);

  const closeEdit = () => {
    setEditOpen(false);
    setEditingId(null);
    setEditInitial(undefined);
  };

  const handleNew = () => {
    setEditingId(null);
    setEditInitial(undefined);
    setEditOpen(true);
  };

  const handleEdit = (lut: SavedLookup) => {
    setEditingId(lut.id);
    setEditInitial({
      name: lut.name,
      description: lut.description,
      category: lut.category,
      tags: lut.tags,
      columns: lut.columns,
      rows: lut.rows,
    });
    setEditOpen(true);
  };

  const handleDelete = async (lut: SavedLookup) => {
    if (!confirm(`보관함에서 "${lut.name}" 을(를) 삭제할까요?`)) return;
    await deleteSavedLookupAction(lut.id);
    await reload();
  };

  const handleCsvImported = (result: CsvImportResult) => {
    setEditingId(null);
    setEditInitial({
      name: '',
      category: 'custom',
      tags: [],
      columns: result.columns,
      rows: result.rows,
    });
    setEditOpen(true);
  };

  const handleSave = async (draft: LookupDraft) => {
    if (editingId) {
      await updateSavedLookupAction(editingId, draft);
    } else {
      await createSavedLookupAction(draft);
    }
    closeEdit();
    await reload();
  };

  const handleAddToSurvey = async (savedLookupId: string) => {
    if (!surveyId) return;
    await copySavedLookupToSurveyAction(surveyId, savedLookupId);
    await reload();
  };

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
        <Database size={14} />
        외부 데이터
      </div>

      <ul className="space-y-1 px-3 pb-2">
        {items.length === 0 ? (
          <li className="text-xs text-gray-400">등록된 LUT 없음</li>
        ) : (
          items.map((lut) => (
            <li key={lut.id} className="group flex items-center justify-between gap-2 py-1">
              <span className="truncate text-sm" title={lut.name}>
                {lut.name}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleEdit(lut)}
                  className="text-gray-400 hover:text-gray-700"
                  title="편집"
                  aria-label="LUT 편집"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(lut)}
                  className="text-gray-400 hover:text-red-500"
                  title="삭제"
                  aria-label="LUT 삭제"
                >
                  <Trash2 size={12} />
                </button>
                <button
                  type="button"
                  className="text-blue-600 hover:text-blue-700"
                  onClick={() => void handleAddToSurvey(lut.id)}
                  title="이 설문에 추가"
                  aria-label="이 설문에 추가"
                >
                  <Plus size={14} />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="flex gap-2 px-3 pt-1">
        <Button variant="outline" size="sm" onClick={handleNew}>
          <Plus size={12} className="mr-1" />새 LUT
        </Button>
        <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
          <Upload size={12} className="mr-1" />
          엑셀 가져오기
        </Button>
      </div>

      <LookupEditModal
        isOpen={editOpen}
        initialValue={editInitial}
        onClose={closeEdit}
        onSave={handleSave}
      />
      <LookupCsvImport
        isOpen={csvOpen}
        onClose={() => setCsvOpen(false)}
        onImport={handleCsvImported}
      />
    </div>
  );
}
