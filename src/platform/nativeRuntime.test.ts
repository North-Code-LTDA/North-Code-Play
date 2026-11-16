import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  detectNativeRuntimeInfo,
  syncNativeRuntimeAttributes,
  isNativeAndroidRuntime,
} from './nativeRuntime';

test('detectNativeRuntimeInfo identifies browser web by default', () => {
  const info = detectNativeRuntimeInfo({
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  });
  assert.equal(info.isNativeAndroid, false);
  assert.equal(info.runtime, 'web');
  assert.equal(info.isNativePlatform, false);
});

test('detectNativeRuntimeInfo identifies native Android Capacitor runtime', () => {
  const info = detectNativeRuntimeInfo({
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  });
  assert.equal(info.isNativeAndroid, true);
  assert.equal(info.runtime, 'android');
  assert.equal(info.isNativePlatform, true);
});

test('detectNativeRuntimeInfo does not treat non-android native or web tv display mode as android APK', () => {
  const iosInfo = detectNativeRuntimeInfo({
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  });
  assert.equal(iosInfo.isNativeAndroid, false);

  const win = new Window({ url: 'http://localhost:3000' });
  const doc = win.document as unknown as Document;
  doc.documentElement.setAttribute('data-display-mode', 'tv');

  const syncedWeb = syncNativeRuntimeAttributes(doc, {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  });
  assert.equal(syncedWeb.isNativeAndroid, false);
  assert.equal(doc.documentElement.getAttribute('data-native-runtime'), 'web');
  assert.equal(doc.documentElement.getAttribute('data-android-apk'), null);
  assert.equal(doc.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.equal(isNativeAndroidRuntime(doc), false);

  const syncedAndroid = syncNativeRuntimeAttributes(doc, {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  });
  assert.equal(syncedAndroid.isNativeAndroid, true);
  assert.equal(doc.documentElement.getAttribute('data-native-runtime'), 'capacitor-android');
  assert.equal(doc.documentElement.getAttribute('data-android-apk'), 'true');
  assert.equal(doc.documentElement.getAttribute('data-display-mode'), 'tv');
  assert.equal(isNativeAndroidRuntime(doc), true);
});
