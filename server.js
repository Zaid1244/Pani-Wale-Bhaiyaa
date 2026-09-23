import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import dotenv from "dotenv";
import dns from "node:dns";
dotenv.config();

// Render jaise hosts par IPv6 route se Gmail SMTP tak connect fail hota hai
// (ENETUNREACH / timeout) — isliye IPv4 ko pehle try karne ke liye force karo.
dns.setDefaultResultOrder("ipv4first");

const serviceAccount = {
  type: process.env.TYPE,
  project_id: process.env.PROJECT_ID,
  private_key_id: process.env.PRIVATE_KEY_ID,
  private_key: process.env.PRIVATE_KEY?.replace(/\\n/g, "\n") || "", // VERY IMPORTANT
  client_email: process.env.CLIENT_EMAIL,
  client_id: process.env.CLIENT_ID,
  auth_uri: process.env.AUTH_URI,
  token_uri: process.env.TOKEN_URI,
  auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url: process.env.CLIENT_CERT_URL,
  universe_domain: process.env.UNIVERSE_DOMAIN,
};

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

import bp from "body-parser";
import ph from "password-hash";
import uniqId from "uniqid";
import session from "express-session";
import express from "express";
import QRCode from "qrcode";

const app = express();
app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(bp.urlencoded({ extended: true }));
app.use(bp.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "canconnect app",
    resave: true,
    saveUninitialized: true,
  })
);

const FREE_ORDER_LIMIT = 3;
// Plant jo 4 fixed items bech sakta hai — har item ka apna price plant khud set karta hai
const ITEM_TYPES = [
  { key: "can20l", label: "Can 20L" },
  { key: "can10l", label: "Can 10L" },
  { key: "bottle1l", label: "Bottle 1L" },
  { key: "bottle500ml", label: "Bottle 500ml" },
];

// ---------------------------------------------------------------------
// ADMIN — platform-wide stats dashboard
// ---------------------------------------------------------------------
// .env me ye set karo:
//   ADMIN_PASSWORD=koi_bhi_strong_password
// Isi password se /admin/login pe login hoga — koi username nahi, bas ek shared password.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (!ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD .env me nahi mila — /admin panel login accept nahi karega.");
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect("/admin/login");
}

// ---------------------------------------------------------------------
// INSTAMOJO (payment gateway) — LIVE mode, seedha real payment lega
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// PAYPAL (payment gateway)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// INSTAMOJO (payment gateway) — LIVE mode, seedha real payment lega
// ---------------------------------------------------------------------
/*const INSTAMOJO_BASE = "https://www.instamojo.com/api/1.1";

if (process.env.INSTAMOJO_MODE && process.env.INSTAMOJO_MODE !== "live") {
  console.warn(
    `INSTAMOJO_MODE="${process.env.INSTAMOJO_MODE}" hai, par ye app sirf LIVE mode support karta hai (sandbox/test hata diya gaya hai). .env me INSTAMOJO_MODE=live rakho.`
  );
}

const INSTAMOJO_HEADERS = {
  "X-Api-Key": process.env.INSTAMOJO_API_KEY || "",
  "X-Auth-Token": process.env.INSTAMOJO_AUTH_TOKEN || "",
};*/
/*const PAYPAL_BASE =
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY || "USD";

// PayPal Instamojo jaisa static API key nahi leta — har request se pehle
// Client ID + Secret se ek short-lived OAuth access token lena padta hai.
async function getPaypalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error("PayPal token error:", data);
    throw new Error("PayPal access token nahi mila");
  }
  return data.access_token;
}*/
const PLAN_PRICES = { Starter: 89 , Pro: 149 , Enterprise: 349  };
// har plan ki apni validity (din mein) — Starter 1 month, Pro 2 months, Enterprise 6 months
const PLAN_VALIDITY_DAYS = { Starter: 30, Pro: 60, Enterprise: 180 };

// ---------------------------------------------------------------------
// EMAIL (Gmail) — naya order aane par plant ko email se notify karta hai
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// EMAIL (Brevo HTTP API) — naya order aane par plant ko email se notify karta hai
// Render ka FREE plan outbound SMTP ports (25/465/587) block karta hai,
// isliye Gmail SMTP (nodemailer) free instance par kabhi kaam nahi karega.
// Brevo ka HTTP API port 443 (HTTPS) pe chalta hai, jo kabhi block nahi hota.
//
// .env me ye set karo:
//   BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   BREVO_SENDER_EMAIL=youraddress@gmail.com   (Brevo dashboard me "Single Sender" verify karo)
// (brevo.com par free signup karo, "Single Sender" verify karo, phir
//  SMTP & API > API Keys > "Generate a new API key" se BREVO_API_KEY lo)
// ---------------------------------------------------------------------
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;

if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
  console.warn(
    "BREVO_API_KEY / BREVO_SENDER_EMAIL .env me nahi mile — order email notifications OFF rahenge."
  );
}

