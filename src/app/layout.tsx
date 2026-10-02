import type { Metadata } from "next";
import { Syne, Inter } from "next/font/google";
import "./globals.css";

/**
 * Syne is the JSX's signature typeface — geometric, slightly condensed.
 * As of v0.40.8 it is the application-wide default. Two CSS variables
 * are exposed:
 *
 *   --font-syne — chat surfaces (chat dock, conversation bubble).
 *                 Full Syne weight range, including bold (700) and
 *                 extra-bold (800). The conversational feel benefits
 *                 from the heavier display weights.
 *
 *   --font-app  — every other studio surface (tool cards, modals,
 *                 top bar, project switcher, etc). Same Syne typeface,
 *                 but the inline `fontWeight` declarations have been
 *                 demoted from 700/800 down to 500 so the dense UI
 *                 chrome reads gracefully — bold Syne in small button
 *                 labels and list items felt cluttered.
 *
 * Both variables resolve to the same Syne font CSS class. The split
 * is conventional, not technical; it gives us a place to add a future
 * weight cap or letter-spacing tweak without touching every component.
 */
const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-syne",
});

/**
 * Inter is loaded but no longer the application default. Studio
 * surfaces previously read `--font-inter` and were migrated to
 * `--font-app` (which resolves to Syne). The Inter variable stays
 * in case any third-party content (e.g. a future MDX import) wants
 * to reference Inter explicitly.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Furnishes Studio",
  description: "Interior-design AI chat over a 3D apartment view.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${inter.variable}`}
      style={{ backgroundColor: "#fff4e3" }}
    >
      <body
        className="h-full w-full antialiased"
        style={{
          // Application default: Syne via --font-app. Chat surfaces
          // opt into the full Syne weight range via --font-syne.
          fontFamily: "var(--font-app), system-ui, sans-serif",
          color: "#1a1a1a",
        }}
      >
        {/* Animated fluid background. Three blurred warm-tone blobs
            drift on independent loops behind every studio surface.
            Sits at z-index: 0 with pointer-events: none so it never
            interferes with the 3D canvas or floating cards. CSS
            handles the entire effect — no JS, no per-frame work in
            the React tree. See globals.css `.bg-fluid` for details. */}
        <div className="bg-fluid" aria-hidden="true">
          <div className="bg-blob bg-blob-1" />
          <div className="bg-blob bg-blob-2" />
          <div className="bg-blob bg-blob-3" />
        </div>
        {children}
      </body>
    </html>
  );
}
