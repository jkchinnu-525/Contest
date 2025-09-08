import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { createClient } from "redis";
import { PrismaClient } from "./generated/prisma/index.js";
import type { Order } from "./types/index.js";
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const client = createClient({ url: "redis://localhost:6379" });
await client.connect();
const prisma = new PrismaClient();
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "125";
app.use(
  cors({
    origin: ["http://localhost:3002"],
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

const sendMail = async (to: string, link: string) => {
  await transporter.sendMail({
    from: `<${process.env.EMAIL_USER}>`,
    to,
    subject: "Verify your email",
    html: `
      <h4>Welcome!</h2>
      <p>Click below to verify your email:</p>
      <a href="${link}">${link}</a>
    `,
  });
};

const authenticateToken = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || !user.verified) {
      return res.status(401).json({ error: "User not found or not verified" });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: "Invalid token" });
  }
};

app.post("/register", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.json({ error: "Not Found" });
  }
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, verified: false, balance: 10000 },
  });
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET as string,
    {
      expiresIn: "17m",
    },
  );
  const link = `http://localhost:3002/verify?token=${token}`;

  await sendMail(email, link);
  res.json({ message: "Verification email sent" });
});

app.post("/signin", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.verified) {
      return res.status(401).json({ error: "User not found or not verified" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET as string,
      { expiresIn: "24h" },
    );

    res.json({
      message: "Sign in successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error("Sign in error:", error);
    res.status(500).json({ error: "Sign in failed" });
  }
});

app.get("/verify", async (req, res) => {
  const token = req.query.token as string;

  if (!token) {
    return res.status(402).json({ error: "Token missing" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      email: string;
      userId: string;
    };

    await prisma.user.update({
      where: { email: decoded.email },
      data: { verified: true },
    });

    res.cookie("cookie", token, { httpOnly: true });
    res.send("Email verified successfully!");
  } catch (err) {
    console.error(err);
    res.status(402).json({ error: "Invalid or expired token" });
  }
});

app.post("/trade/create", authenticateToken, async (req, res) => {
  const { asset, type, margin, leverage, slippage }: Order = req.body;
  const userId = req.user.id;
  if (!asset || !margin || !leverage || !slippage || !type) {
    return res.json({
      message: "Please enter all the details to place the order",
    });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.balance < margin) {
    return res.status(400).json({ error: "Insufficient balance" });
  }
  try {
    const streamId = await client.xAdd("trade-requests-stream", "*", {
      asset: asset,
      type: type,
      margin: margin.toString(),
      leverage: leverage.toString(),
      userId: userId,
      slippage: slippage.toString(),
      timestamp: Date.now().toString(),
    });
    res.json({
      message: "Trade request submitted",
      streamId,
      details: { asset, type, margin, leverage, slippage },
    });
  } catch (error) {
    console.log("Trade creation error", error);
  }
});

app.post("/trade/close", authenticateToken, async (req, res) => {
  const { orderId } = req.body;
  const userId = req.user.id;
  if (!orderId) {
    return res.status(400).json({ error: "Order ID required" });
  }
  const streamId = await client.xAdd("trade-close-stream", "*", {
    orderId: orderId,
    userId: userId,
    timestamp: Date.now().toString(),
  });
  res.json({ message: "Close request submitted", streamId, orderId });
});

app.get("/balance", authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    res.json({ balance: user?.balance || 0 });
  } catch (error) {
    console.error("Balance fetch error:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

app.get("/orders/open", authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const ordersHash = await client.hGetAll(`user:${userId}:orders`);
    const orders = Object.entries(ordersHash).map(([orderId, orderData]) => ({
      orderId,
      ...JSON.parse(orderData)
    }));
    res.json({
      message: "Here are open orders",
      orders,
    });
  } catch (error) {
    console.error("Open orders fetch error:", error);
    res.status(500).json({ error: "Failed to fetch open orders" });
  }
});

app.get("/orders/history", authenticateToken, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const trades = await prisma.existingTrade.findMany({
      where: { userId },
      include: {
        asset: {
          select: { symbol: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50, 
    });

    res.json({ trades });
  } catch (error) {
    console.error("Trade history fetch error:", error);
    res.status(500).json({ error: "Failed to fetch trade history" });
  }
});

app.get("/assets", async (req, res) => {
  try {
    const assets = await prisma.asset.findMany({
      select: {
        id: true,
        symbol: true,
        name: true,
        imageUrl: true,
        decimals: true,
      },
    });
    res.json({ assets });
  } catch (error) {
    console.error("Assets fetch error:", error);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

app.listen(3002, () => {
  console.log("Conected to port 3002.");
});
