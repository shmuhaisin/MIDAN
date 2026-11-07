import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { InvitationMailer, invitationContent } from './invitation-mailer';

describe('invitation SMTP delivery', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  it('escapes organization/sender markup and includes role, expiry and Accept Invitation', () => {
    const content = invitationContent({ to: 'test@example.com', organization: '<script>x</script>', inviter: '<b>Sender</b>', role: 'admin', url: 'https://example.com/ar/invitations/accept#token', expires: new Date('2026-11-14T12:00:00Z') });
    expect(content.html).not.toContain('<script>');expect(content.html).toContain('&lt;script&gt;');expect(content.html).toContain('Accept Invitation');expect(content.text).toContain('2026-11-14');expect(content.text).toContain('admin');
  });
  it('reports missing SMTP settings as a failure', async () => {
    delete process.env.SMTP_HOST;delete process.env.SMTP_FROM;
    await expect(new InvitationMailer().send({ to: 'test@example.com', organization: 'Test', role: 'reviewer', url: 'http://localhost/accept', expires: new Date() })).rejects.toThrow('not sent');
  });
  it.each([false, true])('delivers through a loopback SMTP capture (reject=%s)', async reject => {
    let message = ''; const sockets = new Set<Socket>();
    const server = createServer(socket => {
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 local capture\r\n');
      let buffer='';let data=false;
      socket.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
        if(data){if(line==='.') {data=false;socket.write('250 queued\r\n');}else message+=line+'\n';continue;}
        if(/^EHLO/.test(line)) socket.write('250-localhost\r\n250 8BITMIME\r\n');
        else if(/^MAIL FROM/.test(line))socket.write('250 ok\r\n');
        else if(/^RCPT TO/.test(line))socket.write(reject?'550 rejected\r\n':'250 ok\r\n');
        else if(line==='DATA'){data=true;socket.write('354 continue\r\n');}
        else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('250 ok\r\n');
      }});
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    process.env.SMTP_HOST='127.0.0.1';process.env.SMTP_PORT=String((server.address() as AddressInfo).port);process.env.SMTP_FROM='MIDAN <local@example.com>';process.env.SMTP_SECURE='false';delete process.env.SMTP_USER;
    try {
      const result=new InvitationMailer().send({ to:'invited@example.com',organization:'Local organization',inviter:'Local sender',role:'recruiter',url:'http://localhost/ar/invitations/accept#token',expires:new Date('2026-11-14T12:00:00Z') });
      if(reject)await expect(result).rejects.toThrow('not sent');else {await result;expect(message).toContain('invited@example.com');expect(message).toContain('Accept Invitation');expect(message).toContain('recruiter');}
    } finally {for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
