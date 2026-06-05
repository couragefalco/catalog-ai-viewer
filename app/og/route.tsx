import { ImageResponse } from "next/og";

// Explicit OG image route → served at <basePath>/og. Referenced from metadata
// so link previews resolve to a static social card.
export const runtime = "nodejs";

const ACCENT = "#6366f1";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0b",
          padding: "72px",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "68px",
              height: "68px",
              borderRadius: "16px",
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "44px",
              fontWeight: 800,
              color: "#0a0a0b",
            }}
          >
            ◰
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "32px",
              fontWeight: 700,
              color: ACCENT,
            }}
          >
            Catalog AI Viewer
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              fontSize: "78px",
              fontWeight: 800,
              lineHeight: 1.05,
            }}
          >
            Grounded catalog chat
          </div>
          <div style={{ display: "flex", fontSize: "34px", color: "#a1a1aa" }}>
            Interactive PDF viewer with cited AI answers
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "24px",
            color: "#71717a",
          }}
        >
          <div style={{ display: "flex" }}>PDF viewer</div>
          <div style={{ display: "flex", color: ACCENT }}>•</div>
          <div style={{ display: "flex" }}>Citations with page &amp; region</div>
          <div style={{ display: "flex", color: ACCENT }}>•</div>
          <div style={{ display: "flex" }}>Bring your own PDFs</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
