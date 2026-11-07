import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
describe('AuthGuard confirmed email',()=>{
  const originalFetch=global.fetch;const original={...process.env};
  afterEach(()=>{global.fetch=originalFetch;process.env={...original};});
  it.each([null,'2026-11-07T00:00:00Z'])('takes email and confirmation from verified Auth response (%s)',async confirmed=>{
    process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-only';
    const req:any={headers:{authorization:'Bearer local-token'}};
    global.fetch=jest.fn(async()=>new Response(JSON.stringify({id:'local-user',email:'current@example.com',email_confirmed_at:confirmed,user_metadata:{email:'forged@example.com'}}),{status:200}));
    await new AuthGuard().canActivate({switchToHttp:()=>({getRequest:()=>req})} as unknown as ExecutionContext);
    expect(req.user).toEqual({id:'local-user',email:'current@example.com',emailConfirmed:!!confirmed});
  });
});