// Naya order aane par plant ko email bhejta hai.
// Kabhi bhi order flow ko fail nahi karta — sirf error log karta hai.
async function notifyPlantNewOrder(plantData, { orderID, itemsSummary, totalAmount, buyerData }) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) return;
  if (!plantData.email) {
    console.warn(`Plant "${plantData.plant_name}" ka email nahi mila, notify skip.`);
    return;
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Water Sale", email: BREVO_SENDER_EMAIL },
        to: [{ email: plantData.email, name: plantData.owner_name || plantData.plant_name }],
        subject: `Naya Order Aaya Hai — #${orderID}`,
        textContent:
          `Namaste ${plantData.owner_name || plantData.plant_name},\n\n` +
          `Aapko "Pani Wale Bhaiya" App par ek naya order mila hai:\n\n` +
          `Order ID: ${orderID}\n` +
          `Items: ${itemsSummary}\n` +
          `Total: ₹${totalAmount}\n` +
          `Buyer: ${buyerData.buyer_name}\n` +
          `Address:${buyerData.city}, ${buyerData.dist}, ${buyerData.state} — ${buyerData.pincode}\n\n` +
          `Order accept karne ke liye App Ya Website kholo aur accept karne k baad Directly buyer ko Call karo : https://www.paniwalebhaiya.shop\n\n` +
          `— CanConnect`,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Brevo API error ${res.status}: ${errText}`);
    }

    console.log(`Email notify SUCCESS: order #${orderID} -> ${plantData.email}`);
  } catch (err) {
    console.error("Email notify error:", err.message);
  }
}

// ---------------------------------------------------------------------
// PUBLIC / LANDING
// ---------------------------------------------------------------------
app.get("/", (req, res) => {
  res.render("intro", {
    title: "PaniWaleBhaiya",
    description: "Ye Water Buyers aur Water Distributors ko aapas mein jodta hai pani ka order dene aur lene ke liye.",
    robots: "index,follow"
  });
});
app.get("/signup", (req, res) => {
  res.render("reg_home", {
    title: "Register",
    description: "PaniWaleBhaiya par account register karein.",
    robots: "noindex,nofollow"
  });
});

app.get("/help", (req, res) => {
  res.render("help", {
    title: "For Help?",
    description: "PaniWaleBhaiya team se sampark karein.",
    robots: "index,follow"
  });
});

app.get("/plantRegister", (req, res) =>
  res.render("plant_register", {
    sucState: false,
    errState: false,
    title: "Water Plant Registration ",
    description: "PaniWaleBhaiya par water plant register karein.",
    robots: "noindex,nofollow"
  })
);
app.get("/buyerRegister", (req, res) =>
  res.render("buyer_register", {
    sucState: false,
    errState: false,
    title: "Buyer Registration",
    description: "PaniWaleBhaiya par buyer account register karein.",
    robots: "noindex,nofollow"
  })
);
app.get("/plantlogin", (req, res) =>
  res.render("plant_login", {
    errState: false,
    title: "Water Plant Login",
    description: "PaniWaleBhaiya water plant login.",
    robots: "noindex,nofollow"
  })
);
app.get("/buyerlogin", (req, res) =>
  res.render("buyer_login", {
    errState: false,
    title: "Buyer Login ",
    description: "PaniWaleBhaiya buyer login.",
    robots: "noindex,nofollow"
  })
);

// ---------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------
app.post("/plant_register_submit", async (req, res) => {
  const email = req.body.email;
  const psw = req.body.psw;
  const c_psw = req.body.c_psw;

  const existing = await db.collection("Plants").where("email", "==", email).get();
  if (existing.size > 0) {
    return res.render("plant_register", {
      sucState: false,
      errState: true,
      errMsg: "Is email se plant pehle se register hai.!",
      title: "Water Plant Registration",
  description: " water plant registration.",
  robots: "noindex,nofollow"
    });
  }
  if (psw !== c_psw) {
    return res.render("plant_register", {
      sucState: false,
      errState: true,
      errMsg: "Password match nahi ho raha.!",
      title: "Water Plant Registration ",
  description: "water plant registration.",
  robots: "noindex,nofollow"
    });
  }
  await db.collection("Plants").add({
    plant_name: req.body.plant_name,
    plant_id: req.body.plant_id,
    owner_name: req.body.owner_name,
    email,
    password: ph.generate(psw),
    ph_no: req.body.phone_no,
    state: req.body.state,
    dist: req.body.district,
    city: req.body.city,
    street: req.body.street,
    pincode: req.body.pincode,
    prices: {
      can20l: Number(req.body.price_can20l) || 0,
      can10l: Number(req.body.price_can10l) || 0,
      bottle1l: Number(req.body.price_bottle1l) || 0,
      bottle500ml: Number(req.body.price_bottle500ml) || 0,
    },
    plan: "Free Trial",
    freeOrdersUsed: 0,
  });
  res.render("plant_register", {
    sucState: true,
    errState: false,
    title: "Water Plant Registration ",
    description: " water plant registration.",
    robots: "noindex,nofollow"
  });
});

app.post("/buyer_register_submit", async (req, res) => {
  const email = req.body.email;
  const psw = req.body.psw;
  const c_psw = req.body.c_psw;

  const existing = await db.collection("Buyers").where("email", "==", email).get();
  if (existing.size > 0) {
    return res.render("buyer_register", {
      sucState: false,
      errState: true,
      errMsg: "Is email se buyer pehle se register hai.!",
      title: "Buyer Registration ",
description: " buyer registration.",
robots: "noindex,nofollow"
    });
  }
  if (psw !== c_psw) {
    return res.render("buyer_register", {
      sucState: false,
      errState: true,
      errMsg: "Password match nahi ho raha.!",
      title: "Buyer Registration ",
description: " buyer registration.",
robots: "noindex,nofollow"
    });
  }
  await db.collection("Buyers").add({
    buyer_name: req.body.user_name,
    email,
    password: ph.generate(psw),
    ph_no: req.body.phone_no,
    state: req.body.state,
    dist: req.body.district,
    city: req.body.city,
    street: req.body.street,
    pincode: req.body.pincode,
  });
  res.render("buyer_register", { sucState: true, errState: false , title: "Buyer Registration ",
  description: " buyer registration.",
  robots: "noindex,nofollow"});
});

