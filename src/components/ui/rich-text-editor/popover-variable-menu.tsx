'use client';

import { useState } from 'react';

import { Tag } from 'lucide-react';

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';

import { ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './types';

interface Props {
  catalog: VariableDef[];
  onPick: (key: string) => void;
}

interface VariableGroup {
  heading: string;
  items: VariableDef[];
}

// 고르면 끼워 넣고 닫는 동작이라 선택 상태를 남기지 않는다(value 는 늘 null).
export function PopoverVariableMenu({ catalog, onPick }: Props) {
  const [open, setOpen] = useState(false);

  const groups: VariableGroup[] = [
    { heading: '컨택 데이터 (attrs)', items: catalog.filter((v) => v.category === 'attrs') },
    { heading: '시스템', items: catalog.filter((v) => v.category === 'system') },
  ].filter((g) => g.items.length > 0);

  return (
    <Combobox<VariableDef>
      items={groups}
      value={null}
      onValueChange={(v) => {
        if (!v) return;
        onPick(v.key);
        setOpen(false);
      }}
      itemToStringLabel={(v) => `${v.key} ${v.label}`}
      open={open}
      onOpenChange={setOpen}
    >
      <ComboboxTrigger render={<ToolBtn title="변수" />}>
        <Tag className="h-4 w-4" />
      </ComboboxTrigger>
      <ComboboxContent className="w-[280px]">
        <ComboboxInput showTrigger={false} placeholder="변수 검색..." />
        {catalog.length > 0 && (
          <ComboboxEmpty>일치하는 변수가 없습니다.</ComboboxEmpty>
        )}
        <ComboboxList className="max-h-[280px]">
          {(group: VariableGroup) => (
            <ComboboxGroup key={group.heading} items={group.items}>
              <ComboboxLabel>{group.heading}</ComboboxLabel>
              <ComboboxCollection>
                {(v: VariableDef) => (
                  <ComboboxItem key={`${v.category}-${v.key}`} value={v}>
                    <span className="font-mono text-xs text-amber-700">{`{{${v.key}}}`}</span>
                    <span className="ml-2 text-xs text-gray-500">{v.label}</span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        {catalog.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-500">
            이 설문에 컨택 attrs 가 등록되지 않았습니다.
            <br />
            <span className="text-gray-400">컨택리스트 → 리스트 업로드부터.</span>
          </div>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
