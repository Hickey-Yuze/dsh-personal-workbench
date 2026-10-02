/**
 * 浏览器侧的 RPC 封装：POST /api/personal-workbench/<endpoint>。
 * 端点与载荷类型全部来自 src/contract.ts（构建期擦除的类型，不产生运行时依赖）。
 */
import type {
  PersonalWorkbenchEndpoint,
  PersonalWorkbenchRequestMap,
  PersonalWorkbenchResponseMap,
  RpcEnvelope,
} from '../../src/contract.js';

export const API_PREFIX = '/api/personal-workbench';

export type RpcFn = <E extends PersonalWorkbenchEndpoint>(
  endpoint: E,
  payload: PersonalWorkbenchRequestMap[E],
) => Promise<RpcEnvelope<PersonalWorkbenchResponseMap[E]>>;

export function makeRpc(): RpcFn {
  return async function rpc(endpoint, payload) {
    const res = await fetch(`${API_PREFIX}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      return { ok: false, error: { code: `http-${res.status}`, message: `宿主返回 HTTP ${res.status}` } };
    }
    return (await res.json()) as RpcEnvelope<unknown>;
  } as RpcFn;
}