// ---------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------
app.post("/plant_login_submit", async (req, res) => {
  const plant_id = req.body.plant_id;
  const email = req.body.email;
  const psw = req.body.psw;

  const snap = await db.collection("Plants").where("email", "==", email).get();
  if (snap.size === 0) {
    return res.render("plant_login", { errState: true, errMsg: "Plant nahi mila.!",title: "Water Plant Login ",
    description: "water plant login.",
    robots: "noindex,nofollow" });
  }
  const userData = snap.docs[0].data();
  if (!ph.verify(psw, userData.password)) {
    return res.render("plant_login", { errState: true, errMsg: "Password galat hai.!" , title: "Water Plant Login ",
    description: "water plant login.",
    robots: "noindex,nofollow"});
  }
  if (plant_id !== userData.plant_id) {
    return res.render("plant_login", { errState: true, errMsg: "Plant ID match nahi hua.!" , title: "Water Plant Login ",
    description: "water plant login.",
    robots: "noindex,nofollow"});
  }
  req.session.plantEmail = email;
  await renderPlantHome(req, res);
});

app.post("/buyer_login_submit", async (req, res) => {
  const email = req.body.email;
  const psw = req.body.psw;

  const snap = await db.collection("Buyers").where("email", "==", email).get();
  if (snap.size === 0) {
    return res.render("buyer_login", { errState: true, errMsg: "Buyer nahi mila.!", title: "Buyer Login ",
    description: " buyer login.",
    robots: "noindex,nofollow" });
  }
  const userData = snap.docs[0].data();
  if (!ph.verify(psw, userData.password)) {
    return res.render("buyer_login", { errState: true, errMsg: "Password galat hai.!" , title: "Buyer Login ",
    description: "buyer login.",
    robots: "noindex,nofollow"});
  }
  req.session.buyerEmail = email;
  res.render("buyer_home", { name: userData.buyer_name , title: "Buyer Home",
  description: "PaniWaleBhaiya par account login karein.",
  robots: "noindex,nofollow"});
});

// ---------------------------------------------------------------------
// BUYER: browse plants + place order
// ---------------------------------------------------------------------

// Pincode-based "nearby" proxy — asli lat/long / Google Distance Matrix API
// nahi hai, isliye Indian PIN code ke leading-digit structure ka use karke
// rough closeness nikalte hain: pincode jitne zyada leading digits match
// karein, utna hi paas ka area (0 = same pincode, 6 = bilkul alag region).
// Production app me isko real geocoding + Haversine distance se replace karo.
function pincodeDistance(pinA, pinB) {
  pinA = (pinA || "").toString().trim();
  pinB = (pinB || "").toString().trim();
  if (!/^\d{6}$/.test(pinA) || !/^\d{6}$/.test(pinB)) return 99; // invalid/missing — sabse last me dikhao
  if (pinA === pinB) return 0;
  let matchLen = 0;
  for (let i = 0; i < 6; i++) {
    if (pinA[i] === pinB[i]) matchLen++;
    else break;
  }
  return 6 - matchLen; // 0 = same pincode, 1-2 = nearby area, 3+ = door
}

app.get("/buyer_home", async (req, res) => {
  const email = req.session.buyerEmail;
  const snap = await db.collection("Buyers").where("email", "==", email).get();

  res.render("buyer_home", {
    name: snap.docs[0].data().buyer_name,
    title: "Buyer Dashboard",
    description: " Buyer Dashboard",
    robots: "noindex,nofollow"
  });
});

