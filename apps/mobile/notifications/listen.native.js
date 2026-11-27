import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { currentDeviceToken, pushPath, tokenValue } from './device';

export function useNativeNotifications(signedIn, request, onDestination) {
  const open = useRef(onDestination);
  open.current = onDestination;

  useEffect(() => {
    if (!pushPath) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const seen = new Set();
    function route(response) {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const { identifier, content } = response.notification.request;
      if (seen.has(identifier)) return;
      seen.add(identifier);
      Notifications.clearLastNotificationResponse();
      if (typeof content.data?.destination === 'string') open.current(content.data.destination);
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(route);
    route(Notifications.getLastNotificationResponse());
    return () => {
      subscription.remove();
      Notifications.setNotificationHandler(null);
    };
  }, []);

  useEffect(() => {
    if (!signedIn || !pushPath) return;
    let current = true;
    function replace(token) {
      if (current) return request(pushPath + '/token', { method: 'PATCH', body: { token } });
    }
    const subscription = Notifications.addPushTokenListener((token) => {
      Promise.resolve().then(() => replace(tokenValue(token))).catch(() => {});
    });
    async function refresh() {
      const settings = await request(pushPath);
      if (!current || !settings.enabled) return;
      const permission = await Notifications.getPermissionsAsync();
      if (current && !permission.granted) await request(pushPath, { method: 'DELETE' });
      else if (current) await replace(await currentDeviceToken());
    }
    void refresh().catch(() => {});
    return () => { current = false; subscription.remove(); };
  }, [signedIn, request]);
}
