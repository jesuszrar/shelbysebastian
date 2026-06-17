import { Navbar } from "@/components/shelby/Navbar";
import { Hero } from "@/components/shelby/Hero";
import { Benefits } from "@/components/shelby/Benefits";
import { Products } from "@/components/shelby/Products";
import { Payments } from "@/components/shelby/Payments";
import { Testimonials } from "@/components/shelby/Testimonials";
import { CTA } from "@/components/shelby/CTA";
import { Footer } from "@/components/shelby/Footer";
import { WhatsAppButton } from "@/components/shelby/WhatsAppButton";

const Index = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <main>
      <Hero />
      <Benefits />
      <Products />
      <Payments />
      <Testimonials />
      <CTA />
    </main>
    <Footer />
    <WhatsAppButton />
  </div>
);

export default Index;
