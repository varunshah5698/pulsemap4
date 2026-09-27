import { AuthPanel } from "@/components/auth/AuthPanel";
import { AuthStage } from "@/components/auth/AuthStage";
import { useSearchParams } from "react-router";

/** Only same-origin paths are honoured, so `returnTo` cannot bounce off-site. */
export function resolveRedirectTarget(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = resolveRedirectTarget(searchParams.get("returnTo"));

  return (
    <AuthStage
      headline={["Your next", "chapter begins", "somewhere else."]}
      support="Sign in to rediscover the places you have been, to pick up the threads you left there, and to see where the map is quietly pointing next."
      navPrompt="Don't have an account?"
      navLabel="Create account"
      navHref="/signup"
    >
      <AuthPanel
        title="Welcome back."
        subtitle="Continue your journey."
        helper="No password to remember — we email a six-digit code that signs you straight in."
        redirectTo={redirectTo}
        codeTitle="Check your email."
        switchPrompt="New to Pulsemap?"
        switchLabel="Create an account"
        switchHref="/signup"
        underCard="Your map stays private until you decide to share a pin."
      />
    </AuthStage>
  );
}
