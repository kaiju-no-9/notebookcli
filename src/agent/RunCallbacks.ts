export interface RunCallbacks {
  onStatus?: (status: string) => void;
  onToken?: (token: string) => void;
}
