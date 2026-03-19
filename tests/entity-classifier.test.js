const assert = require('assert');
const {
  analyzeWebsiteDiscoverySignals,
  buildRadarPromotionDecision,
  classifyLeadEntity,
  classifyMentionSource,
  detectEntityType,
  extractOfficialEcosystemDirectoryItems,
  extractProjectName,
  isDexBucketCandidate,
  isEcosystemBucketCandidate,
  hasProjectIdentityAnchor,
  extractLooseCandidateName,
  extractWebsiteScanLinks,
  isFundraisingBucketCandidate,
  isUsefulXListItem,
  isRelevantMentionForProject,
  parseCryptoRankFundingPage,
  retainRadarProjects,
  shouldDisplayInRadarPool,
  sortProjectsForAction
} = require('../lib/engine');

const config = {
  weights: {
    funding: 3,
    compliance: 3,
    hongKong: 3,
    asia: 2,
    institutional: 2,
    listing: 3,
    exchange: 1,
    hiring: 2,
    rwa: 2,
    stablecoin: 2,
    custody: 2
  }
};

const internalRules = {
  thresholds: {
    minTvlUsd: 5000000,
    minMarketCapUsd: 30000000,
    minDailyVolumeUsd: 500000,
    minDexLiquidityUsd: 1000000
  }
};

const profileList = [
  {
    name: 'Ethena',
    symbol: 'ENA',
    screening: {
      tvlUsd: 7312000000,
      marketCapUsd: 886260000,
      dailyVolumeUsd: 89630000,
      dexLiquidityUsd: 20460000,
      complianceSignals: ['Institutional custody stack'],
      strategicFit: ['Stablecoin infrastructure'],
      passes: true
    }
  }
];

function runCase(title, description) {
  return classifyLeadEntity(
    { title, description, source: 'Test', link: 'https://example.com' },
    profileList,
    config,
    internalRules
  );
}

const rejectCases = [
  ['Consensus Hong Kong', 'Hong Kong crypto conference week agenda'],
  ['BTC', 'bitcoin market update'],
  ['XRP', 'xrp listing outlook'],
  ['The Open Network', 'strategic investment in TON ecosystem'],
  ['Bitcoin Network', 'USDT payments expand on Bitcoin network'],
  ['Chainlink Oracle Network', 'oracle network expands ecosystem integrations'],
  ['0x1234abcd', 'wallet received funds'],
  ['Interactive Brokers', 'brokers launch crypto trading access'],
  ['StanChart', 'bank joins Hong Kong stablecoin license batch']
];

rejectCases.forEach(([title, description]) => {
  const result = runCase(title, description);
  assert.strictEqual(result.allow, false, `${title} should be rejected`);
});

const mantraReject = runCase('MANTRA', 'token update with no clear compliance or Hong Kong signals');
assert.strictEqual(mantraReject.allow, false, 'MANTRA should reject when evidence is insufficient');

const mantraAllow = runCase(
  'MANTRA',
  'RWA protocol expands in Hong Kong with regulated institutional tokenized asset partnerships and compliance-first market access'
);
assert.strictEqual(mantraAllow.allow, true, 'MANTRA should allow if evidence is sufficient');

assert.strictEqual(
  detectEntityType(
    'Perle Foundation',
    {
      title: 'Perle Foundation supports the development of sovereign, human-verified data infrastructure for AI',
      description: 'The Perle Labs ecosystem is building developer infrastructure and verified data rails for blockchain use cases.'
    }
  ),
  'project',
  'foundation-branded crypto projects should not be auto-rejected as organizations when project context is clear'
);

assert.strictEqual(
  detectEntityType(
    'Pantera Capital',
    {
      title: 'Pantera Capital led the round',
      description: 'The venture capital firm invested in the project.'
    }
  ),
  'organization',
  'investor organizations should still remain classified as organizations'
);

assert.strictEqual(
  extractLooseCandidateName("Mountain Protocol's USDM Quietly Becomes Largest Treasury-Backed Stablecoin", ''),
  'Mountain Protocol',
  'loose extractor should preserve Mountain Protocol'
);

