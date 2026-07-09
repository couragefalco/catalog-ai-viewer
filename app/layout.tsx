import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AnalyticsConsentBanner } from "@/components/analytics-consent-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const DESCRIPTION =
  "Interactive PDF catalog viewer with an AI assistant that grounds every answer and jumps to the exact page and region in the document.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Catalog AI Viewer",
    template: "%s · Catalog AI Viewer",
  },
  description: DESCRIPTION,
  applicationName: "Catalog AI Viewer",
  openGraph: {
    title: "Catalog AI Viewer",
    description: DESCRIPTION,
    siteName: "Catalog AI Viewer",
    type: "website",
    url: SITE_URL,
    images: [
      {
        url: "/og",
        width: 1200,
        height: 630,
        alt: "Catalog AI Viewer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Catalog AI Viewer",
    description: DESCRIPTION,
    images: ["/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} light h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full flex flex-col">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <AnalyticsConsentBanner />
        <Toaster />
      </body>
    </html>
  );
}
