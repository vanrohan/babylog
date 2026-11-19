import {AppError} from './schema.ts';

// A shared limit prevents bypass through changed usernames or addresses.
export const loginAttemptKey='household';
export const loginAttemptLimit=10;
export const loginAttemptWindowMs=15*60_000;

export class LoginRateLimitError extends AppError {
 readonly retryAfter:number;
 constructor(resetAt:number,now:number){
  const seconds=Math.max(1,Math.ceil((resetAt-now)/1000));
  const count=seconds<60?seconds:Math.ceil(seconds/60),unit=seconds<60?'second':'minute';
  super(`Too many sign-in attempts. Try again in ${count} ${unit}${count===1?'':'s'}.`,429);
  this.retryAfter=seconds;
 }
}
