/*
 * Decampify — runtime config.
 * Loaded before all other scripts. Exposes window.MR_CONFIG.
 *
 * MOCK MODE:
 *   mock:true lets the entire site be clicked through with NO Stripe account, NO Cloudflare R2,
 *   and NO uploaded audio files (player uses demo tones; buy flow is simulated client-side).
 *   Flip to false for production once Stripe + R2 are configured and files are uploaded
 *   (full walkthrough in SETUP.md).
 */
window.MR_CONFIG = {
  mock: true, // ← template default. Set to false to go live (see SETUP.md).

  // Serverless endpoints (Vercel functions in /api). Used only when mock:false.
  api: {
    createCheckout: "/api/create-checkout",
    verifyDownload: "/api/verify-download",
    streamUrl: "/api/stream-url"
  },

  // External links — ALL placeholders. Replace each with your real URL,
  // or set to "" to hide that button/link on the site.
  emailFormUrl: "https://example.com/your-mailing-list-form", // ← replace: mailing-list signup (e.g. a Google Form link)
  merchUrl: "https://example.com/your-merch-shop",            // ← replace: merch shop (print-on-demand storefront, etc.)
  bandcampUrl: "https://example.com/your-bandcamp",           // ← replace: your Bandcamp page
  soundcloudUrl: "https://example.com/your-soundcloud",       // ← replace: your SoundCloud page
  spotifyUrl: "https://example.com/your-spotify",             // ← replace: your Spotify artist page
  youtubeUrl: "https://example.com/your-youtube",             // ← replace: a featured YouTube video or channel
  contactEmail: "hello@example.com",                          // ← replace: your contact email

  socials: {
    instagram: "https://example.com/your-instagram",  // ← replace
    soundcloud: "https://example.com/your-soundcloud", // ← replace
    youtube: "https://example.com/your-youtube"        // ← replace
  }
};