assert.strictEqual(
  extractLooseCandidateName('Cryptodollar Minting Protocol M^0 Will Allow Institutions to Issue Stablecoins', ''),
  'Cryptodollar Minting Protocol',
  'loose extractor should preserve Cryptodollar Minting Protocol'
);

assert.notStrictEqual(
  extractLooseCandidateName('How Sui Protocol and rcUSD Are Revolutionizing Blockchain with RWA-Backed Tokens - OKX', ''),
  'How Sui Protocol',
  'loose extractor should not preserve question-style title prefixes'
);

assert.strictEqual(
  extractProjectName('Agents, meet Earn. The new okx-cex-earn Skill on Agent Trade Kit gives your agent access...', ''),
  'Unknown Project',
  'generic X marketing copy should not resolve to Agents'
);

assert.strictEqual(
  isUsefulXListItem({
    title: 'NEW: Evernorth Holdings files Form S-4 with SEC to list on Nasdaq under ticker $XRPN via SPAC merger.',
    description: 'The billion-dollar XRP treasury vehicle will actively deploy capital to DeFi, lending, and validator participation.',
    creator: '@CoinDesk'
  }),
  true,
  'signal-rich X list items should pass feed filtering'
);

assert.strictEqual(
  isUsefulXListItem({
    title: 'Good morning. Today is going to be a great day. Let’s get after it relentlessly.',
    description: '',
    creator: '@APompliano'
  }),
  false,
  'generic commentary should be filtered out from X list RSS'
);

assert.strictEqual(
  hasProjectIdentityAnchor({
    website: '',
    twitter: '',
    contact: null,
    secondaryContact: null,
    liveSignals: { website: { siteUrl: '', telegramLinks: [] }, rootdata: { website: '' } }
  }),
  false,
  'projects without website/twitter/telegram identity anchors should be filtered out'
);

assert.strictEqual(
  hasProjectIdentityAnchor({
    website: '',
    twitter: '',
    contact: null,
    secondaryContact: null,
    liveSignals: { website: { siteUrl: '', telegramLinks: ['https://t.me/example'] }, rootdata: { website: '' } }
  }),
  true,
  'telegram link should count as an identity anchor'
);

const retainedRadar = retainRadarProjects(
  [],
  [
    {
      name: 'Quai Network',
      score: 18,
      latestSeenAt: '2024-08-29T00:00:00.000Z'
    }
  ],
  {
    previousGeneratedAt: '2026-03-18T09:00:00.000Z',
    currentGeneratedAt: '2026-03-19T09:00:00.000Z',
    retentionDays: 10
  }
);

assert.strictEqual(
  retainedRadar.length,
  1,
  'radar retention should use the previous payload timestamp, not only stale mention dates'
);

assert.strictEqual(
  retainedRadar[0].radarRetainedAt,
  '2026-03-18T09:00:00.000Z',
  'retained radar projects should carry forward a retention timestamp'
);

assert.strictEqual(
  shouldDisplayInRadarPool({ score: 15 }),
  true,
  'radar pool should keep stronger categorized projects'
);

assert.strictEqual(
  shouldDisplayInRadarPool({ score: 14 }),
  false,
  'weaker categorized projects should fall back into Watch Radar instead of duplicating pools'
);

assert.strictEqual(
  isRelevantMentionForProject(
    {
      title: 'Tune in now! @TripleVodkaSoda is talking all things Plume, real-world yield and what’s next for RWAs',
      link: 'https://twitter.com/plumenetwork/status/2032503829049258160',
      source: 'Twitter'
    },
    { name: 'Plume', symbol: 'PLUME' },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org', symbol: 'PLUME' }
  ),
  true,
  'official Plume tweet should be considered relevant'
);

