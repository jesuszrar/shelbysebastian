import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { ProductsProvider } from "@/context/ProductsContext";
import Index from "./pages/Index";
import ProductsPage from "./pages/ProductsPage";
import ProductDetail from "./pages/ProductDetail";
import Cart from "./pages/Cart";
import Login from "./pages/Login";
import Checkout from "./pages/Checkout";
import Profile from "./pages/Profile";
import OrderSuccess from "./pages/OrderSuccess";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ProtectedAdminRoute from "@/components/ProtectedAdminRoute";
import { trackPageView } from "@/lib/metaPixel";

const queryClient = new QueryClient();

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    trackPageView();
  }, [pathname]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner richColors position="top-right" />
      <BrowserRouter>
        <ProductsProvider>
          <AuthProvider>
            <CartProvider>
              <ScrollToTop />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/products/:productId" element={<ProductDetail />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/login" element={<Login />} />
                {/* Checkout no requiere autenticación; permite comprar como invitado */}
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                <Route path="/admin" element={<ProtectedAdminRoute><Admin /></ProtectedAdminRoute>} />
                <Route path="/order-success" element={<OrderSuccess />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </CartProvider>
          </AuthProvider>
        </ProductsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
