export class AgentUI {
  public constructor(private readonly write: (text: string) => void = (text: string): void => { console.log(text); }) {}

  public render(response: string): void {
    this.write(response);
  }
}
