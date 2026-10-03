// Runs before every request: the optional PW_BASIC_AUTH password (src/server/basicAuth.js).
import { basicAuth } from './src/server/basicAuth.js';

export function proxy(request) {
  return basicAuth(request) ?? undefined;
}
