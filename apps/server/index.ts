import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { PrismaClient } from "./generated/prisma/index.js";
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const prisma = new PrismaClient();
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "123";
app.use(cors());
app.use(express.json());

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

app.get("/verify", async (req, res) => {
  const token = req.query.token as string;

  if (!token) {
    return res.status(400).json({ error: "Token missing" });
  }

  try {
    // Decode & verify JWT
    const decoded = jwt.verify(token, JWT_SECRET) as {email: string; userId: number};

    // Update user as verified
    await prisma.user.update({
      where: { email: decoded.email },
      data: { verified: true },
    });

    res.send("Email verified successfully!");
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid or expired token" });
  }
});

app.listen(3000, () => {
  console.log("Conected to port 3000.");
});
