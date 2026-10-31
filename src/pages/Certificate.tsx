import { Link } from "react-router-dom";
import { ArrowRight, Download, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/shelby/Navbar";
import { Footer } from "@/components/shelby/Footer";
import { Button } from "@/components/ui/button";
import certificateImage from "@/assets/certificate/WhatsApp Image 2026-09-02 at 3.21.52 PM.jpeg";

const Certificate = () => (
  <div className="min-h-screen bg-[#f5f8f8]">
    <Navbar />
    <main className="container-shelby pb-20 pt-32 sm:pb-28">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div className="pt-4 lg:sticky lg:top-32">
          <FileCheck2 className="h-10 w-10 text-primary" />
          <span className="mt-8 block text-xs font-semibold uppercase tracking-[0.3em] text-primary">Distribuidor autorizado</span>
          <h1 className="mt-3 max-w-xl font-display text-5xl leading-[0.9] text-primary sm:text-6xl">La confianza también se certifica.</h1>
          <p className="mt-6 max-w-lg leading-relaxed text-muted-foreground">Shelby Importaciones cuenta con autorización para distribuir productos NIIMBOT, incluyendo impresoras inteligentes, software y consumibles relacionados en Colombia.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="bg-primary text-primary-foreground"><a href={certificateImage} download="certificado-distribuidor-autorizado-niimbot.jpeg"><Download className="mr-2 h-4 w-4" />Descargar certificado</a></Button>
            <Button asChild variant="outline"><a href={certificateImage} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir imagen</a></Button>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>Documento emitido por Wuhan Jingchen Intelligent Identification Technology Co., Ltd. para Shelby Importaciones.</p></div>
          </div>
          <Button asChild variant="link" className="mt-6 px-0 text-primary"><Link to="/niimbot">Conoce nuestra línea NIIMBOT <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
        <figure className="overflow-hidden rounded-[1.5rem] border border-border bg-white p-3 shadow-elegant sm:p-5">
          <img src={certificateImage} alt="Certificado oficial de distribuidor autorizado NIIMBOT para Shelby Importaciones" className="h-auto w-full" />
          <figcaption className="px-2 pb-1 pt-4 text-center text-xs text-muted-foreground">Certificado oficial de distribuidor autorizado NIIMBOT.</figcaption>
        </figure>
      </div>
    </main>
    <Footer />
  </div>
);

export default Certificate;