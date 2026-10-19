// 서버가 있으면 서버 모드, 없으면(GitHub Pages 등) 데모 모드로 동작한다.
// config.js 의 mode: 'auto' | 'server' | 'demo'
import { createRemoteApi, probe } from './remote.js';

let impl = null;

export async function initApi() {
  const mode = globalThis.RSD_CONFIG?.mode ?? 'auto';
  if (mode === 'server' || (mode === 'auto' && (await probe()))) impl = createRemoteApi();
  else {
    const { createLocalApi } = await import('./local.js');
    impl = await createLocalApi();
  }
  return impl.mode;
}

export const apiMode = () => impl?.mode;
export const call = (name, args) => impl.call(name, args);
export const login = (id, pw) => impl.login(id, pw);
export const logout = () => impl.logout();
export const currentUser = () => impl.current();
export const resetDemo = () => impl.reset?.();
