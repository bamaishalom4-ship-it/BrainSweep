/**
 * BrainSweep — Central Configuration (Phase 0)
 */
window.BRAINSWEEP_CONFIG = {
  brandName: 'BrainSweep',
  legalEntity: 'BrainSweep',
  country: 'Nigeria',
  contactEmail: 'madebykubo@gmail.com',
  siteUrl: 'https://brainsweep-tau.vercel.app',
  leaderboardApiUrl:
    'https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec',
  dailyLaunchDate: '2026-11-01', // YYYY-MM-DD in Africa/Lagos
  analytics: {
    provider: 'umami', // 'umami' | 'plausible' | 'posthog' | 'ga4'
    domain: 'brainsweep-tau.vercel.app',
    websiteId: 'fdc1c524-5bc0-4e66-8b38-abc960d146d0',
    scriptUrl: 'https://cloud.umami.is/script.js',
    enabled: true,
  },
  allowedEmbedDomains: [], // Empty = allow all but log 'embed_unlicensed_domain'; non-empty = enforce allow-list
};
