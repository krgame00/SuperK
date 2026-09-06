import type { Metadata, Viewport } from "next";
import { Inter, Itim, Prompt, Kanit, Sarabun, Mitr, Chakra_Petch } from "next/font/google";
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

// Offered in SettingsModal for bubble text — must be loaded or the canvas
// overlay renders the generic fallback instead of the selected family.
const mitrFont = Mitr({
  weight: ["400", "500", "600", "700"],
  variable: "--font-mitr",
  subsets: ["thai", "latin"],
});

const chakraPetchFont = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra-petch",
  subsets: ["thai", "latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#101010",
};

export const metadata: Metadata = {
  title: "SuperK Manga Translator",
  description: "Seamlessly translate manga with AI",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${itim.variable} ${promptFont.variable} ${kanitFont.variable} ${sarabunFont.variable} ${mitrFont.variable} ${chakraPetchFont.variable} h-full antialiased selection:bg-primary/20 selection:text-primary`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
