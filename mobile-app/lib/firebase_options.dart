import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// **Real values — generated 2026-08-29 by `flutterfire configure`
/// against a real Firebase project** (`afrishield-ai-flood`), not
/// placeholders. Regenerate with:
/// ```
/// cd mobile-app
/// flutterfire configure --project=afrishield-ai-flood --platforms=android,ios,web \
///   --android-package-name=com.afrishield.afrishield_mobile \
///   --ios-bundle-id=com.afrishield.afrishieldMobile --yes --overwrite-firebase-options
/// ```
/// if the project ever changes. These `apiKey` values are not secrets —
/// Firebase's own security model relies on Security Rules/App Check, not
/// on hiding client config — but they're still tied to a real project,
/// so don't casually swap them for a different one without updating
/// `backend/.env`'s `FIREBASE_SERVICE_ACCOUNT_JSON` too (a *separate*
/// credential for the backend side, generated from the Firebase console's
/// Project Settings > Service Accounts tab — this file alone is not
/// enough for the backend to send pushes, only for the app to receive
/// them).
///
/// Web push (`FirebaseMessaging.getToken()` in the browser) additionally
/// needs a VAPID key from Project Settings > Cloud Messaging > Web
/// configuration > Web Push certificates — see `PushService`'s doc
/// comment for whether that's been wired in yet.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return web;
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBSgkShcABcc4AKM6-4uZO_WF6sMLRthM0',
    appId: '1:181757369168:web:6be06dd37663bfbd352a55',
    messagingSenderId: '181757369168',
    projectId: 'afrishield-ai-flood',
    authDomain: 'afrishield-ai-flood.firebaseapp.com',
    storageBucket: 'afrishield-ai-flood.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyA3S5b-5RWdjpYFlEhLg1fraeUfElsEmWg',
    appId: '1:181757369168:android:5b83b175c2eaa74c352a55',
    messagingSenderId: '181757369168',
    projectId: 'afrishield-ai-flood',
    storageBucket: 'afrishield-ai-flood.firebasestorage.app',
  );
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBwdqC5GeO3tJKwY6CwOGe6nclJvSTtDag',
    appId: '1:181757369168:ios:4e3b731787e50e7e352a55',
    messagingSenderId: '181757369168',
    projectId: 'afrishield-ai-flood',
    storageBucket: 'afrishield-ai-flood.firebasestorage.app',
    iosBundleId: 'com.afrishield.afrishieldMobile',
  );
}
