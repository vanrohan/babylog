import type {PostgresStore} from './postgres-store.ts';
import type {PostgresHouseholdAuth} from './postgres-auth.ts';

export type DiaryStore=Omit<PostgresStore,'database'|'initialize'|'close'>;
export type HouseholdAuthentication=Pick<PostgresHouseholdAuth,'user'|'login'|'session'|'logout'>;
