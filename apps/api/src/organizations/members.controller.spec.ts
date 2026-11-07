import { ForbiddenException } from '@nestjs/common';
import { MembersController, invitationStatus } from './members.controller';
import { DbService, AuthUser } from '../db/db.service';
import { InvitationMailer } from './invitation-mailer';

const org='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const user:AuthUser={id:'33333333-3333-4333-8333-333333333333',email:'owner@example.com',emailConfirmed:true};
const body={request_id:id,email:'INVITED@example.com',role:'reviewer' as const};
function setup() {
  let stored:any=null;
  const tx={
    $queryRaw:jest.fn(async()=>[]),
    organization_members:{findFirst:jest.fn(async(_args?:any)=>({id:'member',role:'owner'})),deleteMany:jest.fn(async()=>({count:1})),updateMany:jest.fn(async()=>({count:1}))},
    organization_invitations:{findFirst:jest.fn(async({where}:any)=>where.id?stored:null),create:jest.fn(async({data}:any)=>stored={...data,accepted_at:null}),deleteMany:jest.fn()},
    organizations:{findUniqueOrThrow:jest.fn(async()=>({name_ar:'منشأة',name_en:'Organization'}))},
    users:{findUnique:jest.fn(async()=>({display_name:'Sender'}))},
  };
  const db={asUser:jest.fn(async(_u,fn)=>fn(tx))} as unknown as DbService;
  const mailer={send:jest.fn(async()=>{})};
  return {tx,mailer,controller:new MembersController(db,mailer as unknown as InvitationMailer),stored:()=>stored, clear:()=>{stored=null;}};
}
describe('members and invitations API',()=>{
  const original={...process.env};
  beforeEach(()=>{process.env.APP_URL='http://localhost:3100';process.env.INVITATION_TOKEN_SECRET='local-test-secret-with-at-least-32-characters';});
  afterEach(()=>{process.env={...original};});
  it('derives states from existing acceptance/expiry columns',()=>{
    expect(invitationStatus({accepted_at:null,expires_at:new Date(0)})).toBe('expired');
    expect(invitationStatus({accepted_at:new Date(),expires_at:new Date(0)})).toBe('accepted');
  });
  it('creates a 7-day invitation, stores only its hash and sends the required message',async()=>{
    const s=setup();const result=await s.controller.invite(user,org,body);
    const row=s.stored();expect(row.email).toBe('invited@example.com');expect(row.expires_at-row.created_at).toBe(7*86400000);expect(result).not.toHaveProperty('token_hash');
    const message=s.mailer.send.mock.calls[0] as unknown as [any];expect(message[0].url).toMatch(/\/ar\/invitations\/accept#[\w-]{43}$/);expect(row.token_hash).not.toContain(new URL(message[0].url).hash.slice(1));expect(message[0].inviter).toBe('Sender');
  });
  it('SMTP failure is not success; retry reuses the same row, link and expiry',async()=>{
    const s=setup();s.mailer.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(s.controller.invite(user,org,body)).rejects.toThrow('SMTP unavailable');const expiry=s.stored().expires_at;
    const result=await s.controller.invite(user,org,body);expect(result.email_accepted).toBe(true);expect(s.tx.organization_invitations.create).toHaveBeenCalledTimes(1);expect(s.stored().expires_at).toBe(expiry);
    expect(s.mailer.send.mock.calls[0]).toEqual(s.mailer.send.mock.calls[1]);
  });
  it('recreating a cancelled ID never revives the old link',async()=>{
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-11-07T10:00:00Z'));
      const s=setup();await s.controller.invite(user,org,body);s.clear();
      jest.setSystemTime(new Date('2026-11-07T10:00:01Z'));
      await s.controller.invite(user,org,body);
      expect(s.mailer.send.mock.calls[0]).not.toEqual(s.mailer.send.mock.calls[1]);
    } finally {jest.useRealTimers();}
  });
  it('rejects changed retry payload without sending another message',async()=>{
    const s=setup();await s.controller.invite(user,org,body);
    await expect(s.controller.invite(user,org,{...body,email:'another@example.com'})).rejects.toThrow('retry');expect(s.mailer.send).toHaveBeenCalledTimes(1);
  });
  it('refuses operations for nonmembers before reading/writing invitations',async()=>{
    const s=setup();s.tx.organization_members.findFirst.mockResolvedValue(null as never);
    await expect(s.controller.invite(user,org,body)).rejects.toBeInstanceOf(ForbiddenException);expect(s.mailer.send).not.toHaveBeenCalled();expect(s.tx.organization_invitations.create).not.toHaveBeenCalled();
  });
  it('does not accept without confirmed email or attempt SQL',async()=>{
    const s=setup();await expect(s.controller.accept({...user,emailConfirmed:false},{token:'x'.repeat(43)})).rejects.toBeInstanceOf(ForbiddenException);expect(s.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not report success when RLS affects no membership rows',async()=>{
    const s=setup();s.tx.organization_members.updateMany.mockResolvedValue({count:0});s.tx.organization_members.deleteMany.mockResolvedValue({count:0});
    await expect(s.controller.role(user,org,id,{role:'admin'})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.controller.remove(user,org,id)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('never targets a membership outside the requested organization',async()=>{
    const s=setup();s.tx.organization_members.findFirst.mockImplementation(async(args:any)=>args.where.id?null as never:{id:'actor',role:'owner'});
    await expect(s.controller.remove(user,org,id)).rejects.toThrow();expect(s.tx.organization_members.deleteMany).not.toHaveBeenCalled();
  });
});
