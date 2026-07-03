import type { Metadata } from "next";
import { Inter, Itim, Prompt, Kanit, Sarabun } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const itim = Itim({
  weight: "400",
  variable: "--font-itim",
  subsets: ["thai", "latin"],
});

const promptFont = Prompt({
  weight: ["400", "500", "600", "700"],
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
});

const kanitFont = Kanit({
  weight: ["400", "500", "600", "700"],
  variable: "--font-kanit",
  subsets: ["thai", "latin"],
});

const sarabunFont = Sarabun({
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
});

export const metadata: Metadata = {
  title: "SuperK Manga Translator",
  description: "Seamlessly translate manga with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${itim.variable} ${promptFont.variable} ${kanitFont.variable} ${sarabunFont.variable} h-full antialiased selection:bg-primary/20 selection:text-primary`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
