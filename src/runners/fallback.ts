import { QuotaError, type AgentCall, type AgentOutput, type AgentRunner } from './types.ts';

// Si el agente principal se queda sin cuota, usa el de reserva en vez de pausar.
// Se avisa con `onFallback` para que quede registrado (se pierde diversidad de modelos).
export class FallbackRunner implements AgentRunner {
  readonly name: string;

  constructor(
    private primary: AgentRunner,
    private backup: AgentRunner,
    private onFallback: (note: string) => void = () => {},
  ) {
    this.name = `${primary.name}|${backup.name}`;
  }

  async run(call: AgentCall): Promise<AgentOutput> {
    try {
      return await this.primary.run(call);
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e;
      this.onFallback(`${this.primary.name} sin cuota; revisa ${this.backup.name} en su lugar.`);
      return this.backup.run(call);
    }
  }
}
