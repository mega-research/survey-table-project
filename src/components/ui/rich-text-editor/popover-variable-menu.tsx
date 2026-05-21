'use client';

import { useState } from 'react';

import { Tag } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { ToolBtn } from './toolbar-primitives';
import type { VariableDef } from './types';

interface Props {
  catalog: VariableDef[];
  onPick: (key: string) => void;
}

export function PopoverVariableMenu({ catalog, onPick }: Props) {
  const [open, setOpen] = useState(false);

  const attrs = catalog.filter((v) => v.category === 'attrs');
  const system = catalog.filter((v) => v.category === 'system');

  const handlePick = (key: string) => {
    onPick(key);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolBtn title="변수">
          <Tag className="h-4 w-4" />
        </ToolBtn>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="변수 검색..." />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>일치하는 변수가 없습니다.</CommandEmpty>
            {attrs.length > 0 && (
              <CommandGroup heading="컨택 데이터 (attrs)">
                {attrs.map((v) => (
                  <CommandItem
                    key={v.key}
                    value={`attrs-${v.key}`}
                    onSelect={() => handlePick(v.key)}
                  >
                    <span className="font-mono text-xs text-amber-700">{`{{${v.key}}}`}</span>
                    <span className="ml-2 text-xs text-gray-500">{v.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {system.length > 0 && (
              <CommandGroup heading="시스템">
                {system.map((v) => (
                  <CommandItem
                    key={v.key}
                    value={`system-${v.key}`}
                    onSelect={() => handlePick(v.key)}
                  >
                    <span className="font-mono text-xs text-amber-700">{`{{${v.key}}}`}</span>
                    <span className="ml-2 text-xs text-gray-500">{v.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {catalog.length === 0 && (
              <div className="p-4 text-center text-xs text-gray-500">
                이 설문에 컨택 attrs 가 등록되지 않았습니다.
                <br />
                <span className="text-gray-400">컨택리스트 → 리스트 업로드부터.</span>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
