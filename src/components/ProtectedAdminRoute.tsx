import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export const ProtectedAdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { loading, isAdmin } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" /></div>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

export default ProtectedAdminRoute;
