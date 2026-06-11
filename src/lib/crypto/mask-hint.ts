import type { PiiFieldType } from './pii-fields';

/**
 * 컨택 목록의 PII 마스킹 표시. 앞부분만 노출하고 뒤는 "..." 으로 가린다.
 * - email: 'asd...@nav...' (local 앞 3 + domain 앞 3)
 * - mobile (010-): '010-22...' (앞 5자리)
 * - phone (일반): '02-345...' / '031-555...' (앞 6자리)
 * - biz_number: '123-45...' (앞 5자리, 표준 XXX-XX-XXXXX 형식 일부)
 * - name / representative: '김**' (첫 글자 + ** )
 * - address: '서울특별시...' (앞 6자 + '...', 공백 없는 한글 주소도 전체 노출 방지)
 */
export function maskHint(fieldType: PiiFieldType, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  switch (fieldType) {
    case 'email': {
      const at = trimmed.lastIndexOf('@');
      if (at <= 0 || at === trimmed.length - 1) return '';
      const local = trimmed.slice(0, at);
      const domain = trimmed.slice(at + 1).toLowerCase();
      const localShown = local.slice(0, Math.min(3, local.length));
      const dotIdx = domain.indexOf('.');
      const domainHead = dotIdx > 0 ? domain.slice(0, dotIdx) : domain;
      const domainShown = domainHead.slice(0, Math.min(3, domainHead.length));
      return `${localShown}...@${domainShown}...`;
    }
    case 'mobile': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      if (digits.startsWith('010') && digits.length === 11) {
        return `010-${digits.slice(3, 5)}...`;
      }
      // 011/016/017/018/019 류
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}...`;
    }
    case 'phone': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      // 02-XXX... (서울)
      if (digits.startsWith('02') && digits.length >= 9) {
        return `02-${digits.slice(2, 5)}...`;
      }
      // 0XX-XXX... (지역번호 3자리)
      if (digits.length >= 10) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}...`;
      }
      return `${digits.slice(0, 5)}...`;
    }
    case 'biz_number': {
      const digits = trimmed.replace(/[^0-9]/g, '');
      if (digits.length < 5) return '';
      // 표준 XXX-XX-XXXXX → 앞 5자리(XXX-XX) 노출
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}...`;
    }
    case 'name':
    case 'representative': {
      const first = [...trimmed][0];
      return first ? `${first}**` : '';
    }
    case 'address': {
      // 첫 단어만 노출하되, 공백 없는 한글 주소('서울특별시강남구...')는
      // split 결과가 단일 토큰이라 전체가 그대로 노출된다. 코드포인트 기준
      // 앞 6자만 보여주고 그보다 길거나 뒤에 다른 토큰이 있으면 '...' 으로 가린다.
      const ADDRESS_PREFIX_LEN = 6;
      const tokens = trimmed.split(/\s+/);
      const first = tokens[0] ?? '';
      if (!first) return '';
      const firstChars = [...first];
      const head = firstChars.slice(0, ADDRESS_PREFIX_LEN).join('');
      const truncated = firstChars.length > ADDRESS_PREFIX_LEN || tokens.length > 1;
      return truncated ? `${head}...` : head;
    }
  }
}
