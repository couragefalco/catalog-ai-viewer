"use client";

import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_UI_HOST = "https://eu.posthog.com";

let initialized = false;

type AnalyticsProps = Record<
  string,
  string | number | boolean | null | undefined
>;

function currentSurface() {
  if (typeof window === "undefined") return "server";
  const host = window.location.hostname;
  if (host === "solutions.igus.de") return "igus-catalog";
  if (host === "app.poase.com") return "poase-app";
  return "local-or-preview";
}

function baseProps(): AnalyticsProps {
  if (typeof window === "undefined") {
    return {
      app: "catalog-ai-viewer",
      surface: "server",
    };
  }

  return {
    app: "catalog-ai-viewer",
    surface: currentSurface(),
    host: window.location.hostname,
    path: window.location.pathname,
    catalog_route_id: getCatalogRouteId(),
    customer_code: getAllowedQueryParam("customer") ?? getAllowedQueryParam("code"),
    link_campaign: getAllowedQueryParam("campaign"),
  };
}

function getCatalogRouteId() {
  if (typeof window === "undefined") return undefined;

  const match = window.location.pathname.match(/\/catalog\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function getAllowedQueryParam(name: string) {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

export function ensurePostHog() {
  if (initialized || typeof window === "undefined" || !POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    api_host: getPostHogApiHost(),
    ui_host: POSTHOG_UI_HOST,
    defaults: "2026-06-25",
    autocapture: true,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_performance: true,
    capture_heatmaps: true,
    capture_dead_clicks: true,
    capture_exceptions: true,
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: {
        password: true,
      },
      maskTextSelector: ".ph-mask",
      blockSelector: ".ph-no-capture",
      collectFonts: true,
      inlineStylesheet: true,
      recordCrossOriginIframes: true,
      full_snapshot_interval_millis: 60_000,
      compress_events: true,
      streamNetworkBody: true,
    },
    person_profiles: "never",
    advanced_disable_flags: false,
    advanced_disable_feature_flags: false,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    opt_out_capturing_persistence_type: "localStorage",
    consent_persistence_name: "catalog_ai_viewer_analytics_consent",
    persistence: "localStorage+cookie",
    cross_subdomain_cookie: false,
    secure_cookie: true,
    disable_capture_url_hashes: true,
    save_referrer: true,
    save_campaign_params: true,
    disableDeviceModel: false,
    disable_scroll_properties: false,
    before_send(event) {
      if (!event) return event;
      event.properties = {
        ...baseProps(),
        ...event.properties,
      };
      return event;
    },
  });
  initialized = true;
}

function getPostHogApiHost() {
  if (typeof window === "undefined") return "/ph";
  return window.location.hostname === "solutions.igus.de" ? "/catalog/ph" : "/ph";
}

export function hasAnalyticsConfigured() {
  return Boolean(POSTHOG_KEY);
}

export function getAnalyticsConsentStatus() {
  ensurePostHog();
  if (!initialized) return "pending";
  return posthog.get_explicit_consent_status();
}

export function acceptAnalytics() {
  ensurePostHog();
  if (!initialized) return;
  posthog.opt_in_capturing();
  posthog.startSessionRecording({
    sampling: true,
    linked_flag: true,
    url_trigger: true,
    event_trigger: true,
  });
  posthog.capture("$pageview");
  track("analytics_consent_granted");
}

export function rejectAnalytics() {
  ensurePostHog();
  if (!initialized) return;
  posthog.stopSessionRecording();
  posthog.opt_out_capturing();
}

export function track(event: string, properties: AnalyticsProps = {}) {
  ensurePostHog();
  if (!initialized || !posthog.has_opted_in_capturing()) return;
  posthog.capture(event, {
    ...baseProps(),
    ...properties,
  });
}
