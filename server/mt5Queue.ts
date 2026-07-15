import { EventEmitter } from 'events';

export interface MT5Command {
  id: string;
  login: string;
  action: 'BUY' | 'SELL' | 'CLOSE' | 'MODIFY';
  symbol: string;
  volume?: number;
  ticket?: string; // for close/modify
  sl?: number;
  tp?: number;
  price?: number;
  timestamp: string;
}

export interface MT5CommandResult {
  commandId: string;
  status: 'success' | 'failed';
  ticket?: string;
  error?: string;
}

export interface MT5Position {
  ticket: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  sl?: number;
  tp?: number;
  pnl: number;
}

export interface MT5AccountState {
  login: string;
  balance: number;
  equity: number;
  currency: string;
  positions: MT5Position[];
  lastUpdated: string;
}

class MT5QueueManager extends EventEmitter {
  private commands: Map<string, MT5Command[]> = new Map(); // login -> commands
  private results: Map<string, MT5CommandResult> = new Map(); // commandId -> result
  private states: Map<string, MT5AccountState> = new Map(); // login -> state

  public pushCommand(
    login: string,
    action: 'BUY' | 'SELL' | 'CLOSE' | 'MODIFY',
    symbol: string,
    params: { volume?: number; ticket?: string; sl?: number; tp?: number; price?: number } = {}
  ): string {
    const commandId = 'cmd_' + Math.random().toString(36).substr(2, 9);
    const cmd: MT5Command = {
      id: commandId,
      login,
      action,
      symbol,
      volume: params.volume,
      ticket: params.ticket,
      sl: params.sl,
      tp: params.tp,
      price: params.price,
      timestamp: new Date().toISOString(),
    };

    if (!this.commands.has(login)) {
      this.commands.set(login, []);
    }
    this.commands.get(login)!.push(cmd);
    
    console.log(`[MT5Queue] Pushed command ${commandId} (${action}) for account ${login}. Pending count: ${this.commands.get(login)!.length}`);
    return commandId;
  }

  public getPendingCommands(login: string): MT5Command[] {
    return this.commands.get(login) || [];
  }

  public clearCommands(login: string, ids: string[]): void {
    const current = this.commands.get(login) || [];
    const updated = current.filter(cmd => !ids.includes(cmd.id));
    this.commands.set(login, updated);
  }

  public saveResult(result: MT5CommandResult): void {
    this.results.set(result.commandId, result);
    this.emit(`result_${result.commandId}`, result);
    console.log(`[MT5Queue] Saved result for command ${result.commandId}: ${result.status} (Error: ${result.error || 'none'})`);
  }

  public updateState(state: MT5AccountState): void {
    this.states.set(state.login, {
      ...state,
      lastUpdated: new Date().toISOString(),
    });
    // Optional: Log state periodically, not on every poll to avoid log clutter
  }

  public getState(login: string): MT5AccountState | null {
    return this.states.get(login) || null;
  }

  public async waitForResult(commandId: string, timeoutMs = 5000): Promise<MT5CommandResult> {
    if (this.results.has(commandId)) {
      return this.results.get(commandId)!;
    }

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      
      const onResult = (result: MT5CommandResult) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      this.once(`result_${commandId}`, onResult);

      timer = setTimeout(() => {
        this.off(`result_${commandId}`, onResult);
        resolve({
          commandId,
          status: 'failed',
          error: `Execution timeout: MT5 terminal failed to respond within ${timeoutMs / 1000}s.`,
        });
      }, timeoutMs);
    });
  }
}

export const mt5Queue = new MT5QueueManager();
