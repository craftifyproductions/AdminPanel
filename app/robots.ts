import type { MetadataRoute } from "next";

/** AI / search crawlers that should be denied explicitly (in addition to User-agent: *). */
const BLOCKED_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "Googlebot",
  "Googlebot-Image",
  "Bingbot",
  "anthropic-ai",
  "ClaudeBot",
  "Claude-Web",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Diffbot",
  "FacebookBot",
  "meta-externalagent",
  "PerplexityBot",
  "Applebot-Extended",
  "Applebot",
  "Amazonbot",
  "PetalBot",
  "YouBot",
  "Omgilibot",
  "Omgili",
  "ImagesiftBot",
  "Webz.io",
  "TurnitinBot",
  "Timpibot",
  "Ai2Bot",
  "AI2Bot",
  "Scrapy",
  "ia_archiver",
  "archive.org_bot",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
      ...BLOCKED_BOTS.map((userAgent) => ({
        userAgent,
        disallow: "/",
      })),
    ],
  };
}
