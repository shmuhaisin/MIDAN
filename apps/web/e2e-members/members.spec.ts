import { test, expect } from '@playwright/test';
const org='11111111-1111-4111-8111-111111111111';
async function login(context: import('@playwright/test').BrowserContext, role='owner') {
  const payload=Buffer.from(JSON.stringify({sub:role,email:`${role}@example.com`,exp:Math.floor(Date.now()/1000)+3600,user_metadata:{account_type:'organization'}})).toString('base64url');
  await context.addCookies([{name:'midan_at',value:`local.${payload}.${role}`,url:'http://127.0.0.1:3300',httpOnly:true,sameSite:'Lax'}]);
}
test.beforeEach(async({request})=>{await request.get('http://127.0.0.1:54398/reset');});
test('SMTP error is visible, retry uses same row, cancellation removes it',async({page,context,request})=>{
  await login(context);await page.goto(`/en/organization/${org}/members`);
  await expect(page.getByRole('heading',{name:'Organization members',exact:true})).toBeVisible();
  await expect(page.getByText('This is the last owner. Their membership must remain.')).toBeVisible();
  await page.getByLabel('Email',{exact:true}).fill('invited@example.com');
  await page.getByRole('button',{name:'Create invitation and send email'}).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invitation email failed' })).toContainText('Invitation email failed');
  await expect(page.getByText('Awaiting acceptance')).toBeVisible();
  await page.getByRole('button',{name:'Send invitation email again'}).click();
  await expect(page.getByText('Action completed.')).toBeVisible();
  const calls=await (await request.get('http://127.0.0.1:54398/calls')).json();expect(calls).toHaveLength(2);expect(calls[0].request_id).toBe(calls[1].request_id);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel invitation',exact:true}).click();await expect(page.getByText('No invitations yet.')).toBeVisible();
});
test('reviewer sees members but no management actions or invitations',async({page,context})=>{
  await login(context,'reviewer');await page.goto(`/en/organization/${org}/members`);
  await expect(page.getByText('Local Owner',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Remove member'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Invite a member'})).toHaveCount(0);
});
test('accept reads fragment, removes it from URL and posts explicit consent',async({page,context,request})=>{
  await login(context);const token='a'.repeat(43);await page.goto(`/en/invitations/accept#${token}`);
  await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toBeVisible();await expect(page).toHaveURL(/\/en\/invitations\/accept$/);
  await page.getByRole('button',{name:'Accept Invitation',exact:true}).click();await expect(page).toHaveURL(new RegExp(`/organization/${org}/members$`));
  const calls=await (await request.get('http://127.0.0.1:54398/calls')).json();expect(calls).toContainEqual({token});
});
test('Arabic members screen has matching text and RTL',async({page,context})=>{
  await login(context);await page.goto(`/ar/organization/${org}/members`);
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');await expect(page.getByRole('heading',{name:'الأعضاء والدعوات'})).toBeVisible();await expect(page.getByText('لا توجد دعوات بعد.')).toBeVisible();
});

