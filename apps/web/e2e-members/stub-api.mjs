// Completely local UI contract fixture. No .env, database, real credentials or external requests.
import { createServer } from 'node:http';
const org='11111111-1111-4111-8111-111111111111';
const initialMembers=()=>[{id:'owner',user_id:'owner',display_name:'Local Owner',email:'owner@example.com',role:'owner'},{id:'reviewer',user_id:'reviewer',display_name:'Local Reviewer',email:'reviewer@example.com',role:'reviewer'}];
let members=initialMembers(), rows=[], calls=[], failures=0;
const signupCalls=[];
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/health')return send(200,{ok:true});
  if(url.pathname==='/reset'){members=initialMembers();rows=[];calls=[];signupCalls.length=0;failures=1;return send(200,{});}
  if(url.pathname==='/calls')return send(200,calls);
  if(url.pathname==='/signup-calls')return send(200,signupCalls);
  if(url.pathname==='/auth/v1/signup'){signupCalls.push({email:body.email,data:body.data});return send(200,{id:'local-invitee',email:body.email});}
  if(url.pathname==='/auth/v1/user'){return send(200,{id:'local-invitee',email:'invited@example.com',email_confirmed_at:new Date().toISOString()});}
  if(url.pathname==='/v1/invitations/context'){if(!/^[\w-]{43}$/.test(body.token)||body.token==='x'.repeat(43)||(body.email&&body.email!=='invited@example.com'))return send(403,{});return send(201,{expires_at:new Date(Date.now()+7*86400000).toISOString()});}
  if(url.pathname==='/auth/v1/token'){const payload=Buffer.from(JSON.stringify({sub:'owner',email:'owner@example.com',exp:Math.floor(Date.now()/1000)+3600,user_metadata:{account_type:'organization'}})).toString('base64url');return send(200,{access_token:`local.${payload}.owner`,refresh_token:'local-refresh'});}
  const role=req.headers.authorization?.includes('reviewer')?'reviewer':'owner';
  if(url.pathname===`/v1/organizations/${org}`)return send(200,{id:org,name_ar:'منشأة اختبار محلية',name_en:'Local test organization',my_role:role});
  if(url.pathname===`/v1/organizations/${org}/members`)return send(200,members);
  if(url.pathname.startsWith(`/v1/organizations/${org}/members/`)){
    const id=url.pathname.split('/').at(-1);
    if(req.method==='PATCH')members=members.map(m=>m.id===id?{...m,role:body.role}:m);
    else if(req.method==='DELETE')members=members.filter(m=>m.id!==id);
    else return send(405,{});
    return send(200,{ok:true});
  }
  if(url.pathname===`/v1/organizations/${org}/invitations`){
    if(role==='reviewer')return send(403,{});
    if(req.method==='POST'){
      calls.push(body);if(!rows.some(r=>r.id===body.request_id))rows.push({id:body.request_id,email:body.email,role:body.role,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString(),status:'pending'});
      if(failures-- >0)return send(503,{});return send(201,{email_accepted:true});
    }return send(200,rows);
  }
  if(url.pathname.startsWith(`/v1/organizations/${org}/invitations/`)&&req.method==='DELETE'){rows=rows.filter(r=>r.id!==url.pathname.split('/').at(-1));return send(200,{ok:true});}
  if(url.pathname==='/v1/invitations/accept'){calls.push(body);return send(201,{org_id:org});}
  return send(404,{});
}).listen(54398,'127.0.0.1');
