import { describe, expect, it } from 'vitest';

import {
  AddContactTargetInput,
  PiiUpdateSchema,
  UpdateContactTargetInput,
} from './contact-target';

describe('PiiUpdateSchema fieldType 검증', () => {
  it('유효한 PII fieldType 은 통과한다', () => {
    const res = PiiUpdateSchema.safeParse({
      columnKey: 'email',
      fieldType: 'email',
      plain: 'real@new.com',
    });
    expect(res.success).toBe(true);
  });

  // 회귀: z.custom 은 런타임 검증이 없어 오탈자가 통과했고, 그 값이
  // normalizePii(default 없는 switch) → undefined → blindIndex '' →
  // upsertPiiValue 의 DELETE 분기로 이어져 기존 PII 행을 영구 삭제했다.
  it('유니온에 없는 fieldType(오탈자)은 거부한다', () => {
    const res = PiiUpdateSchema.safeParse({
      columnKey: 'email',
      fieldType: 'e-mail',
      plain: 'real@new.com',
    });
    expect(res.success).toBe(false);
  });

  it('빈 문자열 fieldType 도 거부한다', () => {
    const res = PiiUpdateSchema.safeParse({
      columnKey: 'email',
      fieldType: '',
      plain: 'real@new.com',
    });
    expect(res.success).toBe(false);
  });
});

describe('AddContactTargetInput / UpdateContactTargetInput piiUpdates 검증', () => {
  it('add: piiUpdates 의 잘못된 fieldType 은 입력 전체를 거부한다', () => {
    const res = AddContactTargetInput.safeParse({
      surveyId: 'sv-1',
      attrs: { name: '홍길동' },
      piiUpdates: [{ columnKey: 'email', fieldType: 'e-mail', plain: 'real@new.com' }],
    });
    expect(res.success).toBe(false);
  });

  it('update: piiUpdates 의 잘못된 fieldType 은 입력 전체를 거부한다', () => {
    const res = UpdateContactTargetInput.safeParse({
      id: 'ct-1',
      surveyId: 'sv-1',
      attrs: {},
      piiUpdates: [{ columnKey: 'email', fieldType: 'e-mail', plain: 'real@new.com' }],
    });
    expect(res.success).toBe(false);
  });

  it('update: 올바른 fieldType 은 통과한다', () => {
    const res = UpdateContactTargetInput.safeParse({
      id: 'ct-1',
      surveyId: 'sv-1',
      attrs: {},
      piiUpdates: [{ columnKey: 'email', fieldType: 'email', plain: 'real@new.com' }],
    });
    expect(res.success).toBe(true);
  });
});
