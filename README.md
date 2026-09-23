# CanConnect 💧

Water can marketplace — jaise tumhara Food Donation app Donors ko Organizations se jodta hai, waise hi ye app **Buyers** ko nazdiki **Water Plants (Distributors)** se jodta hai. Same architecture: Node.js + Express + EJS + Firebase Firestore + session-based login.

## Kya bana hai

- **Buyer flow**: register/login → plants browse karo → can order karo → order history dekho
- **Plant flow**: register/login → naye orders accept karo → free-trial gauge (3 free orders) → 3 ke baad plan choose karo (Starter/Pro/Enterprise) → order history me "Delivered" mark karo
- Firestore me `Plants` aur `Buyers` collections, har doc ke andar `Orders` subcollection (Food Donation app ke `Donation_History` jaisa hi pattern)

## Setup (local pe chalane ke liye)

### 1. Firebase project banao
1. [Firebase Console](https://console.firebase.google.com) pe naya project banao
2. **Firestore Database** enable karo (production ya test mode)
3. **Project Settings → Service Accounts → Generate new private key** — ek JSON file download hogi

### 2. `.env` file banao
`.env.example` ko copy karke `.env` banao, aur downloaded JSON se values bharo:

```bash
cp .env.example .env
```

`PRIVATE_KEY` me `\n` characters waise hi rehne do (code khud unhe real newlines me convert karta hai).

### 3. Install & Run

```bash
npm install
npm start
```

App `http://localhost:3000` pe chalega.

## Deploy (Render pe — jaise tumhara food donation app hai)

1. Code ko GitHub repo me push karo (`.env` **kabhi push mat karo** — `.gitignore` me already hai)
2. [Render.com](https://render.com) pe **New → Web Service** → apna GitHub repo connect karo
3. Build command: `npm install` | Start command: `npm start`
4. Render ke **Environment** tab me `.env` ki saari variables manually add karo
5. Deploy karo — 2-3 min me live link mil jaayega

## Business model jo isme already fit hai

- Har naya plant `plan: "Free Trial"`, `freeOrdersUsed: 0` ke saath register hota hai
- Jab plant koi order **Accept** karta hai, `freeOrdersUsed` +1 hota hai
- 3/3 ho jaane par dashboard pe **upgrade banner** apne aap dikhta hai (Starter ₹499 / Pro ₹999 / Enterprise ₹2499)
- Abhi plan-selection sirf Firestore me plan naam save karta hai — **real payment (UPI/Razorpay) abhi connected nahi hai**

## features available

- **Payment gateway**: Razorpay/UPI integration `upgrade_plan` route me — abhi ye sirf plan name save karta hai, paisa nahi kaatta
- **Pincode-based nearby search**: abhi buyer ko sab plants dikhte hain; real app me pincode/distance se filter karo
-  SMS notification**: naya order aane par plant ko SMS bhejna 

- **Admin panel route**: platform-wide stats (kitne plants free/paid, total commission) — abhi sirf Firestore console se dekhna hoga
