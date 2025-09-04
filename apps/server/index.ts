import cors from "cors";
import { createClient } from "redis";
import { v4 as uuid } from "uuid";
import express from "express";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import nodemailer from "nodemailer";
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
const JWT_SECRET = process.env.JWT_SECRET || "123";
app.use(
  cors({
    origin: ["http://localhost:3000"],
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
      <h2>Welcome!</h2>
      <p>Click below to verify your email:</p>
      <a href="${link}">${link}</a>
    `,
  });
};

app.post("/register", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.json({ error: "Not Found" });
  }
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, verified: false },
  });
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET as string,
    {
      expiresIn: "15m",
    },
  );
  const link = `http://localhost:3000/verify?token=${token}`;

  await sendMail(email, link);
  res.json({ message: "Verification email sent" });
});

app.post("/signin", async (req: any, res) => {
  const token = req.headers.authorization.split("")[1];
  if (!token) {
    res.json({ error: "Not Authorized" });
  }
  res.json({ message: "Here are the user Details" });
});

app.get("/verify", async (req, res) => {
  const token = req.query.token as string;

  if (!token) {
    return res.status(400).json({ error: "Token missing" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      email: string;
      userId: number;
    };

    await prisma.user.update({
      where: { email: decoded.email },
      data: { verified: true },
    });

    res.cookie("cookie", token, { httpOnly: true });
    res.send("Email verified successfully!");
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid or expired token" });
  }
});

app.post("/trade/create", async (req, res) => {
  const { asset, type, margin, leverage, slippage }: Order = req.body;
  if (!asset || margin || !leverage || !slippage) {
    return res.json({
      message: "Please enter all the details to place the order",
    });
  }
  try {
    const id = await client.xAdd("trade-stream", "*", {
      asset: asset,
      type: type,
      margin: margin.toString(),
      leverage: leverage.toString(),
      slippage: slippage.toString(),
    });
    res.json({ message: "Added to stream", id });
  } catch (error) {
    console.log("Error while adding to stream", error);
  }
});

app.listen(3000, () => {
  console.log("Conected to port 3000.");
});