app.get("/order_can", async (req, res) => {
  const plantsSnap = await db.collection("Plants").get();
  let plant_data = plantsSnap.docs.map((d) => d.data());

  // jo plant free trial khatam kar chuka hai aur koi active paid plan nahi hai,
  // wo order accept hi nahi kar sakta — isliye buyer ko dikhana hi mat
  plant_data = plant_data.filter((p) => {
    const hasPaidPlan =
      p.plan && p.plan !== "Free Trial" && p.planExpiry && new Date(p.planExpiry).getTime() > Date.now();
    const trialLeft = (p.freeOrdersUsed || 0) < FREE_ORDER_LIMIT;
    return hasPaidPlan || trialLeft;
  });

  const buyer_email = req.session.buyerEmail;
  const buyerSnap = await db.collection("Buyers").where("email", "==", buyer_email).get();
  const buyerData = buyerSnap.docs[0].data();

  // query se pincode aaya to wahi search karo, warna buyer ke apne address ka pincode use karo
  const searchPincode = (req.query.pincode || buyerData.pincode || "").toString().trim();

  plant_data = plant_data
    .map((p) => ({ ...p, _distance: pincodeDistance(searchPincode, p.pincode) }))
    .sort((a, b) => a._distance - b._distance);

    res.render("order_can", {
      dataArr: { plant_data },
      buyer_details: buyerData,
      searchPincode,
      itemTypes: ITEM_TYPES,
      title: "Order Water Can - CanConnect",
      description: "Nearby water plants se water can aur bottles order karein.",
      robots: "noindex,nofollow"
    });
  });

  app.post("/order_can_submit", async (req, res) => {
    const orderID = uniqId();
    const date = new Date();
    const buyer_email = req.session.buyerEmail;
  
    const buyerSnap = await db.collection("Buyers").where("email", "==", buyer_email).get();
    const buyerDoc = buyerSnap.docs[0];
    const buyerData = buyerDoc.data();
  
    const plantSnap = await db
      .collection("Plants")
      .where("plant_name", "==", req.body.plantname)
      .get();
    const plantDoc = plantSnap.docs[0];
    const plantData = plantDoc.data();
  
    // buyer ne jitne items ke liye quantity > 0 rakhi hai, unhi ko order me daalo
    const items = ITEM_TYPES.map((it) => {
      const qty = parseInt(req.body[`qty_${it.key}`], 10) || 0;
      const price = (plantData.prices && plantData.prices[it.key]) || 0;
      return { key: it.key, label: it.label, qty, price };
    }).filter((it) => it.qty > 0);
  
    if (items.length === 0) {
      return res.redirect("/order_can");
    }
  
    const totalAmount = items.reduce((sum, it) => sum + it.qty * it.price, 0);
    const itemsSummary = items.map((it) => `${it.label} x${it.qty}`).join(", ");
  
    const address = `${buyerData.street}/${buyerData.city}/${buyerData.dist}/${buyerData.state}/${buyerData.pincode}`;
  
    await plantDoc.ref.collection("Orders").add({
      OrderId: orderID,
      Status: "Pending",
      Date: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
      Buyer_name: buyerData.buyer_name,
      Buyer_ph_no: buyerData.ph_no,
      Buyer_email: buyer_email,
      Items: items,
      ItemsSummary: itemsSummary,
      TotalAmount: totalAmount,
      Buyer_address: address,
    });
  
    await buyerDoc.ref.collection("Orders").add({
      OrderId: orderID,
      Date: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
      Ordered_from: plantData.plant_name,
      Plant_ph: plantData.ph_no,
      Items: items,
      ItemsSummary: itemsSummary,
      TotalAmount: totalAmount,
      Status: "Pending",
    });
    // plant ko email se turant notify karo — isse order flow block/fail nahi hota
    notifyPlantNewOrder(plantData, { orderID, itemsSummary, totalAmount, buyerData }).catch((err) =>
      console.error("notifyPlantNewOrder error:", err)
    );
  
    res.redirect("/buyer_history");
  });

  app.get("/buyer_history", async (req, res) => {
    const email = req.session.buyerEmail;
    const snap = await db.collection("Buyers").where("email", "==", email).get();
    const doc = snap.docs[0];
    const hisSnap = await doc.ref.collection("Orders").get();
    const buyer_his_data = hisSnap.docs.map((d) => d.data());
  
    res.render("buyer_history", {
      name: doc.data().buyer_name,
      dataArr: { buyer_his_data },
      title: "Order History",
      description: "buyer order history.",
      robots: "noindex,nofollow"
    });
  });

app.get("/buyer_profile", async (req, res) => {
  const email = req.session.buyerEmail;
  const snap = await db.collection("Buyers").where("email", "==", email).get();
  const doc = snap.docs[0];
  const hisSnap = await doc.ref.collection("Orders").get();
  res.render("buyer_profile", {
    buyer_data: doc.data(),
    no_orders: hisSnap.size,
    title: "Buyer Profile ",
    description: "buyer profile.",
    robots: "noindex,nofollow"
  });
});

// ---------------------------------------------------------------------
// PLANT: dashboard, accept/deliver orders, upgrade plan
// ---------------------------------------------------------------------
async function renderPlantHome(req, res, extra = {}) {
  const email = req.session.plantEmail;
  const snap = await db.collection("Plants").where("email", "==", email).get();
  const doc = snap.docs[0];
  let data = doc.data();

  // agar paid plan ki 30 din ki validity khatam ho gayi hai, to wapas Free Trial pe daal do
  if (data.plan && data.plan !== "Free Trial" && data.planExpiry) {
    const expired = new Date(data.planExpiry).getTime() < Date.now();
    if (expired) {
      await doc.ref.update({
        plan: "Free Trial",
        planExpiry: FieldValue.delete(),
      });
      data = { ...data, plan: "Free Trial", planExpiry: null };
      if (!extra.paymentMsg) {
        extra = {
          paymentMsg: "Aapke plan ki validity khatam ho gayi hai. Dobara upgrade karo.",
          paymentOk: false,
        };
      }
    }
  }

  const pendingSnap = await doc.ref.collection("Orders").where("Status", "==", "Pending").get();
  const plant_his_data = pendingSnap.docs.map((d) => d.data());

  const daysLeft =
    data.plan !== "Free Trial" && data.planExpiry
      ? Math.max(0, Math.ceil((new Date(data.planExpiry).getTime() - Date.now()) / 86400000))
      : null;

      res.render("plant_home", {
        name: data.plant_name,
        plan: data.plan || "Free Trial",
        planExpiry: data.planExpiry || null,
        daysLeft,
        freeOrdersUsed: data.freeOrdersUsed || 0,
        freeLimit: FREE_ORDER_LIMIT,
        dataArr: { plant_his_data },
        paymentMsg: extra.paymentMsg || null,
        paymentOk: extra.paymentOk || false,
      
        title: "Plant Dashboard",
        description: " Water Plant Dashboard.",
        robots: "noindex,nofollow"
      });
}

