import { Navigate, useLocation } from "react-router";

/**
 * The landing page and older links still point at `/auth`. Their `returnTo`
 * query string is preserved as they are forwarded to the new sign-in route.
 */
export function AuthRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}
