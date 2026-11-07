import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { MembersController } from './members.controller';
import { InvitationMailer } from './invitation-mailer';
import { AuthGuard } from '../auth/auth.guard';
import { DbService } from '../db/db.service';
import { configureApp } from '../common/configure-app';

const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
describe('members HTTP validation and authorization',()=>{
  let app:INestApplication;let currentRole='reviewer';
  const tx={organization_members:{findFirst:jest.fn(async({where})=>where.org_id===org&&(!where.role||where.role.in.includes(currentRole))?{id:'local-member'}:null)}};
  beforeAll(async()=>{
    const module=await Test.createTestingModule({controllers:[MembersController],providers:[
      {provide:DbService,useValue:{asUser:async(_user:unknown,fn:(tx:unknown)=>unknown)=>fn(tx)}},
      {provide:InvitationMailer,useValue:{send:jest.fn()}},
    ]}).overrideGuard(AuthGuard).useValue({canActivate:(ctx:ExecutionContext)=>{ctx.switchToHttp().getRequest().user={id:'local-user',email:'local@example.com',emailConfirmed:false};return true;}}).compile();
    app=module.createNestApplication();configureApp(app);await app.init();
  });
  afterAll(()=>app.close());
  it('rejects owner invitations and unsupported roles before the handler',async()=>{
    for(const role of ['owner','superadmin'])await request(app.getHttpServer()).post(`/organizations/${org}/invitations`).send({request_id:other,email:'test@example.com',role}).expect(400);
  });
  it('rejects unknown fields and malformed identifiers',async()=>{
    await request(app.getHttpServer()).patch(`/organizations/${org}/members/${other}`).send({role:'admin',org_id:other}).expect(400);
    await request(app.getHttpServer()).get('/organizations/not-a-uuid/members').expect(400);
  });
  it('does not allow reviewers to list invitations',async()=>{
    currentRole='reviewer';await request(app.getHttpServer()).get(`/organizations/${org}/invitations`).expect(403);
  });
  it('does not allow members of one organization to list another',async()=>{
    await request(app.getHttpServer()).get(`/organizations/${other}/members`).expect(403);
  });
  it('rejects unconfirmed users before invoking acceptance SQL',async()=>{
    await request(app.getHttpServer()).post('/invitations/accept').send({token:'a'.repeat(43)}).expect(403);
  });
});