app.get("/plant_home", renderPlantHome);

app.post("/order_accept", async (req, res) => {
  const plant_email = req.session.plantEmail;
  const buyer_email = req.body.orderemail;
  const orderid = req.body.orderid;

  const plantSnap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = plantSnap.docs[0];
  const plantData = plantDoc.data();

  // Free Trial ki limit poori ho chuki hai aur koi paid plan nahi hai -> order accept hi mat karo
  if (plantData.plan === "Free Trial" && (plantData.freeOrdersUsed || 0) >= FREE_ORDER_LIMIT) {
    return await renderPlantHome(req, res, {
      paymentMsg: "Aapke 3 free order poore ho gaye hain. Naye order accept karne ke liye plan upgrade karo.",
    });
  }

  const orderSnap = await plantDoc.ref.collection("Orders").where("OrderId", "==", orderid).get();
  await orderSnap.docs[0].ref.update({ Status: "Accepted" });

  const buyerSnap = await db.collection("Buyers").where("email", "==", buyer_email).get();
  const buyerOrderSnap = await buyerSnap.docs[0].ref
    .collection("Orders")
    .where("OrderId", "==", orderid)
    .get();
  await buyerOrderSnap.docs[0].ref.update({ Status: "Accepted" });

  // free-trial counter only advances while the plant is still on Free Trial
  if (plantData.plan === "Free Trial" && (plantData.freeOrdersUsed || 0) < FREE_ORDER_LIMIT) {
    await plantDoc.ref.update({ freeOrdersUsed: (plantData.freeOrdersUsed || 0) + 1 });
  }

  await renderPlantHome(req, res);
});

app.post("/order_delivered", async (req, res) => {
  const plant_email = req.session.plantEmail;
  const buyer_email = req.body.orderemail;
  const orderid = req.body.orderid;

  const plantSnap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = plantSnap.docs[0];

  const orderSnap = await plantDoc.ref.collection("Orders").where("OrderId", "==", orderid).get();
  await orderSnap.docs[0].ref.update({ Status: "Delivered" });

  const buyerSnap = await db.collection("Buyers").where("email", "==", buyer_email).get();
  const buyerOrderSnap = await buyerSnap.docs[0].ref
    .collection("Orders")
    .where("OrderId", "==", orderid)
    .get();
  await buyerOrderSnap.docs[0].ref.update({ Status: "Delivered" });

  res.redirect("/plant_history");
});

/*app.post("/upgrade_plan", async (req, res) => {
  const plant_email = req.session.plantEmail;
  const plan = req.body.plan; // Starter | Pro | Enterprise
  const amount = PLAN_PRICES[plan];

  if (!amount) {
    return await renderPlantHome(req, res, {
      paymentMsg: "Invalid plan.",
      paymentOk: false,
    });
  }

  const snap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = snap.docs[0];
  const plantData = plantDoc.data();*/

  /*try {
    // Instamojo par ek payment request banao — isi ka longurl pe plant ko bhejenge
    const body = new URLSearchParams({
      purpose: `CanConnect ${plan} Plan`,
      amount: String(amount),
      buyer_name: plantData.owner_name || plantData.plant_name,
      email: plant_email,
      phone: plantData.ph_no || "",
      redirect_url: `${process.env.APP_BASE_URL}/upgrade_plan/callback`,
      send_email: "false",
      send_sms: "false",
      allow_repeated_payments: "false",
    });

    const imRes = await fetch(`${INSTAMOJO_BASE}/payment-requests/`, {
      method: "POST",
      headers: {
        ...INSTAMOJO_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const imData = await imRes.json();

    if (!imData.success) {
      console.error("Instamojo payment-request error:", imData);
      return await renderPlantHome(req, res, {
        paymentMsg: "Payment request nahi ban paya. Baad me try karo.",
        paymentOk: false,
      });
    }

    // kaunsa plan lena tha aur kaunsi payment-request thi, dono save karo — callback me isi se verify hoga
    await plantDoc.ref.update({
      pendingPlan: plan,
      pendingPaymentRequestId: imData.payment_request.id,
    });

    res.redirect(imData.payment_request.longurl);
  } catch (err) {
    console.error("Instamojo error:", err);
    await renderPlantHome(req, res, {
      paymentMsg: "Payment gateway se connect nahi ho paya. Baad me try karo.",
      paymentOk: false,
    });
  }
});*/

  /*try {
    const accessToken = await getPaypalAccessToken();

    // PayPal par ek order banao — isi ka approve link pe plant ko bhejenge
    const orderRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            description: `CanConnect ${plan} Plan`,
            amount: {
              currency_code: PAYPAL_CURRENCY,
              value: String(amount),
            },
          },
        ],
        application_context: {
          return_url: `${process.env.APP_BASE_URL}/upgrade_plan/callback`,
          cancel_url: `${process.env.APP_BASE_URL}/upgrade_plan/callback`,
          user_action: "PAY_NOW",
        },
      }),
    });

    const orderData = await orderRes.json();

    if (!orderData.id) {
      console.error("PayPal order create error:", orderData);
      return await renderPlantHome(req, res, {
        paymentMsg: "Payment request nahi ban paya. Baad me try karo.",
        paymentOk: false,
      });
    }

    // kaunsa plan lena tha aur kaunsa PayPal order tha, dono save karo — callback me isi se capture/verify hoga
    await plantDoc.ref.update({
      pendingPlan: plan,
      pendingPaymentRequestId: orderData.id,
    });

    const approveLink = orderData.links.find((l) => l.rel === "approve")?.href;
    res.redirect(approveLink);
  } catch (err) {
    console.error("PayPal error:", err);
    await renderPlantHome(req, res, {
      paymentMsg: "Payment gateway se connect nahi ho paya. Baad me try karo.",
      paymentOk: false,
    });
  }
});*/

