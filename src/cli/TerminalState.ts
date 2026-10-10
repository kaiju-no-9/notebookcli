export class TerminalState {
  private spinnerMessage: string | undefined;

  public startSpinner(message: string): void {
    this.spinnerMessage = message;
  }

  public updateSpinner(message: string): void {
    if (this.spinnerMessage !== undefined) {
      this.spinnerMessage = message;
    }
  }

  public stopSpinner(): void {
    this.spinnerMessage = undefined;
  }

  public get currentSpinnerMessage(): string | undefined {
    return this.spinnerMessage;
  }
}
