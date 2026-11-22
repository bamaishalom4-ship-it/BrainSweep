/**
 * BrainSweep — Central Configuration (Phase 0 / Phase 1)
 */
window.BRAINSWEEP_CONFIG = {
  brandName: 'BrainSweep',
  legalEntity: 'MadeByKubo',
  creatorName: 'MadeByKubo',
  creatorUrl: 'https://www.instagram.com/madebykubo',
  country: 'Nigeria',
  contactEmail: 'madebykubo@gmail.com',
  siteUrl: 'https://brainsweep-tau.vercel.app',
  leaderboardApiUrl:
    'https://script.google.com/macros/s/AKfycbziXn-4cNUEga8XpnoPAF22gOtCH9cIFaj2HojI1A4Aap_yNzCWkss37ne3U3kEic-A/exec',
  // First public Daily Sweep launch date (Africa/Lagos, YYYY-MM-DD) so the launch day is Daily #1
  dailyLaunchDate: '2026-11-22',
  analytics: {
    provider: 'umami', // 'umami' | 'plausible' | 'posthog' | 'ga4'
    domain: 'brainsweep-tau.vercel.app',
    websiteId: 'fdc1c524-5bc0-4e66-8b38-abc960d146d0',
    scriptUrl: 'https://cloud.umami.is/script.js',
    enabled: true,
  },
  allowedEmbedDomains: [], // Empty = allow all; non-empty = enforce allow-list via referrer/ancestorOrigins
};
