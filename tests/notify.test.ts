import { describe, it, expect } from 'vitest';
import { TelegramNotifier, notifierFromEnv } from '../src/notify.ts';

describe('TelegramNotifier', () => {
  it('envía el mensaje al chat con sendMessage', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchFn = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    await new TelegramNotifier('TOKEN', '42', fetchFn).send('hola');
    expect(calls[0].url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(calls[0].body).toMatchObject({ chat_id: '42', text: 'hola' });
  });

  it('un fallo de red o de la API no lanza', async () => {
    const logs: string[] = [];
    const boom = (async () => {
      throw new Error('sin red');
    }) as unknown as typeof fetch;
    await new TelegramNotifier('T', '1', boom, (m) => logs.push(m)).send('x');
    const bad = (async () => new Response('{"ok":false}', { status: 401 })) as unknown as typeof fetch;
    await new TelegramNotifier('T', '1', bad, (m) => logs.push(m)).send('x');
    expect(logs).toHaveLength(2);
  });

  it('sin variables de entorno no envía nada', async () => {
    expect(notifierFromEnv({})).toBeUndefined();
    expect(notifierFromEnv({ FACTORY_TELEGRAM_BOT_TOKEN: 't', FACTORY_TELEGRAM_CHAT_ID: '1' })).toBeInstanceOf(TelegramNotifier);
  });
});
