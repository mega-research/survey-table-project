import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

// 환경 변수에서 데이터베이스 URL 가져오기
const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
}

// postgres.js 클라이언트 생성
// Supabase Transaction pooler(6543, pgBouncer) 사용 → prepare: false 필수.
// Vercel 서버리스 인스턴스 하나는 여러 요청을 동시에 처리하므로(Node async),
// max:1 이면 동시 요청이 단일 커넥션 뒤에 무한 대기 큐로 쌓여 300초 후 504가 난다.
// 특히 list 조회는 Promise.all 로 커넥션 2개를 동시에 요구해 max:1 에서 교착된다.
// 트랜잭션 pooler 는 서버리스용으로 다수 커넥션을 흡수하므로 인스턴스당 소량(5)으로 올린다.
const client = postgres(connectionString, {
  prepare: false,
  max: process.env.NODE_ENV === 'production' ? 5 : 10, // 동시 요청 직렬화/교착 방지 (pooler가 멀티플렉싱)
  idle_timeout: 20, // 유휴 연결 타임아웃 (초)
  connect_timeout: 10, // 연결 타임아웃 (초)
  max_lifetime: 60 * 30, // 최대 연결 수명 (30분)
});

// Drizzle ORM 인스턴스 생성
export const db = drizzle(client, { schema });

// 스키마 export
export * from './schema';
