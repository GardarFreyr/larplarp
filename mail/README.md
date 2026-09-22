# Mail

A simple email app for Gmail. It runs entirely in your browser, and there is no server.
Your emails go straight between your browser and Google.

- Sign in with your Google account
- Read your Inbox, Starred, Sent, Drafts and Trash
- Search, star, mark as unread, archive and delete
- Write, reply to and forward emails, and save drafts
- Download attachments
- Works on desktop (three columns) and on phone (tab bar), and can be installed on your home screen

## One-time setup (about 5 minutes)

Google requires every app that reads Gmail to have its own **OAuth Client ID**.
You create it once, for free, in Google Cloud.

### 1. Host the app

The app has to be opened from an `https://` address (or `http://localhost`).
Opening `index.html` as a file will not work. The easiest option is GitHub Pages:

1. On GitHub, open this repository and go to **Settings → Pages**.
2. Under **Build and deployment**, pick **Deploy from a branch**, choose your branch and `/ (root)`, then click **Save**.
3. After a minute the app is live at `https://<your-username>.github.io/larplarp/mail/`.

To test on your own computer instead, run `python3 -m http.server 8000` inside the `mail` folder and open `http://localhost:8000`.

### 2. Create a Google OAuth Client ID

1. Go to <https://console.cloud.google.com/> and create a new project (for example "My Mail").
2. Open **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
3. Open **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer consoles):
   - User type: **External**
   - App name: `Mail`, and enter your email as the support and developer contact
   - Under **Audience / Test users**, click **Add users** and add your own Gmail address
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: add the address where the app lives, *without* a path, for example
     `https://<your-username>.github.io` (and `http://localhost:8000` if you test locally)
   - Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`)

### 3. Sign in

Open the app, paste the Client ID into the sign-in screen, and click **Sign in with Google**.
The app remembers the Client ID. You can also put it in `config.js` so you never have to type it.

Because the app is in "testing" mode in Google Cloud, Google shows a
**"Google hasn't verified this app"** warning. This is expected for a personal app.
Click **Continue**. Only the test users you added can sign in.

## Install on your phone

- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**

## Notes

- Permission used: `gmail.modify` (read, send, label and trash). The app can't permanently delete email.
- Google sign-in lasts about an hour. When it runs out, tap **Reconnect** in the message that appears.
- HTML emails are shown in a sandbox where scripts can't run.
