import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ROBIN AI · Your Voice AI Companion",
  description: "Talk to ROBIN — your AI companion. Ask anything in English or Tamil and hear spoken answers in real time.",
  keywords: ["AI assistant", "voice AI", "3D avatar", "speech to text", "text to speech", "GLM"],
  authors: [{ name: "ROBIN AI" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ROBIN AI · Your Voice AI Companion",
    description: "Talk to ROBIN — your AI companion — with your microphone and hear spoken answers.",
    siteName: "ROBIN AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ROBIN AI · Your Voice AI Companion",
    description: "Talk to ROBIN — your AI companion — with your microphone.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
