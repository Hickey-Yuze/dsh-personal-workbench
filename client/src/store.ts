/**
 * 客户端存储 hook：经 Host RPC 读写插件自有 JSON（<dataDir>/<key>.json）。
 * 乐观更新 + 400ms 防抖落盘；挂载时拉一次快照；写入失败不打断交互，只置 error。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RpcFn } from './rpc.js';

export interface KvState<T> {
  value: T;
  save: (next: T | ((prev: T) => T)) => void;
  loading: boolean;
  error?: string;
}

export function useKv<T>(rpc: RpcFn, key: string, fallback: T): KvState<T> {
  const [value, setValue] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await rpc('personal-workbench/store/read', { key });
        if (!alive.current) return;
        const raw = res.ok ? res.value?.value : null;
        setValue(raw === null || raw === undefined ? fallback : (raw as T));
        setError(res.ok ? undefined : res.error?.message);
      } catch (err) {
        if (alive.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // fallback 故意不进依赖：它只是「远端无值时的兜底」，变化不该触发重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, key]);

  const save = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          void rpc('personal-workbench/store/write', { key, value: v })
            .then((res) => setError(res.ok ? undefined : res.error?.message))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }, 400);
        return v;
      });
    },
    [rpc, key],
  );

  return { value, save, loading, error };
}

/** 知识库调用：列表 / 读笔记 / 搜索（薄封装，错误统一转字符串）。 */
export function useKnowledge(rpc: RpcFn) {
  const list = useCallback(
    async (dir: string) => {
      const res = await rpc('personal-workbench/kb/list', { path: dir });
      if (!res.ok) throw new Error(res.error?.message ?? '读取目录失败');
      return res.value ?? { entries: [], total: 0, dir };
    },
    [rpc],
  );
  const read = useCallback(
    async (path: string) => {
      const res = await rpc('personal-workbench/kb/read', { path });
      if (!res.ok) throw new Error(res.error?.message ?? '读取笔记失败');
      return res.value ?? { path, content: '', bytes: 0 };
    },
    [rpc],
  );
  const search = useCallback(
    async (query: string) => {
      const res = await rpc('personal-workbench/kb/search', { query });
      if (!res.ok) throw new Error(res.error?.message ?? '搜索失败');
      return res.value ?? { hits: [], total: 0 };
    },
    [rpc],
  );
  return { list, read, search };
}
