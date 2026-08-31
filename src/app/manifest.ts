import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SuperK Manga Translator",
    short_name: "SuperK",
    description: "Seamlessly translate manga with AI",
    start_url: "/",
    display: "standalone",
    background_color: "#101010",
    theme_color: "#101010",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
