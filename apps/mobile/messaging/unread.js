import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

const refreshInterval = 30_000;

export function useUnreadMessages(request, enabled) {
  const [count, setCount] = useState(0);
  const refreshNow = useRef(undefined);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return undefined;
    }

    let latest = 0;
    let disposed = false;
    async function refresh() {
      if (disposed || (AppState.currentState && AppState.currentState !== 'active')) return;
      const attempt = ++latest;
      try {
        const result = await request('/unread');
        if (!disposed && attempt === latest) setCount(result.unreadCount);
      } catch (error) {
        if (!disposed && attempt === latest && error.status === 401) setCount(0);
      }
    }

    refreshNow.current = refresh;
    void refresh();
    const timer = setInterval(refresh, refreshInterval);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      disposed = true;
      refreshNow.current = undefined;
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, request]);

  const refresh = useCallback(() => { void refreshNow.current?.(); }, []);
  return { count: enabled ? count : 0, refresh };
}
