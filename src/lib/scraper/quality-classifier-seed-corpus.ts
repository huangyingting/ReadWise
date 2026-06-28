/**
 * Hand-curated SEED corpus for the local Naive-Bayes ad/article quality
 * classifier (Issue #739 follow-up).
 *
 * These are the original, stable, manually written bootstrap samples. They are
 * the authoritative "ground truth" seeds that `scripts/build-quality-corpus.ts`
 * always keeps when it regenerates the expanded
 * `quality-classifier-corpus.ts`. Never overwrite this file from the harvester —
 * edit it by hand only.
 *
 * @server-only — only consumed by the corpus builder, training script, and the
 * (server-only) classifier module. Contains NO user-private content; all
 * samples are synthetic, representative public-style text.
 *
 * PRIVACY / COPYRIGHT: never add real scraped article bodies or any user
 * content here. Live-harvested excerpts live in the generated corpus file.
 */

/** Genuine article prose samples (varied topics, real-sentence structure). */
export const SEED_ARTICLE_SAMPLES: readonly string[] = [
  "The city council voted on Tuesday to approve a new plan for the downtown district, citing growing demand for affordable housing near the transit line.",
  "Researchers at the university have spent the past decade studying how migratory birds adapt to shifting weather patterns along the northern coast.",
  "According to the report released this week, the number of visitors to the national park has grown steadily since the trails were reopened last spring.",
  "Many residents say they are pleased with the improvements made to the riverside park, though some worry about the cost of maintaining the new gardens.",
  "Officials noted that the bridge project would not have been possible without years of careful planning and the support of several local communities.",
  "The author explains how a small team of engineers managed to finish the prototype months ahead of schedule despite a series of unexpected setbacks.",
  "In the early morning, commuters gather near the old station to wait for the first train, watching as the fog slowly lifts over the quiet harbor.",
  "She argued in her latest essay that the most durable solution to traffic congestion is to invest in reliable, frequent, and affordable public transit.",
  "The new exhibit traces the history of the printing press and shows how cheaper books gradually changed the way ordinary people learned to read.",
  "Economists warned that rising interest rates could slow the housing market, but they also pointed to strong job growth as a reason for cautious optimism.",
  "When the storm finally passed, volunteers spent the weekend clearing debris from the streets and helping their neighbors repair damaged roofs and fences.",
  "The documentary follows three farmers as they experiment with new irrigation methods designed to use far less water during the long, dry summer months.",
  "Doctors at the clinic have noticed that patients who walk for thirty minutes each day tend to recover more quickly after routine surgical procedures.",
  "The committee spent several hours debating whether the historic theater should be restored to its original design or adapted for modern performances.",
  "Astronomers believe the faint signal came from a distant galaxy, and they plan to point the telescope at the same region again later this year.",
  "After the election, the mayor promised to focus on schools, arguing that smaller class sizes would give teachers more time to support each student.",
  "The chef described how she learned to cook from her grandmother, who insisted that patience and fresh ingredients mattered more than any fancy technique.",
  "Engineers tested the new bridge for several weeks, gradually increasing the load until they were confident it could safely carry heavy traffic.",
  "The novel is set in a small fishing village where the arrival of a stranger slowly reveals the long-buried secrets that bind the residents together.",
  "Scientists discovered a new species of deep-sea fish during the expedition, noting that it appears to thrive in waters far colder than expected.",
  "The teacher explained that learning a second language takes time, and she encouraged her students to practice a little every day rather than cramming.",
  "Local farmers brought their harvest to the market early on Saturday, and by noon the stalls were crowded with families buying vegetables and fresh bread.",
  "The report found that cycling to work has become more popular in the city, partly because new protected lanes have made the journey feel much safer.",
  "Historians have long debated the causes of the conflict, but most agree that a combination of economic pressure and poor harvests played a major role.",
  "The orchestra rehearsed the symphony for months, and on opening night the audience rose to its feet as the final notes faded into a long silence.",
  "Volunteers planted hundreds of young trees along the hillside, hoping that within a few years the new forest would help prevent further soil erosion.",
  "The journalist interviewed dozens of workers at the factory, piecing together a detailed account of how the company managed the difficult transition.",
  "Although the museum is small, its collection of old maps draws scholars from around the world who come to study how the coastline has changed over time.",
  "The startup spent two years refining its software before launching, and the founders say that the slow, careful approach helped them avoid costly mistakes.",
  "Park rangers remind hikers to carry plenty of water and to start early, because temperatures on the exposed ridge can climb quickly by the afternoon.",
  "The study followed a group of students for four years and found that those who slept well consistently performed better on a range of academic tasks.",
  "After the renovation, the library added a quiet reading room on the second floor, and it has quickly become a favorite spot for students and retirees alike.",
  "The biologist explained that coral reefs support an astonishing variety of life, and that even a small rise in water temperature can disrupt the balance.",
  "Residents gathered at the town hall to discuss the proposed road, and after a long meeting they agreed to ask the council for an independent review.",
  "The film tells the story of a young pianist who leaves her village for the city, where she must balance her ambitions against the demands of daily life.",
  "Researchers say the new battery could store energy more efficiently, though they caution that it may take years before the technology reaches the market.",
  "The gardener described how she rescued the neglected plot, slowly enriching the soil and replacing the weeds with herbs, flowers, and climbing beans.",
  "On a clear night the old lighthouse can be seen for miles, and for generations it has guided fishing boats safely back through the narrow harbor channel.",
];

