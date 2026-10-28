# Sets & Reps

A training log for classic strength training, sets of reps, as an iPhone home-screen web app.
The sister app of [Superslow](https://github.com/maxmcorp/superslow), which times super-slow sets instead.

Each exercise has a target: a number of sets, a rep range and a rest, like 3 × 8–12 with 1:30 rest
(5 × 5 is a range of one number). You count the reps yourself; the app logs them, times the rest
and tells you what to lift next time, by double progression:

- **Go heavier** when every planned set reached the top of the range.
- **Go lighter** when a set fell under the bottom of it.
- **Keep the weight** otherwise, and aim for the top on every set.

Extra sets past the planned ones don't count. A day is a session.

- Pick a group, then an exercise in it. Groups are your own (Push, Pull, Legs, Upper, Full body …), an exercise can be in several, and **All exercises** lists every one. Rename or delete a group from the same list; deleting one keeps its exercises. A new exercise gets its target when you add it. Exercises done today are ticked, ones started show how far you are (`2/3`), and the next one not done yet is picked for you; take them in any order.
- The start screen shows the target, what you did last time with its advice, and today's sets so far.
- Tap **Start**. Enter the weight and the reps with the big **−** and **+**, then **Save set**. Both start from last time's numbers for that set.
- The rest starts by itself. A voice says the time left at 60 and 30 s, then counts down from 10, and the next set opens on zero. The screen turns green for the last ten seconds. **Skip rest** goes straight on; **Fix that set** corrects the set you just saved.
- The screen stays on during sets and rests.
- After the planned sets, the screen shows the advice in the plate colours: red go lighter, green keep, yellow go heavier. **One more set** adds an extra set after a rest.
- **History** shows each exercise's sets by day in a list that scrolls on its own, coloured red, green or yellow for under, in or over the rep range, and the groups it is in, which you can change there. Colours follow the target as it is now. You can also change the exercise's target, rename it, or delete it with its sets. You can export the sets as CSV, or back up and restore them as JSON.
- Forgot the app? **+ Add a set** in History logs a set afterwards, with its day and time. The form stays open with the time two minutes on, so a whole workout goes in set by set.
- The QR icon at the top shows the app's code full screen, for a friend to scan with their phone's camera.

## Install

Scan the code or open `https://maxmcorp.github.io/setsandreps/`:

<img src="qr.png" alt="QR code for https://maxmcorp.github.io/setsandreps/" width="200">

- **iPhone:** in Safari, tap Share, then **Add to Home Screen**.
- **Android:** in Chrome, open the ⋮ menu and choose **Install app** (or **Add to Home screen**).

Open Sets & Reps from the home-screen icon. After the first launch it works offline.

The countdown plays over your music. On an iPhone the ring/silent switch must be on ring; on Android it follows the media volume, and the phone also vibrates when the rest is over. Keeping the screen on needs iOS 18.4 or later on an iPhone. If the app can't keep it on, a yellow banner says so. If you switch to another app during a rest, the phone pauses Sets & Reps, so the countdown only plays once you are back.

Each phone keeps its own log, in the home-screen app's own storage. Use **Back up** now and then and keep the file somewhere safe (Files, iCloud Drive, Google Drive). Superslow backups can't be restored here: they log seconds, not reps.

## Sounds

`sounds/<n>.wav` is the recording of the number `n`. A rest uses `0` to `10` for the countdown, and `30` and `60` for the time left. A number without a recording plays a beep.

The files in the repository are placeholders spoken by a Windows voice (`tools/placeholder-sounds.ps1`), the same as Superslow's. To use your own, replace the WAVs with files of the same names. They should be mono, short, and similar in loudness. Silence at the start is skipped automatically.

## Deploy a change

```sh
node tools/build.mjs   # lists the sounds, stamps the service worker version
git add -A && git commit -m "..." && git push
```

GitHub Pages serves the `main` branch. The phone picks up the new version the next time the app is opened while online, and reloads the version after that.

## Develop

```sh
npm test               # unit tests (node --test)
npm run serve          # http://localhost:8000; no service worker on http, so edits show on reload
```

| File | What it does |
|---|---|
| `rest.js` | When things are said during a rest. Change the callouts here. |
| `progression.js` | Sets judged against the target, the advice, sessions by day, and what the next set starts with |
| `audio.js` | Loads the sounds and plays them on time with Web Audio |
| `wakelock.js` | Keeps the screen on during sets and rests |
| `store.js` | The training log in local storage, with targets, CSV and JSON export |
| `app.js` | The screens |
| `sw.js` | Offline cache |
| `tools/build.mjs` | Run before each deploy |
| `tools/make-icons.py` | Draws the app icons |
| `tools/make-qr.py` | Writes the QR code for the app's address: `qr.png` for this README, `qr.svg` for the app |

Fonts: Barlow and Barlow Condensed by Jeremy Tribby, under the SIL Open Font License (`fonts/OFL.txt`).
