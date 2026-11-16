import type { EchoApi } from '../shared/api.ts';

declare global {
  interface Window {
    echo: EchoApi;
  }
}