/** Ad / junk / navigation / boilerplate samples (non-article copy). */
export const SEED_AD_SAMPLES: readonly string[] = [
  "Subscribe now to our newsletter and save 50% off your first order today. Limited time offer, do not miss out, sign up before the deal ends tonight.",
  "Buy now! Shop now for the best deals of the season. Click here to claim your exclusive coupon and enjoy free shipping on every order over twenty dollars.",
  "Sign up today and get 20% off your first purchase. Enter your email to unlock special offers, flash sales, and members-only discounts delivered weekly.",
  "Sponsored. Advertisement. This product is endorsed by leading experts. Order now and receive a free gift while supplies last. Act fast before stock runs out.",
  "Home About Contact News Sports Weather Login Sign up Menu Search Shop Deals More Help Terms Privacy Jobs Press Blog Video Newsletter Careers Sitemap",
  "We use cookies to improve your experience. By clicking accept you agree to our cookie policy and the storing of cookies on your device. Manage preferences here.",
  "Limited time deal! Up to 70% off clearance. Lowest prices guaranteed. Shop now and save big. Use promo code SAVE at checkout for an extra discount today.",
  "Hot singles in your area want to chat now. Click here to start. Free trial available. No credit card required. Meet new people tonight, sign up instantly.",
  "Best deal ever! Best deal ever! Buy now buy now buy now. Click here click here. Sale sale sale. Limited time only. Order today and save, do not wait.",
  "For sale: used sedan, low mileage, one owner, clean title, runs great, asking $4,500 or best offer. Call now. Cash only. Serious buyers contact today.",
  "Get rich quick working from home. Earn thousands per week with this one simple trick. No experience needed. Sign up now and start earning money today.",
  "Download our app now. Available on the app store and on google play. Rate us five stars. Share with friends. Follow us on social media for daily updates.",
  "Flash sale ends in 2 hours. Don't miss these unbeatable prices. Shop electronics, fashion, home goods and more. Free returns. Buy now, pay later available.",
  "Your free trial is about to expire. Upgrade to premium today to keep all your features. Plans start at just $9.99 per month. Subscribe now to continue.",
  "Click here to win a brand new phone. You are our lucky visitor today. Claim your prize now. Enter your details to confirm. Offer valid for the next 5 minutes.",
  "Advertise with us. Reach millions of customers. Affordable packages available. Contact our sales team today. Boost your brand and grow your business fast.",
  "Cookies, privacy policy, terms of service, do not sell my personal information, manage consent, accept all, reject all, cookie settings, preferences center.",
  "Trending now: top 10 gadgets you need, best deals under $50, must-have kitchen tools, hottest fashion picks, sponsored content, you may also like, read more.",
  "Save now! Huge clearance event. Everything must go. Prices slashed. Shop now before it's gone. Free gift with every purchase. Limited stock, hurry today.",
  "Newsletter signup: enter your email address to receive our latest offers, promotions, and discount codes straight to your inbox. Unsubscribe at any time.",
  "Order now and get free shipping plus a money back guarantee. Thousands of happy customers. Five star reviews. The best product on the market, buy today.",
  "Casino bonus: deposit $10 and play with $50. Spin to win big jackpots tonight. Join now. Terms apply. Gamble responsibly. Sign up and claim your bonus instantly.",
  "Refinance your mortgage and lower your monthly payment. Rates are at historic lows. Apply now in minutes. No obligation quote. Check your eligibility today.",
  "Follow Like Share Subscribe Comment Tweet Pin Email Print Save More Tags Related Posts Popular Now Sponsored Links Around the Web Recommended For You",
  "Special promotion! Buy one get one free on all items this weekend only. Use code BOGO at checkout. While supplies last. Shop in store or online now.",
  "This page contains affiliate links. As an associate we earn from qualifying purchases. Prices and availability are subject to change. Shop our top picks now.",
  "Win a free vacation! Just complete this short survey to qualify. Limited spots available. Click continue to claim. Enter now, winners announced daily, sign up.",
  "Premium membership: unlock unlimited access for only $4.99 a month. Cancel anytime. No hidden fees. Start your subscription today and read without limits.",
  "Lose weight fast with this amazing supplement. Doctors hate this simple trick. Order your bottle now and get two free. Money back guarantee, buy today.",
  "Skip to content, main menu, search the site, log in, register, my account, shopping cart, wish list, checkout, customer service, returns, shipping info.",
  "Don't miss our biggest sale of the year. Doorbuster deals start at midnight. Shop early for the best selection. Free gift wrapping. Order now and save big.",
  "Get the latest news delivered to your phone. Turn on notifications. Allow alerts to stay informed. Tap allow to continue. Manage your settings at any time.",
  "Coupons, promo codes, cashback offers, daily deals, price drops, lightning deals, flash sales, clearance, bargains, discounts, vouchers, special offers.",
  "Upgrade your plan to remove ads and unlock exclusive content. Limited time pricing. Subscribe now and save. Join thousands of satisfied premium members today.",
  "Free shipping on orders over $25. Shop now. New arrivals daily. Trending styles. Bestsellers. Sale section. Gift cards available. Refer a friend and earn rewards.",
  "Act now! This offer expires soon. Call within the next ten minutes to receive a second one absolutely free. Just pay separate shipping and handling fees.",
  "By continuing to browse this site you accept the use of cookies. We and our partners process data to personalize ads and content. Accept, reject, or customize.",
  "Earn points with every purchase and redeem them for discounts. Join our rewards program free. Sign up in seconds. Start saving on your next order right now.",
];
