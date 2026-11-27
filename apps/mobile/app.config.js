module.exports = ({ config }) => {
  const iosId = process.env.OPEN_CARTABLE_IOS_BUNDLE_ID;
  const androidId = process.env.OPEN_CARTABLE_ANDROID_PACKAGE;
  const googleServicesFile = process.env.OPEN_CARTABLE_GOOGLE_SERVICES_FILE;
  const apnsMode = process.env.OPEN_CARTABLE_APNS_MODE ?? 'development';
  if (!['development', 'production'].includes(apnsMode)) throw new Error('Mode APNs attendu : development ou production.');
  return {
    ...config,
    ios: { ...config.ios, ...(iosId ? { bundleIdentifier: iosId } : {}) },
    android: { ...config.android, ...(androidId ? { package: androidId } : {}), ...(googleServicesFile ? { googleServicesFile } : {}) },
    plugins: [...config.plugins, ['expo-notifications', { defaultChannel: 'school-updates', mode: apnsMode }]],
  };
};