// Instamojo checkout ke baad plant yahin wapas aata hai (redirect_url)
/*app.get("/upgrade_plan/callback", async (req, res) => {
  const plant_email = req.session.plantEmail;
  if (!plant_email) return res.redirect("/plantlogin");

  const { payment_request_id, payment_id, payment_status } = req.query;

  const snap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = snap.docs[0];
  const plantData = plantDoc.data();

  // client se aaye query params par bharosa mat karo — Instamojo se dobara confirm karo ki paisa aaya ya nahi
  if (
    payment_status === "Credit" &&
    payment_request_id &&
    payment_request_id === plantData.pendingPaymentRequestId
  ) {
    try {
      const verifyRes = await fetch(
        `${INSTAMOJO_BASE}/payment-requests/${payment_request_id}/`,
        { headers: INSTAMOJO_HEADERS }
      );
      const verifyData = await verifyRes.json();

      const confirmedCredit =
        verifyData.success &&
        verifyData.payment_request.status === "Completed" &&
        (verifyData.payment_request.payments || []).some(
          (p) => p.payment_id === payment_id && p.status === "Credit"
        );

        if (confirmedCredit) {
          const validityDays = PLAN_VALIDITY_DAYS[plantData.pendingPlan] || 30;
          const expiryDate = new Date(Date.now() + validityDays * 86400000);
          await plantDoc.ref.update({
            plan: plantData.pendingPlan,
            planExpiry: expiryDate.toISOString(),
            pendingPlan: FieldValue.delete(),
            pendingPaymentRequestId: FieldValue.delete(),
          });

          // platform-wide revenue tracker — admin dashboard isi se "Total Commission" dikhata hai.
          // Current plan field sirf "abhi ka" state batata hai, isliye history alag se count karte hain.
          const paidAmount = PLAN_PRICES[plantData.pendingPlan] || 0;
          await db
            .collection("Meta")
            .doc("stats")
            .set(
              {
                totalRevenue: FieldValue.increment(paidAmount),
                totalPaidUpgrades: FieldValue.increment(1),
              },
              { merge: true }
            );

          return await renderPlantHome(req, res, {
            paymentMsg: `Payment successful! ${plantData.pendingPlan} plan ${validityDays} din ke liye activate ho gaya.`,
            paymentOk: true,
          });
        }
    } catch (err) {
      console.error("Instamojo verify error:", err);
    }
  }

  await renderPlantHome(req, res, {
    paymentMsg: "Payment complete nahi hua ya cancel ho gaya. Dobara try karo.",
    paymentOk: false,
  });
});*/
// PayPal checkout ke baad plant yahin wapas aata hai (return_url / cancel_url)
/*app.get("/upgrade_plan/callback", async (req, res) => {
  const plant_email = req.session.plantEmail;
  if (!plant_email) return res.redirect("/plantlogin");

  const { token: paypalOrderId } = req.query; // PayPal isi param se order id bhejta hai

  const snap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = snap.docs[0];
  const plantData = plantDoc.data();

  // client se aaye query params par bharosa mat karo — PayPal se dobara capture/confirm karo ki paisa aaya ya nahi
  if (paypalOrderId && paypalOrderId === plantData.pendingPaymentRequestId) {
    try {
      const accessToken = await getPaypalAccessToken();

      const captureRes = await fetch(
        `${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      const captureData = await captureRes.json();

      const confirmedCredit =
        captureData.status === "COMPLETED" &&
        (captureData.purchase_units || []).some((u) =>
          (u.payments?.captures || []).some((c) => c.status === "COMPLETED")
        );

      if (confirmedCredit) {
        const validityDays = PLAN_VALIDITY_DAYS[plantData.pendingPlan] || 30;
        const expiryDate = new Date(Date.now() + validityDays * 86400000);
        await plantDoc.ref.update({
          plan: plantData.pendingPlan,
          planExpiry: expiryDate.toISOString(),
          pendingPlan: FieldValue.delete(),
          pendingPaymentRequestId: FieldValue.delete(),
        });

        // platform-wide revenue tracker — admin dashboard isi se "Total Commission" dikhata hai.
        // Current plan field sirf "abhi ka" state batata hai, isliye history alag se count karte hain.
        const paidAmount = PLAN_PRICES[plantData.pendingPlan] || 0;
        await db
          .collection("Meta")
          .doc("stats")
          .set(
            {
              totalRevenue: FieldValue.increment(paidAmount),
              totalPaidUpgrades: FieldValue.increment(1),
            },
            { merge: true }
          );

        return await renderPlantHome(req, res, {
          paymentMsg: `Payment successful! ${plantData.pendingPlan} plan ${validityDays} din ke liye activate ho gaya.`,
          paymentOk: true,
        });
      }
    } catch (err) {
      console.error("PayPal verify error:", err);
    }
  }

  await renderPlantHome(req, res, {
    paymentMsg: "Payment complete nahi hua ya cancel ho gaya. Dobara try karo.",
    paymentOk: false,
  });
});*/