test('signed-out user keeps the invitation across local sign-in',async({page})=>{
  await page.goto(`/en/invitations/accept#${'b'.repeat(43)}`);
  await page.getByRole('link',{name:'Sign in to accept'}).click();
  await page.getByRole('textbox',{name:'Email',exact:true}).fill('owner@example.com');
  await page.getByLabel('Password',{exact:true}).fill('local-test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/en\/invitations\/accept$/);
  await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toBeVisible();
});

test('role changes retain success feedback and members can be removed',async({page,context})=>{
  await login(context);await page.goto(`/en/organization/${org}/members`);
  const member=page.getByRole('listitem').filter({hasText:'Local Reviewer'});
  await member.getByRole('combobox').selectOption('admin');
  await member.getByRole('button',{name:'Save role',exact:true}).click();
  await expect(member.getByRole('combobox')).toHaveValue('admin');
  await expect(member.getByRole('status')).toHaveText('Membership updated.');
  page.once('dialog',d=>d.accept());await member.getByRole('button',{name:'Remove member',exact:true}).click();
  await expect(page.getByText('Local Reviewer',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Local Owner',{exact:true})).toBeVisible();
});
test('invalid new link never reuses a previously saved invitation',async({page,context,request})=>{
  await login(context);await page.goto(`/en/invitations/accept#${'c'.repeat(43)}`);
  await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toBeVisible();
  await page.goto('/en/invitations/accept#invalid');
  await expect(page.getByText('This invitation or its context is invalid or expired. Open the original invitation link, or request a new invitation if it has expired.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toHaveCount(0);
  const calls=await(await request.get('http://127.0.0.1:54398/calls')).json();expect(calls).toHaveLength(0);
});

test('following a second valid invitation in the same tab accepts only its token',async({page,context,request})=>{
  await login(context);await page.goto(`/en/invitations/accept#${'d'.repeat(43)}`);
  await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toBeVisible();
  await page.goto(`/en/invitations/accept#${'e'.repeat(43)}`);
  await expect(page).toHaveURL(/\/en\/invitations\/accept$/);
  await page.getByRole('button',{name:'Accept Invitation',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/organization/${org}/members$`));
  const calls=await(await request.get('http://127.0.0.1:54398/calls')).json();expect(calls).toEqual([{token:'e'.repeat(43)}]);
});

const contextError='This invitation or its context is invalid or expired. Open the original invitation link, or request a new invitation if it has expired.';
function confirmationToken(){return `local.${Buffer.from(JSON.stringify({sub:'local-invitee',email:'invited@example.com',exp:Math.floor(Date.now()/1000)+3600,user_metadata:{account_type:'organization',invitation_signup:true}})).toString('base64url')}.invited`;}
test('new invitee registers without an organization and confirms in a new tab',async({page,context,request})=>{
  const token='f'.repeat(43);await page.goto(`/en/invitations/accept#${token}`);
  await page.getByRole('link',{name:'Create an account to accept'}).click();
  await expect(page.getByRole('heading',{name:'Create your account to join'})).toBeVisible();
  await expect(page.locator('input[name="org_name_ar"]')).toHaveCount(0);await expect(page.locator('input[name="org_name_en"]')).toHaveCount(0);
  await page.locator('input[name="display_name"]').fill('Local Invitee');
  await page.locator('form').filter({has:page.locator('input[name="display_name"]')}).evaluate(form=>{for(const name of ['org_name_ar','org_name_en']){const input=document.createElement('input');input.type='hidden';input.name=name;input.value='Must not create an organization';form.appendChild(input);}});await page.locator('input[name="email"]').fill('invited@example.com');await page.locator('input[name="password"]').fill('local-test-password');
  await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page).toHaveURL(/check-email/);
  const signup=await(await request.get('http://127.0.0.1:54398/signup-calls')).json();expect(signup).toHaveLength(1);expect(signup[0].data).toMatchObject({account_type:'organization',invitation_signup:true});expect(signup[0].data).not.toHaveProperty('org_name_ar');expect(signup[0].data).not.toHaveProperty('org_name_en');expect(JSON.stringify(signup)).not.toContain(token);
  const confirmation=await context.newPage();await confirmation.goto(`/en/auth/confirmed#access_token=${confirmationToken()}&refresh_token=local-refresh`);
  await expect(confirmation).toHaveURL(/\/en\/invitations\/accept$/);await confirmation.getByRole('button',{name:'Accept Invitation',exact:true}).click();await expect(confirmation).toHaveURL(new RegExp(`/organization/${org}/members$`));
  expect((await context.cookies()).some(c=>c.name==='midan_invitation')).toBe(false);
  expect(await confirmation.evaluate(()=>sessionStorage.getItem('midan_pending_invitation'))).toBe(null);
});
test('failed confirmation keeps context but does not create an authenticated session',async({page,context})=>{
  await page.goto(`/en/invitations/accept#${'g'.repeat(43)}`);await expect(page.getByRole('link',{name:'Create an account to accept'})).toBeVisible();
  const confirmation=await context.newPage();await confirmation.goto('/en/auth/confirmed#error=access_denied&error_code=otp_expired');
  await expect(confirmation.locator('#main').getByRole('link',{name:'Sign in',exact:true})).toHaveAttribute('href',/returnTo=invitation/);
  await expect(confirmation).toHaveURL(/\/en\/auth\/confirmed$/);expect((await context.cookies()).some(c=>c.name==='midan_at')).toBe(false);expect((await context.cookies()).some(c=>c.name==='midan_invitation')).toBe(true);
});
test('expired or invalid invitation cannot start registration',async({page,context})=>{
  await page.goto(`/en/invitations/accept#${'x'.repeat(43)}`);await expect(page.getByText(contextError)).toBeVisible();
  await page.goto('/en/register?as=organization&returnTo=invitation');await expect(page.locator('input[name="org_name_ar"]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Create account',exact:true})).toHaveCount(0);expect((await context.cookies()).some(c=>c.name==='midan_invitation')).toBe(false);
});
test('expired confirmation context is cleaned and never falls into independent organization signup',async({page,context})=>{
  await context.addCookies([{name:'midan_invitation',value:JSON.stringify({token:'h'.repeat(43),expiresAt:Date.now()-1000}),url:'http://127.0.0.1:3300',httpOnly:true}]);
  await page.goto(`/en/auth/confirmed#access_token=${confirmationToken()}&refresh_token=local-refresh`);await expect(page.getByText(contextError)).toBeVisible();expect((await context.cookies()).some(c=>c.name==='midan_invitation')).toBe(false);await expect(page.getByRole('button',{name:'Accept Invitation',exact:true})).toHaveCount(0);
});

test('context lost while filling registration cannot fall back to a new organization account',async({page,context,request})=>{
  await page.goto(`/en/invitations/accept#${'j'.repeat(43)}`);await page.getByRole('link',{name:'Create an account to accept'}).click();
  await page.locator('input[name="display_name"]').fill('Local Invitee');await page.locator('input[name="email"]').fill('invited@example.com');await page.locator('input[name="password"]').fill('local-test-password');
  await context.clearCookies({name:'midan_invitation'});
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByText('The invitation link is missing. Open the original link from your email.')).toBeVisible();
  const signup=await(await request.get('http://127.0.0.1:54398/signup-calls')).json();expect(signup).toHaveLength(0);await expect(page.locator('input[name="org_name_ar"]')).toHaveCount(0);
});

test('an old tab expiry timer cannot erase a newer invitation context',async({page,context})=>{
  await context.addCookies([{name:'midan_invitation',value:JSON.stringify({token:'m'.repeat(43),expiresAt:Date.now()+4000}),url:'http://127.0.0.1:3300',httpOnly:true}]);
  await page.goto('/en/invitations/accept');await expect(page.getByRole('link',{name:'Create an account to accept'})).toBeVisible();
  const other=await context.newPage();await other.goto(`/en/invitations/accept#${'n'.repeat(43)}`);await expect(other.getByRole('link',{name:'Create an account to accept'})).toBeVisible();
  const timerResponse=page.waitForResponse(r=>r.request().method()==='POST'&&Boolean(r.request().headers()['next-action']));
  await expect(page.getByText(contextError)).toBeVisible();await timerResponse;
  const saved=(await context.cookies()).find(c=>c.name==='midan_invitation');expect(saved).toBeDefined();expect(JSON.parse(decodeURIComponent(saved!.value)).token).toBe('n'.repeat(43));
});
