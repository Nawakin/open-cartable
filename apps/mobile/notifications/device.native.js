import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const transport = { ios: 'apns', android: 'fcm' }[Platform.OS];
export const pushPath = transport && !isRunningInExpoGo() ? '/notifications/' + transport : null;

export async function requestDeviceToken() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('school-updates', {
      name: 'Nouvelles de l’école', importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } });
  }
  return permission.granted ? currentDeviceToken() : null;
}

export async function currentDeviceToken() {
  return tokenValue(await Notifications.getDevicePushTokenAsync());
}

export function tokenValue(token) {
  if (token.type !== Platform.OS || typeof token.data !== 'string' || !token.data) {
    throw new Error('Jeton de notification indisponible.');
  }
  return token.data;
}
