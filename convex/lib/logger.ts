type LogValue = string | number | boolean | null | undefined;

export class Logger {
  private fields: Record<string, LogValue> = {};

  set(key: string, value: LogValue): this {
    this.fields[key] = value;
    return this;
  }

  info(): void {
    console.log(JSON.stringify(this.fields));
  }

  warn(): void {
    console.warn(JSON.stringify(this.fields));
  }

  error(): void {
    console.error(JSON.stringify(this.fields));
  }
}

export function createLogger(event: string): Logger {
  return new Logger().set("event", event);
}
