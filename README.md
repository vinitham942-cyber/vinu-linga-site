# Vinu & Linga — Anniversary Site 💖

A private anniversary website with PIN-based access, love messages, photo gallery, quiz, and admin dashboard.

## Deploy to Railway

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project → Deploy from GitHub repo**
3. Select this repository
4. Railway will auto-detect Node.js and deploy

### 3. Set Environment Variables (Important!)
In your Railway project → **Variables**, add:

| Variable    | Value                        |
|-------------|------------------------------|
| `USER_PIN`  | Your partner's PIN (e.g. `85191619`) |
| `ADMIN_PIN` | Your secret admin PIN         |
| `PORT`      | Railway sets this automatically |

> ⚠️ Change the PINs from defaults before deploying!

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`

## Features
- 🔐 PIN login — user vs admin roles
- 💌 Love message board
- 🖼️ Photo gallery with view tracking
- ❓ Relationship quiz with scoring
- 📊 Admin dashboard with stats
