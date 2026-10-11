import type { Metadata, Viewport } from "next";
import {
  Inter,
  Itim,
  Mali,
  Sriracha,
  Charm,
  Pattaya,
  Mitr,
  Kodchasan,
  Kanit,
  Prompt,
  Bai_Jamjuree,
  IBM_Plex_Sans_Thai,
  Chakra_Petch,
  K2D,
  Chonburi,
  Sarabun,
  Pridi,
} from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const itim = Itim({
  weight: "400",
  variable: "--font-itim",
  subsets: ["thai", "latin"],
  display: "swap",
});

const maliFont = Mali({
  weight: ["400", "600", "700"],
  variable: "--font-mali",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const srirachaFont = Sriracha({
  weight: "400",
  variable: "--font-sriracha",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const charmFont = Charm({
  weight: ["400", "700"],
  variable: "--font-charm",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const pattayaFont = Pattaya({
  weight: "400",
  variable: "--font-pattaya",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const promptFont = Prompt({
  weight: ["400", "500", "600", "700"],
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const kanitFont = Kanit({
  weight: ["400", "500", "600", "700"],
  variable: "--font-kanit",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const kodchasanFont = Kodchasan({
  weight: ["400", "600", "700"],
  variable: "--font-kodchasan",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const baiJamjureeFont = Bai_Jamjuree({
  weight: ["400", "600", "700"],
  variable: "--font-bai-jamjuree",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const ibmPlexSansThaiFont = IBM_Plex_Sans_Thai({
  weight: ["400", "600", "700"],
  variable: "--font-ibm-plex-sans-thai",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const sarabunFont = Sarabun({
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const pridiFont = Pridi({
  weight: ["400", "600", "700"],
  variable: "--font-pridi",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

// Offered in SettingsModal for bubble text — must be loaded or the canvas
// overlay renders the generic fallback instead of the selected family.
const mitrFont = Mitr({
  weight: ["400", "500", "600", "700"],
  variable: "--font-mitr",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const chakraPetchFont = Chakra_Petch({
  weight: ["400", "500", "600", "700"],
  variable: "--font-chakra-petch",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const k2dFont = K2D({
  weight: ["400", "600", "700"],
  variable: "--font-k2d",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
});

const chonburiFont = Chonburi({
  weight: "400",
  variable: "--font-chonburi",
  subsets: ["thai", "latin"],
  display: "swap",
  preload: false,
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

const FONT_VARIABLES = [
  inter.variable,
  itim.variable,
  maliFont.variable,
  srirachaFont.variable,
  charmFont.variable,
  pattayaFont.variable,
  promptFont.variable,
  kanitFont.variable,
  kodchasanFont.variable,
  baiJamjureeFont.variable,
  ibmPlexSansThaiFont.variable,
  sarabunFont.variable,
  pridiFont.variable,
  mitrFont.variable,
  chakraPetchFont.variable,
  k2dFont.variable,
  chonburiFont.variable,
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${FONT_VARIABLES} h-full antialiased selection:bg-primary/20 selection:text-primary`}
    >
      <body className="min-h-full flex flex-col">
        <script
          id="pwa-cache-cleaner"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  for (var r of regs) { r.unregister(); }
                });
              }
              if (typeof window !== 'undefined' && 'caches' in window) {
                caches.keys().then(function(keys) {
                  for (var k of keys) { caches.delete(k); }
                });
              }
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
