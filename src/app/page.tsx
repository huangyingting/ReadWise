import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { LandingHeroSection } from "@/components/marketing/LandingHeroSection";
import { LandingSourcesSection } from "@/components/marketing/LandingSourcesSection";
import { LandingFeaturesSection } from "@/components/marketing/LandingFeaturesSection";
import { LandingHowItWorksSection } from "@/components/marketing/LandingHowItWorksSection";
import { LandingCefrSection } from "@/components/marketing/LandingCefrSection";
import { LandingCtaSection } from "@/components/marketing/LandingCtaSection";
import { landing } from "@/lib/copy/pages";

export const metadata: Metadata = landing;

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const signedIn = Boolean(session?.user);

  const primaryHref = signedIn ? "/dashboard" : "/signin";
  const primaryLabel = signedIn ? (
    <>Continue Reading <span aria-hidden="true">→</span></>
  ) : "Get Started — It's Free";

  return (
    <>
      <MarketingHeader signedIn={signedIn} />

      <main id="main-content">
        <LandingHeroSection
          primaryHref={primaryHref}
          primaryLabel={primaryLabel}
          signedIn={signedIn}
        />
        <LandingSourcesSection />
        <LandingFeaturesSection />
        <LandingHowItWorksSection />
        <LandingCefrSection />
        <LandingCtaSection primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>

      <MarketingFooter />
    </>
  );
}
