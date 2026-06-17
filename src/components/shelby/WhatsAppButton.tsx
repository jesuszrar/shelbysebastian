import { MessageCircle } from "lucide-react";
export const WhatsAppButton = () => (
  <a href="https://wa.me/573228426561" target="_blank" rel="noopener noreferrer"
     className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-whatsapp text-white shadow-elegant flex items-center justify-center hover:scale-110 transition-smooth"
     aria-label="WhatsApp">
    <MessageCircle className="h-7 w-7" />
  </a>
);
