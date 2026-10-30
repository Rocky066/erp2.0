# Garumara Teacher Android

Native Android shell for the existing Teacher Portal. It uses the same origin, APIs, JWT permissions, and database as the web and Admin portals; no school business rules are duplicated.

## Environments

- localDebug: http://10.0.2.2:3000 (Android Emulator to host localhost)
- productionRelease: https://school.garumarajv.org

Change the production URL in app/build.gradle before release if the live API host differs. Production must use HTTPS.

## Build

1. Install JDK 17 and Android SDK Platform 35 / Build Tools 35.
2. Open this folder in Android Studio and allow Gradle sync.
3. Run gradlew.bat assembleLocalDebug for the local APK.
4. Configure a private Play signing keystore outside source control.
5. Run gradlew.bat bundleProductionRelease for the Play Store AAB.

Never commit a signing keystore, passwords, Firebase configuration, or live secrets.

## Android features

- Existing Teacher login and permissions through the central JWT API
- Automatic authenticated token rotation
- Live attendance, exam marks, leaves, roster, salary, notices, timetable, homework, profile, and password modules
- Native camera/file chooser and Android Download Manager
- Connectivity-aware portal cache and automatic reload after reconnection
- Background school-notice notifications
- Material 3 day/night host theme and touch/mobile enhancements
- Back navigation, pull-to-refresh, loading and offline states

## Release checklist

- Replace production base URL and require a valid TLS certificate.
- Add the school-owned Play signing key.
- For true real-time remote push, add the school Firebase project google-services.json and server FCM credentials. The included notice worker provides credential-free background notice notifications.
- Test on a physical Android device using real teacher accounts and live staging data.
- Publish a privacy policy covering teacher/student information, camera/file access, notifications, and retention.