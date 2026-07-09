"use client";

import { useEffect, useState } from "react";
import {
  acceptAnalytics,
  getAnalyticsConsentStatus,
  hasAnalyticsConfigured,
  rejectAnalytics,
} from "@/lib/analytics";

export function AnalyticsConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasAnalyticsConfigured()) return;
    const timeout = window.setTimeout(() => {
      setVisible(getAnalyticsConsentStatus() === "pending");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-lg border bg-background p-4 shadow-2xl sm:bottom-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Analyse dieses Katalogs</p>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            Wir nutzen PostHog, um zu verstehen, wie dieser digitale Katalog
            verwendet wird. Mit deiner Zustimmung erfassen wir Seitenaufrufe,
            Klicks, Scrolltiefe, Session-Replays, geöffnete Kataloge,
            technische Fehler, Browser- und Gerätedaten, Inhalte deiner
            Chatfragen, Quellenklicks und PDF-Downloads. So können Katalog und
            Beratung verbessert werden. Du kannst den Katalog auch ohne Analyse
            nutzen.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:w-44">
          <button
            type="button"
            onClick={() => {
              acceptAnalytics();
              setVisible(false);
            }}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Analyse akzeptieren
          </button>
          <button
            type="button"
            onClick={() => {
              rejectAnalytics();
              setVisible(false);
            }}
            className="rounded-md border px-3 py-2 text-sm font-medium"
          >
            Nur notwendige
          </button>
        </div>
      </div>
    </div>
  );
}
