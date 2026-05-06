'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONTACTS_QFIELDS, type ContactsQField } from '@/lib/operations/contacts';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';

interface ContactsFilterBarProps {
  initialQ: string;
  initialQField: ContactsQField;
  initialResultCode: string;
  resultCodeOptions: string[];
}

const QFIELD_LABEL: Record<ContactsQField, string> = {
  all: '전체',
  resid: '#',
  email: '이메일',
  group: '그룹',
  biz: '사업자번호',
};

export function ContactsFilterBar({
  initialQ,
  initialQField,
  initialResultCode,
  resultCodeOptions,
}: ContactsFilterBarProps) {
  const pushParams = useSearchParamsMutator();
  const [q, setQ] = useState(initialQ);
  const [qfield, setQField] = useState<ContactsQField>(initialQField);
  const [resultCode, setResultCode] = useState(initialResultCode);

  function applyFilters() {
    pushParams((sp) => {
      sp.delete('page');
      if (q.trim()) sp.set('q', q.trim()); else sp.delete('q');
      if (qfield !== 'all') sp.set('qfield', qfield); else sp.delete('qfield');
      if (resultCode !== 'all') sp.set('resultCode', resultCode); else sp.delete('resultCode');
    });
  }

  function reset() {
    setQ('');
    setQField('all');
    setResultCode('all');
    pushParams((sp) => {
      sp.delete('q');
      sp.delete('qfield');
      sp.delete('resultCode');
      sp.delete('page');
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex items-center gap-2">
        <Select value={qfield} onValueChange={(v) => setQField(v as ContactsQField)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONTACTS_QFIELDS.map((f) => <SelectItem key={f} value={f}>{QFIELD_LABEL[f]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
          placeholder="검색어"
          className="w-64"
        />
      </div>

      <Select value={resultCode} onValueChange={setResultCode}>
        <SelectTrigger className="w-44"><SelectValue placeholder="결과코드" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">결과코드 - 전체</SelectItem>
          {resultCodeOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>

      <Button onClick={applyFilters}>필터 적용</Button>
      <Button variant="outline" onClick={reset}>초기화</Button>
    </div>
  );
}