app.post("/upgrade_plan", async (req, res) => {
  const plant_email = req.session.plantEmail;
  if (!plant_email) return res.redirect("/plantlogin");

  const plan = req.body.plan; // Starter | Pro | Enterprise
  const amount = PLAN_PRICES[plan];
  const validityDays = PLAN_VALIDITY_DAYS[plan];

  if (!amount) {
    return await renderPlantHome(req, res, {
      paymentMsg: "Invalid plan.",
      paymentOk: false,
    });
  }

  const snap = await db.collection("Plants").where("email", "==", plant_email).get();
  const plantDoc = snap.docs[0];
  const plantData = plantDoc.data();

  const paymentRef = await db.collection("PlanPayments").add({
    plantEmail: plant_email,
    plantName: plantData.plant_name || "",
    ownerName: plantData.owner_name || "",
    plan,
    amount,
    validityDays,
    transactionId: "",
    status: "Pending",
    requestedAt: FieldValue.serverTimestamp(),
  });

  res.redirect(`/manual_payment?paymentId=${paymentRef.id}`);
});
app.get("/manual_payment", async (req, res) => {
  const plant_email = req.session.plantEmail;

  if (!plant_email) {
    return res.redirect("/plantlogin");
  }

  const paymentId = req.query.paymentId;

  if (!paymentId) {
    return res.redirect("/plant_home");
  }

  const paymentDoc = await db
    .collection("PlanPayments")
    .doc(paymentId)
    .get();

  if (!paymentDoc.exists) {
    return res.redirect("/plant_home");
  }

  const payment = paymentDoc.data();

  if (payment.plantEmail !== plant_email) {
    return res.redirect("/plant_home");
  }

  // ---- NAYA CODE: UPI link + QR banao ----
  const upiId = process.env.MANUAL_UPI_ID || "";
  const upiLink =
    `upi://pay?pa=${encodeURIComponent(upiId)}` +
    `&pn=${encodeURIComponent("CanConnect")}` +
    `&am=${encodeURIComponent(payment.amount)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(`${payment.plan} Plan - ${paymentId}`)}` +
    `&tr=${encodeURIComponent(paymentId)}`;

  const qrCodeDataUrl = await QRCode.toDataURL(upiLink);
  // ---- NAYA CODE khatam ----

  res.render("manual_payment", {
    paymentId,
    payment,
    upiId,
    upiLink,          // ← naya
    qrCodeDataUrl,    // ← naya
    title: "Manual Payment",
    description: "Manual plan payment",
    robots: "noindex,nofollow"
  });
});

app.post("/manual_payment_submit", async (req, res) => {
  const plant_email = req.session.plantEmail;

  if (!plant_email) {
    return res.redirect("/plantlogin");
  }

  const { paymentId, transactionId } = req.body;

  if (!paymentId || !transactionId || transactionId.trim().length < 6) {
    return res.redirect(
      `/manual_payment?paymentId=${encodeURIComponent(paymentId)}`
    );
  }

  const paymentRef = db.collection("PlanPayments").doc(paymentId);
  const paymentDoc = await paymentRef.get();

  if (!paymentDoc.exists) {
    return res.redirect("/plant_home");
  }

  const payment = paymentDoc.data();

  // Security check
  if (payment.plantEmail !== plant_email) {
    return res.redirect("/plant_home");
  }

  if (payment.status !== "Pending") {
    return res.redirect("/plant_home");
  }

  await paymentRef.update({
    transactionId: transactionId.trim(),
    status: "Submitted",
    submittedAt: FieldValue.serverTimestamp()
  });

  return res.redirect("/plant_home");
});

app.get("/plant_history", async (req, res) => {
  const email = req.session.plantEmail;
  const snap = await db.collection("Plants").where("email", "==", email).get();
  const doc = snap.docs[0];
  const hisSnap = await doc.ref.collection("Orders").where("Status", "!=", "Pending").get();
  const plant_his_data = hisSnap.docs.map((d) => d.data());
  res.render("plant_history", {
    name: doc.data().plant_name,
    dataArr: { plant_his_data },
    title: "Plant Order History - CanConnect",
    description: "CanConnect plant order history.",
    robots: "noindex,nofollow"
  });
});

app.get("/plant_profile", async (req, res) => {
  const email = req.session.plantEmail;
  const snap = await db.collection("Plants").where("email", "==", email).get();
  const doc = snap.docs[0];
  const data = doc.data();
  const hisSnap = await doc.ref.collection("Orders").get();
  res.render("plant_profile", {
    plant_data: data,
    no_orders: hisSnap.size,
    title: "Plant Profile",
    description: " Water plant profile.",
    robots: "noindex,nofollow"
  });
});
// ---------------------------------------------------------------------
// ADMIN: platform-wide stats dashboard
// ---------------------------------------------------------------------
app.get("/admin/login", (req, res) => {
  res.render("admin_login", {
    errState: false,
    title: "Admin Login ",
    description: "administrator login.",
    robots: "noindex,nofollow"
  });
});

