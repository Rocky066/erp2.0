const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error('FAIL: ' + message);
  console.log('PASS: ' + message);
};
const server = read('server.js');
const activity = read('teacher-android-app/app/src/main/java/in/garumarajv/teacher/MainActivity.java');
const worker = read('teacher-android-app/app/src/main/java/in/garumarajv/teacher/NoticeWorker.java');
const gradle = read('teacher-android-app/app/build.gradle');
const manifest = read('teacher-android-app/app/src/main/AndroidManifest.xml');
[
  '/api/teacher/login', '/api/teacher/profile', '/api/teacher/students',
  '/api/attendance', '/api/exams', '/api/teachers/leaves',
  '/api/teachers/attendance', '/api/teachers/salaries', '/api/notices',
  '/api/teacher/reset-password', '/api/teacher/refresh'
].forEach(route => assert(server.includes(route), 'shared backend exposes ' + route));
assert(activity.includes('BuildConfig.BASE_URL'), 'Android uses environment-specific central backend');
assert(!fs.existsSync(path.join(root, 'teacher-android-app', 'db.json')), 'Android app contains no duplicate database');
assert(activity.includes('WebChromeClient') && activity.includes('ACTION_IMAGE_CAPTURE'), 'file and camera upload are wired');
assert(activity.includes('DownloadManager'), 'Android download integration is wired');
assert(activity.includes('LOAD_CACHE_ELSE_NETWORK') && activity.includes('registerDefaultNetworkCallback'), 'offline cache and reconnect sync are wired');
assert(activity.includes('/api/teacher/refresh'), 'JWT rotation is wired');
assert(worker.includes('/api/notices') && worker.includes('NotificationCompat'), 'background notice notifications are wired');
assert(gradle.includes('local') && gradle.includes('production'), 'localhost and production environments are configured');
assert(manifest.includes('cleartextTraffic') && manifest.includes('networkSecurityConfig'), 'production network security policy is configured');
assert(activity.includes('min-height:44px') && activity.includes('gjv-native-style'), 'touch-friendly mobile styling is injected only in the app');
console.log('TEACHER ANDROID APP CONTRACT TESTS PASSED');