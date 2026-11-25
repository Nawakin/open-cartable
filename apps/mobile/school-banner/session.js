import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export function useSchoolBanner(request, enabled) {
  const [banner, setBanner] = useState(null);
  const generation = useRef(0);

  const replace = useCallback((next) => {
    generation.current += 1;
    setBanner(next);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setBanner(null);
      return undefined;
    }

    async function refresh() {
      const current = ++generation.current;
      try {
        const result = await request('/school-banner');
        if (generation.current === current) setBanner(result.banner);
      } catch (error) {
        if (generation.current === current && error.status === 401) setBanner(null);
      }
    }

    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      generation.current += 1;
      subscription.remove();
    };
  }, [request, enabled]);

  return { banner: enabled ? banner : null, replace };
}
