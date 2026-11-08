export type Notify = (message: string) => Promise<void>;

// Avisos al chat de Telegram del usuario, con el mismo bot que usa Hermes.
// Enviar con sendMessage no interfiere con el long polling de Hermes.
// Un aviso que falla se registra y nunca interrumpe el pipeline.
export class TelegramNotifier {
  constructor(
    private token: string,
    private chatId: string,
    private fetchFn: typeof fetch = fetch,
    private log: (msg: string) => void = console.error,
  ) {}

  async send(text: string): Promise<void> {
    try {
      const r = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
      });
      if (!r.ok) this.log(`Aviso de Telegram rechazado (HTTP ${r.status})`);
    } catch (e) {
      this.log(`No se pudo enviar el aviso de Telegram: ${(e as Error).message}`);
    }
  }
}

export function notifierFromEnv(env: Record<string, string | undefined> = process.env): TelegramNotifier | undefined {
  const token = env.FACTORY_TELEGRAM_BOT_TOKEN;
  const chat = env.FACTORY_TELEGRAM_CHAT_ID;
  return token && chat ? new TelegramNotifier(token, chat) : undefined;
}
