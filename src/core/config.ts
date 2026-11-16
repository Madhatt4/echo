// Where Echo remembers which folder the archive is in. This file holds no
// secrets: it lives in the app's own settings folder, outside the archive.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface EchoConfig {
  archivePath?: string;
}

export function loadConfig(file: string): EchoConfig {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as EchoConfig;
    return typeof parsed.archivePath === 'string' ? { archivePath: parsed.archivePath } : {};
  } catch {
    return {}; // an unreadable settings file is treated as no settings
  }
}

export function saveConfig(file: string, config: EchoConfig): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
