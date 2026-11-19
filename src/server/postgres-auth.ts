import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './schema.ts';
import type {User} from '../shared.ts';
import type {PostgresDatabase} from './postgres.ts';
import {loginAttemptKey,loginAttemptLimit,loginAttemptWindowMs,LoginRateLimitError} from './login-policy.ts';

const usernameSchema=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/,'Use 3 to 64 letters, numbers, dots, underscores, or hyphens.');
const passwordSchema=z.string().min(12,'Use at least 12 characters.').max(128,'Use at most 128 characters.');
const digest=(value:string)=>createHash('sha256').update(value).digest();
const tokenHash=(value:string)=>digest(value).toString('hex');
const sessionDuration=30*86400_000;

export class PostgresHouseholdAuth {
 user:User|null=null;
 private readonly passwordDigest:Buffer;
 constructor(readonly database:PostgresDatabase,private readonly credentials:{username:string;password:string}){
  this.passwordDigest=digest(credentials.password);
 }
 async initialize(){
  const configured=!!this.credentials.username.trim()&&!!this.credentials.password;
  const username=configured?usernameSchema.parse(this.credentials.username):'';
  if(configured)passwordSchema.parse(this.credentials.password);
  await this.database.transaction(async()=>{
   await this.database.query(`CREATE TABLE IF NOT EXISTS household_auth(id INTEGER PRIMARY KEY CHECK(id=1),salt TEXT NOT NULL,verifier TEXT NOT NULL,generation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS household_sessions(hash TEXT PRIMARY KEY,generation TEXT NOT NULL,"expiresAt" BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS household_login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,"resetAt" BIGINT NOT NULL);`);
   const old=(await this.database.query('SELECT salt,verifier,generation FROM household_auth WHERE id=1')).rows[0];
   const salt=String(old?.salt??randomBytes(32).toString('hex'));
   const verifier=configured?scryptSync(username+'\0'+this.credentials.password,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024}).toString('hex'):'';
   const changed=!old||old.verifier!==verifier,generation=changed?randomUUID():String(old.generation);
   if(changed)await this.database.query('DELETE FROM household_sessions; DELETE FROM household_login_attempts;');
   await this.database.query('INSERT INTO household_auth VALUES (1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET verifier=excluded.verifier,generation=excluded.generation',[salt,verifier,generation]);
   this.user=configured?{id:generation,username}:null;
  });
 }
 async login(username:string,password:string,_ip:string,now=Date.now()){
  if(!this.user)throw new AppError('Sign-in setup is incomplete.',503);
  const user=this.user;
  // Return sign-in errors only after the failed-attempt counter commits.
  const result=await this.database.transaction(async()=>{
   if((await this.database.query('SELECT generation FROM household_auth WHERE id=1')).rows[0]?.generation!==user.id)return new AppError('Sign-in setup changed. Restart Babylog.',503);
   const key=loginAttemptKey;
   await this.database.query('DELETE FROM household_login_attempts WHERE "resetAt"<=$1',[now]);
   const attempts=(await this.database.query('SELECT count,"resetAt" FROM household_login_attempts WHERE key=$1',[key])).rows[0];
   if(attempts&&Number(attempts.count)>=loginAttemptLimit)return new LoginRateLimitError(Number(attempts.resetAt),now);
   const validName=timingSafeEqual(digest(username.trim().toLowerCase()),digest(user.username));
   const validPassword=timingSafeEqual(digest(password),this.passwordDigest);
   if(!validName||!validPassword){
    await this.database.query('INSERT INTO household_login_attempts VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=household_login_attempts.count+1',[key,now+loginAttemptWindowMs]);
    return new AppError('The username or password is incorrect.',401);
   }
   await this.database.query('DELETE FROM household_sessions WHERE "expiresAt"<=$1',[now]);
   const token=randomBytes(32).toString('hex');
   await this.database.query('INSERT INTO household_sessions VALUES ($1,$2,$3)',[tokenHash(token),user.id,now+sessionDuration]);
   return {token,user};
  });
  if(result instanceof AppError)throw result;
  return result;
 }
 async session(token:string,now=Date.now()){
  if(!this.user||!/^[a-f0-9]{64}$/.test(token))return null;
  const row=(await this.database.query('SELECT hash FROM household_sessions JOIN household_auth USING(generation) WHERE hash=$1 AND generation=$2 AND "expiresAt">$3',[tokenHash(token),this.user.id,now])).rows[0];
  return row?this.user:null;
 }
 async logout(token:string){await this.database.transaction(async()=>{await this.database.query('DELETE FROM household_sessions WHERE hash=$1',[tokenHash(token)]);});}
}
