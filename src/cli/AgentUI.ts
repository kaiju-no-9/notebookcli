export class AgentUI {
  private readonly write: (text: string) => void;
  private readonly writeStream: (text: string) => void;

  public constructor(write?: (text: string) => void, writeStream?: (text: string) => void) {
    this.write = write ?? ((text: string): void => { console.log(text); });
    this.writeStream = writeStream ?? (write === undefined
      ? (text: string): void => { process.stdout.write(text); }
      : write);
  }

  public render(response: string): void {
    this.write(response);
  }

  public renderToken(token: string): void {
    this.writeStream(token);
  }

  public renderStatus(status: string): void {
    this.writeStream(`\n[Oden] ${status}\n`);
  }

  public finishStream(): void {
    this.writeStream("\n");
  }
}
