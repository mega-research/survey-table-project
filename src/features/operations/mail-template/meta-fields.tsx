'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface MetaFieldValues {
  name: string;
  subject: string;
  fromLocal: string;
  fromName: string;
  replyTo: string;
}

interface Props {
  values: MetaFieldValues;
  onChange: (next: MetaFieldValues) => void;
  fromDomain: string;
}

export function MetaFields({ values, onChange, fromDomain }: Props) {
  const set = <K extends keyof MetaFieldValues>(key: K, v: MetaFieldValues[K]) => {
    onChange({ ...values, [key]: v });
  };

  return (
    <div className="space-y-5">
      <Field label="템플릿 이름" required>
        <Input
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="예: 한국전시산업진흥회 초대 메일"
          maxLength={100}
        />
      </Field>

      <Field label="메일 제목" required>
        <Input
          value={values.subject}
          onChange={(e) => set('subject', e.target.value)}
          placeholder="예: 해외전시회 지원사업 성과조사 안내"
          maxLength={255}
        />
      </Field>

      <Field label="보낸이 표시명" required>
        <Input
          value={values.fromName}
          onChange={(e) => set('fromName', e.target.value)}
          placeholder="예: 한국전시산업진흥회"
          maxLength={100}
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="보낸이 계정" required>
          <div className="flex items-stretch">
            <Input
              value={values.fromLocal}
              onChange={(e) => set('fromLocal', e.target.value)}
              placeholder="survey"
              maxLength={64}
              className="rounded-r-none"
            />
            <span className="flex items-center rounded-r-md border border-l-0 border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
              @{fromDomain}
            </span>
          </div>
        </Field>

        <Field label="답장 받을 메일" required>
          <Input
            type="email"
            value={values.replyTo}
            onChange={(e) => set('replyTo', e.target.value)}
            placeholder="info@example.kr"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-gray-900">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
