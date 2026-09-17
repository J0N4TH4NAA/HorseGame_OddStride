#Horse Game

This build runs the browser game as a static GitHub Pages site and uses Firebase Realtime Database plus Firebase Anonymous Authentication for multiplayer rooms and public scores. No Render server is required.

## Files

- `public/` contains the game.
- `public/firebase-config.js` contains your Firebase Web App configuration.
- `firebase-client.js` connects the game to Firebase.
- `database.rules.json` contains the Realtime Database rules.
- `.github/workflows/deploy-pages.yml` publishes `public/` to GitHub Pages.

## 1. Create a Firebase project

Open https://console.firebase.google.com/ and click Add project.

You do not need to enable Google Analytics for this game.

Firebase's Spark plan is the no-cost plan and does not require a payment method. Check the current pricing page before launch because quotas and plan details can change.

## 2. Register the web app

In Firebase Console:

Project Overview -> Add app -> Web `</>`.

Use a name such as `OddStride Web`.

Register the app. Firebase will show a `firebaseConfig` object. Copy the values into `public/firebase-config.js`.

Do not paste a Firebase service-account private key into the website. The normal Web App configuration is designed to be used by the browser. Your protection comes from Firebase Authentication and Realtime Database Security Rules.

## 3. Create Realtime Database

Firebase Console -> Build -> Realtime Database -> Create Database.

Choose a location close to your players. Start in Locked mode if the console offers that choice.

Then open the Security Rules tab and replace the rules with the contents of `database.rules.json` from this project. Publish the rules.

## 4. Enable anonymous sign-in

Firebase Console -> Build -> Authentication -> Sign-in method -> Anonymous -> Enable -> Save.

The game uses anonymous authentication so players can join rooms without creating accounts.

## 5. Add your Firebase config

Open `public/firebase-config.js` and replace the empty values with the values from your Firebase Web App settings.

Example shape:

```js
window.ODDSTRIDE_FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: 'https://YOUR_DATABASE_URL',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};
```

The browser can see these values. Do not place service-account credentials or other private server keys in this file.

## 6. GitHub repository

Put this project in the repository `HorseGame_OddStride`.

The important layout is:

```text
HorseGame_OddStride/
├── public/
│   ├── index.html
│   ├── game.js
│   ├── styles.css
│   ├── firebase-config.js
│   └── firebase-client.js
├── database.rules.json
└── .github/
    └── workflows/
        └── deploy-pages.yml
```

Commit and push to the `main` branch.

## 7. GitHub Pages

In GitHub:

Settings -> Pages -> Build and deployment -> Source -> GitHub Actions.

The included workflow uploads the `public/` directory, so the site URL should be:

`https://YOUR-USERNAME.github.io/HorseGame_OddStride/`

Do not add `/public/` to the URL.

## 8. Firebase Authorized domains

Firebase Console -> Authentication -> Settings -> Authorized domains.

Add your Pages hostname:

`j0n4th4naa.github.io`

If you test locally, also keep `localhost` available.

## 9. Test the game

Open your GitHub Pages URL.

Try the normal race first. Then open Multiplayer.

Create a room. The host gets a 4-character room code and QR link.

Scan the QR code with a phone. The phone opens the same GitHub Pages app and joins the room.

Repeat with up to three additional devices. The host can start once at least two players are connected.

Each player draws a horse and uses their own GIDDY UP button. Laptops can use the on-screen button or Space.

## 10. If Create Room does not work

Open the browser developer console and look for a Firebase error.

Common causes:

- `firebase-config.js` still contains empty values.
- Realtime Database was not created.
- Anonymous Authentication was not enabled.
- The database rules were not published.
- `j0n4th4naa.github.io` was not added to Firebase Authorized domains.
- GitHub Pages is still deploying an older commit.

## 11. Important free-plan limitation

This version uses Firebase directly from the browser. The game is fully functional for friend-group multiplayer, but race results are computed by the clients from the shared tap events. A malicious player could modify their browser and fake inputs. A trusted server would be needed for strong competitive anti-cheat.

For a four-person friend game, this Firebase setup avoids the need for a separate Node.js host and keeps the multiplayer state synchronized through Realtime Database.

## 12. Optional local test

From the repository root, serve the `public/` folder with any static HTTP server. For example:

```bash
cd public
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

Do not open `index.html` directly with `file://`, because browser module and Firebase behavior can differ from a real HTTP origin.
