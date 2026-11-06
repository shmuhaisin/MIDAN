import { ArgumentsHost, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { UnexpectedErrorFilter } from './unexpected-error.filter';

const TOKEN = 'eyJ-secret-session-token';

function run(error: unknown) {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${String(a.cause)}` : JSON.stringify(a))).join(' ')));
  }
  const body = jest.fn();
  const status = jest.fn(() => ({ json: body }));
  const adapter = { reply: jest.fn(), isHeadersSent: () => false, end: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }), getArgByIndex: () => ({}), getArgs: () => [{}, {}] } as unknown as ArgumentsHost;
  new UnexpectedErrorFilter(adapter as never).catch(error, host);
  return { lines, status, body, adapter };
}

describe('unexpected errors', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the class only, so a raw request in the cause never reaches the logs', () => {
    const error = new TypeError('fetch failed', { cause: { data: `GET /auth/v1/user\r\nauthorization: Bearer ${TOKEN}` } });
    const { lines, status, body } = run(error);
    expect(lines.join('\n')).toContain('TypeError');
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(JSON.stringify(body.mock.calls)).not.toContain(TOKEN);
  });

  it('leaves expected errors to Nest', () => {
    const { adapter, status } = run(new NotFoundException());
    expect(adapter.reply).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