app.post("/admin/login_submit", (req, res) => {
  if (!ADMIN_PASSWORD || req.body.password !== ADMIN_PASSWORD) {
    return res.render("admin_login", {
      errState: true,
      title: "Admin Login - CanConnect",
      description: "CanConnect administrator login.",
      robots: "noindex,nofollow"
    });
  }
  req.session.isAdmin = true;
  res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
  req.session.isAdmin = false;
  res.redirect("/admin/login");
});

app.get("/admin", requireAdmin, async (req, res) => {
  const plantsSnap = await db.collection("Plants").get();
  const plants = plantsSnap.docs.map((d) => d.data());

  const planCounts = { "Free Trial": 0, Starter: 0, Pro: 0, Enterprise: 0 };
  plants.forEach((p) => {
    const plan = p.plan || "Free Trial";
    planCounts[plan] = (planCounts[plan] || 0) + 1;
  });
  const freePlants = planCounts["Free Trial"] || 0;
  const paidPlants = plants.length - freePlants;

  const buyersSnap = await db.collection("Buyers").count().get();
  const totalBuyers = buyersSnap.data().count;

  // saare plants ke Orders subcollections ek saath ginne ke liye collectionGroup query
  const ordersSnap = await db.collectionGroup("Orders").get();
  const totalOrders = ordersSnap.size;
  let pendingOrders = 0,
    acceptedOrders = 0,
    deliveredOrders = 0;
  ordersSnap.forEach((d) => {
    const status = d.data().Status;
    if (status === "Pending") pendingOrders++;
    else if (status === "Accepted") acceptedOrders++;
    else if (status === "Delivered") deliveredOrders++;
  });
  const paymentsSnap = await db
  .collection("PlanPayments")
  .orderBy("requestedAt", "desc")
  .get();

const payments = paymentsSnap.docs.map((d) => ({
  id: d.id,
  ...d.data()
}));
  const statsDoc = await db.collection("Meta").doc("stats").get();
  const totalRevenue = statsDoc.exists ? statsDoc.data().totalRevenue || 0 : 0;
  const totalPaidUpgrades = statsDoc.exists ? statsDoc.data().totalPaidUpgrades || 0 : 0;

  res.render("admin_dashboard", {
    totalPlants: plants.length,
    freePlants,
    paidPlants,
    planCounts,
    totalBuyers,
    totalOrders,
    pendingOrders,
    acceptedOrders,
    deliveredOrders,
    totalRevenue,
    totalPaidUpgrades,

    payments,
  
    title: "Admin Dashboard ",
    description: " administrator dashboard.",
    robots: "noindex,nofollow"
  });
});

app.post("/admin/payment/approve", requireAdmin, async (req, res) => {

  const { paymentId } = req.body;

  if (!paymentId) {
    return res.redirect("/admin");
  }

  const paymentRef = db
    .collection("PlanPayments")
    .doc(paymentId);

  const paymentDoc = await paymentRef.get();

  if (!paymentDoc.exists) {
    return res.redirect("/admin");
  }

  const payment = paymentDoc.data();

  if (payment.status !== "Submitted") {
    return res.redirect("/admin");
  }

  const plantSnap = await db
    .collection("Plants")
    .where("email", "==", payment.plantEmail)
    .get();

  if (plantSnap.empty) {
    return res.redirect("/admin");
  }

  const plantDoc = plantSnap.docs[0];

  const validityDays =
    PLAN_VALIDITY_DAYS[payment.plan] || payment.validityDays || 30;

  const expiryDate = new Date(
    Date.now() + validityDays * 86400000
  );

  // Activate plan
  await plantDoc.ref.update({

    plan: payment.plan,

    planExpiry: expiryDate.toISOString(),

    pendingPlan:
      FieldValue.delete(),

    pendingPaymentRequestId:
      FieldValue.delete(),

  });

  // Payment ko approved mark karo
  await paymentRef.update({

    status: "Approved",

    approvedAt:
      FieldValue.serverTimestamp(),

    approvedBy: "Admin"

  });

  // Revenue update
  await db
    .collection("Meta")
    .doc("stats")
    .set(
      {
        totalRevenue:
          FieldValue.increment(payment.amount),

        totalPaidUpgrades:
          FieldValue.increment(1)

      },
      { merge: true }
    );

  res.redirect("/admin");
});
app.post("/admin/payment/reject", requireAdmin, async (req, res) => {

  const { paymentId } = req.body;

  if (!paymentId) {
    return res.redirect("/admin");
  }

  const paymentRef = db
    .collection("PlanPayments")
    .doc(paymentId);

  const paymentDoc = await paymentRef.get();

  if (!paymentDoc.exists) {
    return res.redirect("/admin");
  }

  const payment = paymentDoc.data();

  await paymentRef.update({
    status: "Rejected",

    rejectedAt:
      FieldValue.serverTimestamp(),

    rejectedBy: "Admin"
  });

  // Pending plan ko hata do
  const plantSnap = await db
    .collection("Plants")
    .where("email", "==", payment.plantEmail)
    .get();

  if (!plantSnap.empty) {

    await plantSnap.docs[0].ref.update({

      pendingPlan:
        FieldValue.delete(),

      pendingPaymentRequestId:
        FieldValue.delete()

    });

  }

  res.redirect("/admin");
});
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CanConnect server running on port ${PORT}`);
});
