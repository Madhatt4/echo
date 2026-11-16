import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Echo phone app's native shell. `appId` is permanent once uploaded to
 * Apple, and matches the desktop app's id (Marc, 2026-11-15). It sits under
 * PropXchain Ltd's Apple developer team.
 */
const config: CapacitorConfig = {
  appId: 'io.github.madhatt4.echo',
  appName: 'Echo',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
