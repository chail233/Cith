/**
 * 轮询 hook：立即执行一次，之后按 intervalMs 周期刷新。
 * - intervalMs <= 0 时只执行一次，不轮询（适合配置页这类手动刷新场景）；
 * - 页面不可见（后台标签页）时暂停轮询，回到前台立即补一次；
 * - fetcher 通过 ref 持有，无需调用方保证引用稳定。
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface PollingResult<T> {
    data: T | null;
    error: string | null;
    /** 首次加载是否尚未完成 */
    loading: boolean;
    /** 手动触发一次刷新 */
    refresh: () => Promise<void>;
}

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 0): PollingResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const mountedRef = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const result = await fetcherRef.current();
            if (!mountedRef.current) return;
            setData(result);
            setError(null);
        } catch (err) {
            if (!mountedRef.current) return;
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void refresh();
        if (intervalMs <= 0) {
            return () => {
                mountedRef.current = false;
            };
        }
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") void refresh();
        }, intervalMs);
        const onVisible = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            mountedRef.current = false;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [refresh, intervalMs]);

    return { data, error, loading, refresh };
}
