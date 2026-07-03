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

function getLandingPrimaryAction(signedIn: boolean) {
  return signedIn
    ? {
        href: "/dashboard",
        label: <>Continue Reading <span aria-hidden="true">→</span></>,
      }
    : {
        href: "/signin",
        label: "Get Started — It's Free",
      };
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const signedIn = Boolean(session?.user);
  const primaryAction = getLandingPrimaryAction(signedIn);

  return (
    <>
      <MarketingHeader signedIn={signedIn} />

      <main id="main-content">
        <LandingHeroSection
          primaryHref={primaryAction.href}
          primaryLabel={primaryAction.label}
          signedIn={signedIn}
        />
        <LandingSourcesSection />
        <LandingFeaturesSection />
        <LandingHowItWorksSection />
        <LandingCefrSection />
        <LandingCtaSection
          primaryHref={primaryAction.href}
          primaryLabel={primaryAction.label}
        />
      </main>

      <MarketingFooter />
    </>
  );
}