assert.strictEqual(
  isRelevantMentionForProject(
    {
      title: 'A plume of smoke was seen over the city as tensions escalated',
      link: 'https://twitter.com/foxnews/status/2033562441833955451',
      source: 'Twitter'
    },
    { name: 'Plume', symbol: 'PLUME' },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org', symbol: 'PLUME' }
  ),
  false,
  'generic fox news plume mention should be rejected'
);

assert.strictEqual(
  classifyMentionSource(
    {
      title: 'Tune in now! @TripleVodkaSoda is talking all things Plume',
      link: 'https://twitter.com/plumenetwork/status/2032503829049258160',
      source: 'Twitter'
    },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org' }
  ).tier,
  'official',
  'official project source should rank as official'
);

assert.strictEqual(
  classifyMentionSource(
    {
      title: 'RWA News: Plume expands institutional yield',
      link: 'https://www.coindesk.com/markets/2026/03/17/plume-expands/',
      source: 'CoinDesk'
    },
    { twitter: 'https://twitter.com/plumenetwork', website: 'https://plume.org' }
  ).tier,
  'crypto_media',
  'crypto native media should rank above general media'
);

const websiteDiscovery = analyzeWebsiteDiscoverySignals(
  'Developer docs are live. Explore the ecosystem grants portal and builder program before mainnet launch.'
);
assert.deepStrictEqual(
  websiteDiscovery.hits,
  ['docs', 'developer', 'ecosystem', 'grants', 'mainnet'],
  'website signal analyzer should capture docs, ecosystem, grants and launch hints'
);

assert.deepStrictEqual(
  extractWebsiteScanLinks(
    `
      <a href="/blog">Blog</a>
      <a href="https://example.com/docs">Docs</a>
      <a href="https://example.com/ecosystem">Ecosystem</a>
      <a href="https://othersite.com/grants">External</a>
      <a href="/assets/logo.svg">Logo</a>
    `,
    'https://example.com'
  ),
  [
    'https://example.com/blog',
    'https://example.com/docs',
    'https://example.com/ecosystem'
  ],
  'website scan link extractor should keep only same-host discovery pages'
);

const officialDirectoryItems = extractOfficialEcosystemDirectoryItems(
  `
    <a href="/ecosystem">Ecosystem</a>
    <a href="https://x.com/aptos">X/Twitter Latest news, launches, and ecosystem updates</a>
    <a href="https://aptos.dev/">Dev Docs Technical documentation for building on Aptos</a>
    <a href="https://geomi.dev/">Geomi Create APIs, onboard users, and design NFT flows</a>
    <a href="https://unionchain.io">Union Chain unionchain.io Powering the Future of Onchain Finance</a>
  `,
  {
    name: 'Aptos Ecosystem Directory',
    network: 'Aptos',
    url: 'https://www.aptosfoundation.org/ecosystem/directory',
    group: 'ecosystem',
    maxItems: 5
  }
);

assert.deepStrictEqual(
  officialDirectoryItems.map((item) => item.title),
  [
    'Geomi joins Aptos ecosystem',
    'Union Chain joins Aptos ecosystem'
  ],
  'official ecosystem directory extractor should keep external project entries and drop social/docs links'
);

const parsedFundingRounds = parseCryptoRankFundingPage(`
  <script id="__NEXT_DATA__" type="application/json">
    ${JSON.stringify({
      props: {
        pageProps: {
          coinTokenSales: {
            rounds: [
              {
                kind: 'FundingRound',
                date: '2025-10-01T00:00:00.000Z',
                raise: 30000000,
                valuation: null,
                type: 'STRATEGIC',
                linkToAnnouncement: 'https://x.com/example/status/1',
                investors: {
                  tier1: [],
                  tier2: [{ name: 'MEXC Ventures', slug: 'mexc-ventures', category: 'Venture', tier: 2 }]
                },
                isHidden: false,
                isAuthProtected: false
              },
              {
                kind: 'Launchpool',
                startTime: '2024-07-01T00:00:00.000Z'
              }
            ]
          }
        }
      }
    })}
  </script>
`);

assert.strictEqual(parsedFundingRounds.length, 1, 'funding page parser should keep only funding rounds');
assert.strictEqual(parsedFundingRounds[0].roundStage, 'STRATEGIC', 'funding page parser should preserve round stage');
assert.strictEqual(parsedFundingRounds[0].announcedAt, '2025-10-01T00:00:00.000Z', 'funding page parser should preserve announcedAt');
assert.deepStrictEqual(
  parsedFundingRounds[0].investors.map((item) => item.name),
  ['MEXC Ventures'],
  'funding page parser should flatten investors across tiers'
);

assert.strictEqual(
  isFundraisingBucketCandidate(
    { name: 'Binance Labs' },
    'Binance Labs joined the round as lead investor in a crypto startup funding event'
  ),
  false,
  'fundraising bucket should reject investor entities'
);

assert.strictEqual(
  isFundraisingBucketCandidate(
    { name: 'Stripe' },
    'Stripe expands global payments business with no clear crypto protocol identity'
  ),
  false,
  'fundraising bucket should reject generic payment companies'
);

assert.strictEqual(
  isFundraisingBucketCandidate(
    { name: 'Quai Network' },
    'Quai Network raises funding for its blockchain mainnet ecosystem and developer rollout'
  ),
  true,
  'fundraising bucket should keep actual crypto projects'
);

assert.strictEqual(
  isDexBucketCandidate(
    { name: 'Base DeFi' },
    'Base DeFi ecosystem has new liquidity and trading activity'
  ),
  false,
  'dex bucket should reject generic ecosystem labels'
);

assert.strictEqual(
  isDexBucketCandidate(
    { name: 'Vertex Protocol' },
    'Vertex Protocol launches perp dex liquidity and orderbook trading onchain'
  ),
  true,
  'dex bucket should keep actual dex protocols'
);

assert.strictEqual(
  isEcosystemBucketCandidate(
    { name: 'BNB Chain' },
    'BNB Chain ecosystem builder grants expand across the network'
  ),
  false,
  'ecosystem bucket should reject major chain aliases'
);

assert.strictEqual(
  isEcosystemBucketCandidate(
    { name: 'Pocket Network' },
    'Pocket Network expands developer docs, builder grants and ecosystem integrations'
  ),
  true,
  'ecosystem bucket should keep actual ecosystem projects'
);

const manualPromotion = buildRadarPromotionDecision({
  radarBucket: 'ecosystem',
  score: 12,
  workflow: { manualPromote: true, shouldSuppress: false, keepInRadar: false, owner: 'BD' },
  liveSignals: {}
});
assert.strictEqual(manualPromotion.promote, true, 'manual review outcome should promote radar project');
assert.strictEqual(manualPromotion.mode, 'manual', 'manual review outcome should mark manual promotion mode');

const fundraisingPromotion = buildRadarPromotionDecision({
  radarBucket: 'fundraising',
  score: 15,
  workflow: { shouldSuppress: false, keepInRadar: false },
  fundraising: {
    latestRound: { roundStage: 'SEED' }
  },
  liveSignals: {}
});
assert.strictEqual(fundraisingPromotion.promote, true, 'confirmed funding round should promote fundraising radar project');

const sortedProjects = sortProjectsForAction([
  {
    name: 'Project B',
    score: 15,
    priorityBand: 'Medium',
    freshness: 'repeat',
    latestSeenAt: '2026-03-01T00:00:00.000Z',
    workflow: { owner: '', nextFollowUpAt: '', shouldSuppress: false }
  },
  {
    name: 'Project A',
    score: 14,
    priorityBand: 'Medium',
    freshness: 'new',
    promotedFromRadar: 'fundraising',
    latestSeenAt: '2026-03-02T00:00:00.000Z',
    workflow: { owner: 'Alice', nextFollowUpAt: '2026-03-20', shouldSuppress: false }
  }
]);
assert.strictEqual(sortedProjects[0].name, 'Project A', 'action sorting should prioritize promoted and assigned fresh projects');

process.stdout.write('entity-classifier tests passed\n');
